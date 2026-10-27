import { createHash, randomUUID } from 'node:crypto';

import {
  isProtocolVersionCompatible,
  ProcessCommandRequestSchema,
  PROTOCOL_VERSION,
} from '@vfe/protocol';
import { Hono, type Context } from 'hono';


import { createConsoleLogger, silentLogger, type BrainLogger } from '../logger';

import type { EdgeConfig } from './config';
import { WindowLimiter } from './rate-limit';
import {
  bearerToken,
  issueSession,
  SessionError,
  verifySession,
  type SessionPayload,
} from './session';
import { SttError, transcribe, wavDurationMs } from './stt';

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_BODY_BYTES = 6 * 1024 * 1024;
const MAX_JSON_BYTES = 512 * 1024;

export interface EdgeOptions {
  config: EdgeConfig;
  fetcher?: typeof fetch;
  logger?: BrainLogger;
  now?: () => number;
  timeouts?: { brainMs?: number; sttMs?: number };
}

interface EdgeVars {
  session: SessionPayload;
  requestId: string;
}

type EdgeApp = Hono<{ Variables: EdgeVars }>;
type EdgeContext = Context<{ Variables: EdgeVars }>;

type ErrorCode =
  | 'ORIGIN_NOT_ALLOWED'
  | 'UNAUTHORIZED'
  | 'NOT_CONFIGURED'
  | 'RATE_LIMITED'
  | 'CONCURRENT_REQUEST'
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_PROTOCOL_VERSION'
  | 'PAYLOAD_TOO_LARGE'
  | 'AUDIO_TOO_LONG'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_TIMEOUT'
  | 'NOT_IMPLEMENTED'
  | 'NOT_FOUND';

export function isOriginAllowed(origin: string | undefined, config: EdgeConfig): boolean {
  if (!origin) return false;
  const dev = config.NODE_ENV !== 'production';
  if (dev && (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173')) {
    return true;
  }
  const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  if (!match) return false;
  const id = match[1] ?? '';
  return (
    config.allowedExtensionIds.includes(id) || (dev && config.allowedExtensionIds.includes('*'))
  );
}

function tokenId(token: string | null): string {
  return token ? createHash('sha256').update(token).digest('hex').slice(0, 12) : 'anonymous';
}

function bodySize(header: string | undefined): number | null {
  if (!header) return null;
  const value = Number(header);
  return Number.isFinite(value) ? value : null;
}

export function createEdgeApp(options: EdgeOptions): EdgeApp {
  const { config } = options;
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const logger = options.logger ?? createConsoleLogger(config.LOG_LEVEL);
  const now = options.now ?? Date.now;
  const brainTimeoutMs = options.timeouts?.brainMs ?? 10_000;
  const sttTimeoutMs = options.timeouts?.sttMs ?? 15_000;
  const app = new Hono<{ Variables: EdgeVars }>();
  const generalLimiter = new WindowLimiter(config.RATE_LIMIT_PER_MIN, 60_000, now);
  const sttLimiter = new WindowLimiter(config.STT_RATE_LIMIT_PER_MIN, 60_000, now);
  const active = new Set<string>();

  const fail = (
    c: EdgeContext,
    status: number,
    code: ErrorCode,
    message: string,
    extra: Record<string, unknown> = {},
  ) => {
    let requestId = 'req_unknown';
    try {
      requestId = c.get('requestId');
    } catch {
      requestId = 'req_unknown';
    }
    return c.json({ code, message, requestId, ...extra }, status as 200);
  };

  // Structured access logs; never log bodies, audio, transcripts or page data.
  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? `req_${randomUUID()}`;
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);
    const started = performance.now();
    await next();
    logger.info({
      requestId,
      route: `${c.req.method} ${new URL(c.req.url).pathname}`,
      status: c.res.status,
      latencyMs: Math.round(performance.now() - started),
      tokenId: tokenId(bearerToken(c.req.header('authorization'))),
    });
  });

  // Origin allowlist + CORS. Browsers always send Origin on preflighted calls.
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    if (new URL(c.req.url).pathname === '/healthz') return next();
    if (!isOriginAllowed(origin, config)) {
      return fail(
        c,
        403,
        'ORIGIN_NOT_ALLOWED',
        'This origin is not allowed to call the edge proxy',
      );
    }
    c.header('access-control-allow-origin', origin ?? '');
    c.header('vary', 'Origin');
    if (c.req.method === 'OPTIONS') {
      c.header('access-control-allow-methods', 'GET,POST,OPTIONS');
      c.header(
        'access-control-allow-headers',
        'authorization,content-type,idempotency-key,x-request-id,x-audio-duration-ms',
      );
      c.header('access-control-max-age', '600');
      return c.body(null, 204);
    }
    return next();
  });

  // Fail-closed gate + session auth + per-token rate limit.
  app.use('/v1/*', async (c, next) => {
    if (!config.configured) {
      return fail(
        c,
        503,
        'NOT_CONFIGURED',
        'Edge proxy is missing EDGE_SESSION_SECRET or a provider key',
      );
    }
    const path = new URL(c.req.url).pathname;
    if (path === '/v1/session') return next();

    const token = bearerToken(c.req.header('authorization'));
    if (!token) return fail(c, 401, 'UNAUTHORIZED', 'Missing bearer token');
    let session: SessionPayload;
    try {
      session = verifySession(token, config.sessionSecret, now());
    } catch (error) {
      if (error instanceof SessionError) return fail(c, 401, 'UNAUTHORIZED', error.message);
      return fail(c, 401, 'UNAUTHORIZED', 'Invalid session token');
    }
    c.set('session', session);

    const wait = generalLimiter.take(tokenId(token));
    if (wait > 0) {
      c.header('retry-after', String(wait));
      return fail(c, 429, 'RATE_LIMITED', 'Too many requests', { retryAfterMs: wait * 1000 });
    }
    await next();
    return;
  });

  const concurrencyGuard = async (c: EdgeContext, next: () => Promise<void>) => {
    const token = bearerToken(c.req.header('authorization')) ?? 'anonymous';
    const key = tokenId(token);
    if (active.has(key)) {
      c.header('retry-after', '1');
      return fail(c, 429, 'CONCURRENT_REQUEST', 'Only one in-flight request per token is allowed');
    }
    active.add(key);
    try {
      await next();
    } finally {
      active.delete(key);
    }
    return;
  };
  app.use('/v1/brain', concurrencyGuard);
  app.use('/v1/stt', concurrencyGuard);
  app.use('/v1/tts', concurrencyGuard);

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      version: PROTOCOL_VERSION,
      configured: config.configured,
      provider: config.STT_PROVIDER,
      mockStt: config.mockStt,
    }),
  );

  app.post('/v1/session', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, 'INVALID_REQUEST', 'Body must be valid JSON');
    }
    const extensionId =
      typeof body === 'object' && body !== null && 'extensionId' in body
        ? (body as { extensionId?: unknown }).extensionId
        : undefined;
    if (typeof extensionId !== 'string' || !/^[a-p]{32}$/.test(extensionId)) {
      return fail(c, 400, 'INVALID_REQUEST', 'extensionId must be a Chrome extension id');
    }
    const dev = config.NODE_ENV !== 'production';
    if (
      !config.allowedExtensionIds.includes(extensionId) &&
      !(dev && config.allowedExtensionIds.includes('*'))
    ) {
      return fail(c, 403, 'ORIGIN_NOT_ALLOWED', 'Extension id is not allowlisted');
    }
    const { token, expiresAt } = issueSession(extensionId, config.sessionSecret, { now: now() });
    return c.json({ token, expiresAt });
  });

  app.get('/v1/config', (c) =>
    c.json({
      brainProtocolVersion: PROTOCOL_VERSION,
      supportedActions: [
        'FILL',
        'SELECT',
        'SET_CHECKED',
        'CLICK',
        'FOCUS',
        'CLEAR',
        'SCROLL',
        'ASK_CLARIFICATION',
      ],
      sttProvider: config.mockStt ? 'mock' : config.STT_PROVIDER,
      maxAudioSeconds: config.MAX_AUDIO_SECONDS,
      maxAudioBytes: MAX_AUDIO_BYTES,
      hudShortcut: 'Alt+V',
    }),
  );

  app.post('/v1/brain', async (c) => {
    const declared = bodySize(c.req.header('content-length'));
    if (declared !== null && declared > MAX_JSON_BYTES) {
      return fail(c, 413, 'PAYLOAD_TOO_LARGE', 'JSON body exceeds 512 KB');
    }
    let text: string;
    try {
      text = await c.req.text();
    } catch {
      return fail(c, 400, 'INVALID_REQUEST', 'Could not read request body');
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) {
      return fail(c, 413, 'PAYLOAD_TOO_LARGE', 'JSON body exceeds 512 KB');
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return fail(c, 400, 'INVALID_REQUEST', 'Body must be valid JSON');
    }
    const parsed = ProcessCommandRequestSchema.safeParse(json);
    if (!parsed.success) {
      return fail(c, 400, 'INVALID_REQUEST', 'Request failed protocol validation', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      });
    }
    const version = parsed.data.clientContext?.protocolVersion;
    if (version && !isProtocolVersionCompatible(version)) {
      return fail(
        c,
        409,
        'UNSUPPORTED_PROTOCOL_VERSION',
        `Client protocol ${version} is not supported`,
        {
          serverProtocolVersion: PROTOCOL_VERSION,
        },
      );
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const idempotencyKey = c.req.header('idempotency-key');
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    headers['x-request-id'] = c.get('requestId');
    if (config.BRAIN_AUTH_TOKEN) headers.authorization = `Bearer ${config.BRAIN_AUTH_TOKEN}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), brainTimeoutMs);
    try {
      const upstream = await fetcher(`${config.brainUrl.replace(/\/$/, '')}/api/process-command`, {
        method: 'POST',
        headers,
        body: JSON.stringify(parsed.data),
        signal: controller.signal,
      });
      const upstreamText = await upstream.text();
      if (upstream.status >= 500) {
        return fail(c, 502, 'UPSTREAM_ERROR', `Brain returned HTTP ${upstream.status}`);
      }
      if (upstream.status === 200) {
        try {
          return c.json(JSON.parse(upstreamText) as Record<string, unknown>);
        } catch {
          return fail(c, 502, 'UPSTREAM_ERROR', 'Brain returned non-JSON output');
        }
      }
      try {
        const body = JSON.parse(upstreamText) as Record<string, unknown>;
        return c.json(body, upstream.status as 200);
      } catch {
        return fail(c, 502, 'UPSTREAM_ERROR', 'Brain returned an unexpected error body');
      }
    } catch (error) {
      const aborted = controller.signal.aborted;
      return fail(
        c,
        aborted ? 504 : 502,
        aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
        aborted
          ? 'Brain request timed out'
          : error instanceof Error
            ? error.message
            : 'Brain request failed',
      );
    } finally {
      clearTimeout(timer);
    }
  });

  app.post('/v1/stt', async (c) => {
    const declared = bodySize(c.req.header('content-length'));
    if (declared !== null && declared > MAX_AUDIO_BODY_BYTES) {
      return fail(c, 413, 'PAYLOAD_TOO_LARGE', 'Audio body exceeds 5 MB');
    }
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return fail(c, 400, 'INVALID_REQUEST', 'Expected multipart/form-data with an "audio" file');
    }
    const audio = form.get('audio');
    if (typeof audio !== 'object' || audio === null || !('arrayBuffer' in audio)) {
      return fail(c, 400, 'INVALID_REQUEST', 'Missing "audio" file part');
    }
    const file = audio as Blob & { name?: string };
    if (file.size > MAX_AUDIO_BYTES) {
      return fail(c, 413, 'PAYLOAD_TOO_LARGE', 'Audio exceeds 5 MB');
    }
    const buffer = await file.arrayBuffer();
    const durationMs = wavDurationMs(buffer);
    if (durationMs !== null && durationMs > config.MAX_AUDIO_SECONDS * 1000) {
      return fail(
        c,
        422,
        'AUDIO_TOO_LONG',
        `Audio is ${Math.round(durationMs / 1000)} s; the limit is ${config.MAX_AUDIO_SECONDS} s`,
        { maxAudioSeconds: config.MAX_AUDIO_SECONDS },
      );
    }

    const wait = sttLimiter.take(tokenId(bearerToken(c.req.header('authorization'))));
    if (wait > 0) {
      c.header('retry-after', String(wait));
      return fail(c, 429, 'RATE_LIMITED', 'Too many speech-to-text requests', {
        retryAfterMs: wait * 1000,
      });
    }

    const language = form.get('language');
    try {
      const result = await transcribe(
        {
          audio: buffer,
          mimeType: file.type || 'audio/wav',
          filename: file.name || 'audio.wav',
          ...(typeof language === 'string' && language ? { language } : {}),
        },
        { config, fetcher, timeoutMs: sttTimeoutMs },
      );
      return c.json({ ...result, durationMs: result.durationMs || (durationMs ?? 0) });
    } catch (error) {
      if (error instanceof SttError) {
        if (error.code === 'NOT_CONFIGURED') return fail(c, 503, 'NOT_CONFIGURED', error.message);
        return fail(c, error.code === 'UPSTREAM_TIMEOUT' ? 504 : 502, error.code, error.message);
      }
      return fail(c, 502, 'UPSTREAM_ERROR', 'Speech-to-text failed');
    }
  });

  app.post('/v1/tts', (c) =>
    fail(c, 501, 'NOT_IMPLEMENTED', 'TTS stays in the browser (speechSynthesis) for the MVP'),
  );

  app.notFound((c) =>
    c.json(
      {
        code: 'NOT_FOUND',
        message: `No route for ${c.req.method} ${new URL(c.req.url).pathname}`,
        requestId: c.get('requestId') ?? 'req_unknown',
      },
      404,
    ),
  );

  app.onError((error, c) => {
    logger.error({ requestId: c.get('requestId') ?? 'unknown', message: error.message });
    return c.json(
      {
        code: 'UPSTREAM_ERROR',
        message: 'Unexpected edge proxy error',
        requestId: c.get('requestId') ?? 'req_unknown',
      },
      500,
    );
  });

  return app;
}

export { silentLogger };
