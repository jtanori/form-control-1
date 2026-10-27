import { ProcessCommandRequestSchema } from '@vfe/protocol';
import { checkoutPageState } from '@vfe/protocol/fixtures';
import { describe, expect, it } from 'vitest';


import { silentLogger, type BrainLogger } from '../logger';

import { createEdgeApp, isOriginAllowed } from './app';
import { loadEdgeConfig, type EdgeConfig } from './config';
import { issueSession } from './session';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = `chrome-extension://${EXT}`;
const SECRET = 'test-session-secret-32-characters-long';
const BRAIN_TOKEN = 'brain-shared-secret';

function config(overrides: Record<string, string> = {}): EdgeConfig {
  return loadEdgeConfig({
    EDGE_SESSION_SECRET: SECRET,
    ALLOWED_EXTENSION_IDS: EXT,
    MOCK_STT: '1',
    BRAIN_URL: 'http://brain.test',
    BRAIN_AUTH_TOKEN: BRAIN_TOKEN,
    STT_PROVIDER: 'groq',
    NODE_ENV: 'test',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

interface FetcherSpy {
  calls: Array<{ url: string; init?: RequestInit }>;
  fetcher: typeof fetch;
}

function fetcherSpy(
  responder?: (url: string, init?: RequestInit) => Promise<Response>,
): FetcherSpy {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    if (responder) return responder(url, init);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, fetcher };
}

function requestBody(transcript = 'hello'): unknown {
  return {
    pageState: checkoutPageState,
    transcript,
    conversationHistory: [],
    clientContext: {
      client: 'extension',
      clientVersion: '0.1.0',
      protocolVersion: '1.0.0',
    },
  };
}

async function makeApp(
  options: {
    overrides?: Record<string, string>;
    responder?: (url: string, init?: RequestInit) => Promise<Response>;
    logger?: BrainLogger;
    timeouts?: { brainMs?: number; sttMs?: number };
    now?: () => number;
  } = {},
) {
  const spy = fetcherSpy(options.responder);
  const app = createEdgeApp({
    config: config(options.overrides),
    fetcher: spy.fetcher,
    logger: options.logger ?? silentLogger,
    ...(options.timeouts ? { timeouts: options.timeouts } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return { app, spy };
}

async function authenticate(app: ReturnType<typeof createEdgeApp>): Promise<string> {
  const response = await app.request('/v1/session', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ extensionId: EXT }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { token: string; expiresAt: number };
  return body.token;
}

function edgeRequest(
  app: ReturnType<typeof createEdgeApp>,
  path: string,
  init: RequestInit & { token?: string } = {},
): Response | Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  const rest: RequestInit = { ...init };
  delete (rest as { token?: string }).token;
  return app.request(path, { ...rest, headers });
}

describe('origin allowlist', () => {
  it('accepts allowlisted extension origins and localhost in dev', () => {
    const cfg = config();
    expect(isOriginAllowed(ORIGIN, cfg)).toBe(true);
    expect(isOriginAllowed('http://localhost:5173', cfg)).toBe(true);
    expect(isOriginAllowed(`chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba`, cfg)).toBe(false);
    expect(isOriginAllowed('https://evil.example', cfg)).toBe(false);
    expect(isOriginAllowed(undefined, cfg)).toBe(false);
  });

  it('answers preflight with 204 and echoes the origin', async () => {
    const { app } = await makeApp();
    const response = await app.request('/v1/brain', {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(response.headers.get('vary')).toContain('Origin');
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('rejects a foreign origin without CORS headers', async () => {
    const { app } = await makeApp();
    const response = await app.request('/v1/brain', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify(requestBody()),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(body.requestId).toBeTruthy();
  });

  it('rejects an absent origin on /v1 routes but not on /healthz', async () => {
    const { app } = await makeApp();
    expect((await app.request('/healthz')).status).toBe(200);
    expect((await app.request('/v1/config')).status).toBe(403);
  });
});

describe('sessions', () => {
  it('issues a token that authenticates /v1/config', async () => {
    const { app } = await makeApp();
    const token = await authenticate(app);
    const response = await edgeRequest(app, '/v1/config', { token });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.brainProtocolVersion).toBe('1.0.0');
    expect(body.supportedActions).toHaveLength(8);
    expect(body.hudShortcut).toBe('Alt+V');
  });

  it('rejects a tampered token', async () => {
    const { app } = await makeApp();
    const token = await authenticate(app);
    const tampered = `${token.slice(0, -2)}xx`;
    const response = await edgeRequest(app, '/v1/config', { token: tampered });
    expect(response.status).toBe(401);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects an expired token', async () => {
    const now = 1_700_000_000_000;
    const { app } = await makeApp({ now: () => now });
    const { token } = issueSession(EXT, SECRET, { now: now - 48 * 60 * 60 * 1000 });
    const response = await edgeRequest(app, '/v1/config', { token });
    expect(response.status).toBe(401);
  });

  it('refuses to mint a session for a non-allowlisted extension', async () => {
    const { app } = await makeApp();
    const response = await app.request('/v1/session', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ extensionId: 'ponmlkjihgfedcbaponmlkjihgfedcba' }),
    });
    expect(response.status).toBe(403);
  });

  it('requires authentication on /v1/brain', async () => {
    const { app } = await makeApp();
    const response = await edgeRequest(app, '/v1/brain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody()),
    });
    expect(response.status).toBe(401);
  });
});

describe('brain passthrough', () => {
  it('forwards a valid request and returns the upstream body unchanged', async () => {
    const upstream = {
      brainResponse: { thoughtProcess: 'x', spokenFeedback: 'y', actions: [] },
      meta: { provider: 'openai', model: 'gpt-4o-mini', latencyMs: 1, requestId: 'req_up' },
    };
    const { app, spy } = await makeApp({
      responder: async () =>
        new Response(JSON.stringify(upstream), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const token = await authenticate(app);
    const response = await edgeRequest(app, '/v1/brain', {
      method: 'POST',
      token,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'abc',
        cookie: 'session=leak',
      },
      body: JSON.stringify(requestBody()),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(upstream);

    const call = spy.calls[0];
    expect(call?.url).toBe('http://brain.test/api/process-command');
    const headers = new Headers(call?.init?.headers);
    expect(headers.get('idempotency-key')).toBe('abc');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('authorization')).toBe(`Bearer ${BRAIN_TOKEN}`);
    expect(headers.get('x-forwarded-for')).toBeNull();
  });

  it('rejects a protocol mismatch before forwarding', async () => {
    const { app, spy } = await makeApp();
    const token = await authenticate(app);
    const body = requestBody();
    (body as { clientContext: { protocolVersion: string } }).clientContext.protocolVersion =
      '2.0.0';
    const response = await edgeRequest(app, '/v1/brain', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(409);
    expect(spy.calls).toHaveLength(0);
  });

  it('validates the protocol schema before forwarding', async () => {
    const { app, spy } = await makeApp();
    const token = await authenticate(app);
    const response = await edgeRequest(app, '/v1/brain', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript: 'only this' }),
    });
    expect(response.status).toBe(400);
    expect(spy.calls).toHaveLength(0);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.code).toBe('INVALID_REQUEST');
  });

  it('maps an upstream 500 to 502 with a requestId', async () => {
    const { app } = await makeApp({
      responder: async () => new Response('boom', { status: 500 }),
    });
    const token = await authenticate(app);
    const response = await edgeRequest(app, '/v1/brain', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody()),
    });
    expect(response.status).toBe(502);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.code).toBe('UPSTREAM_ERROR');
    expect(body.requestId).toMatch(/^req_/);
  });

  it('passes through typed 4xx errors', async () => {
    const upstream = { code: 'UNPROCESSABLE_BRAIN_OUTPUT', message: 'nope', requestId: 'req_up' };
    const { app } = await makeApp({
      responder: async () =>
        new Response(JSON.stringify(upstream), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const token = await authenticate(app);
    const response = await edgeRequest(app, '/v1/brain', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody()),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual(upstream);
  });

  it('times out a hanging brain call with 504', async () => {
    const { app } = await makeApp({
      timeouts: { brainMs: 20 },
      responder: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    });
    const token = await authenticate(app);
    const response = await edgeRequest(app, '/v1/brain', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody()),
    });
    expect(response.status).toBe(504);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
    });
  });

  it('rejects a JSON body over 512 KB', async () => {
    const { app, spy } = await makeApp();
    const token = await authenticate(app);
    const response = await edgeRequest(app, '/v1/brain', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: `{"pageState":${'x'.repeat(600 * 1024)}}`,
    });
    expect(response.status).toBe(413);
    expect(spy.calls).toHaveLength(0);
  });
});

function wavOf(seconds: number): ArrayBuffer {
  const sampleRate = 16_000;
  const dataSize = Math.round(seconds * sampleRate * 2);
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataSize, true);
  return buffer;
}

function sttForm(seconds = 2): FormData {
  const form = new FormData();
  form.append('audio', new Blob([wavOf(seconds)], { type: 'audio/wav' }), 'audio.wav');
  form.append('language', 'en');
  return form;
}

describe('speech-to-text', () => {
  it('returns a deterministic transcript in MOCK_STT mode without upstream calls', async () => {
    const { app, spy } = await makeApp();
    const token = await authenticate(app);
    const response = await edgeRequest(app, '/v1/stt', { method: 'POST', token, body: sttForm() });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.transcript).toBe('This is a mock transcript.');
    expect(body.durationMs).toBe(2000);
    expect(spy.calls).toHaveLength(0);
  });

  it('rejects audio longer than 30 seconds with 422', async () => {
    const { app } = await makeApp();
    const token = await authenticate(app);
    const response = await edgeRequest(app, '/v1/stt', {
      method: 'POST',
      token,
      body: sttForm(31),
    });
    expect(response.status).toBe(422);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      code: 'AUDIO_TOO_LONG',
    });
  });

  it('rejects audio over 5 MB with 413', async () => {
    const { app } = await makeApp();
    const token = await authenticate(app);
    const form = new FormData();
    form.append(
      'audio',
      new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'audio/wav' }),
      'big.wav',
    );
    const response = await edgeRequest(app, '/v1/stt', { method: 'POST', token, body: form });
    expect(response.status).toBe(413);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('proxies to Groq with server-side credentials when configured', async () => {
    const { app, spy } = await makeApp({
      overrides: { MOCK_STT: '0', GROQ_API_KEY: 'gsk_live_key' },
      responder: async () =>
        new Response(JSON.stringify({ text: 'hello world', duration: 1.5 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const token = await authenticate(app);
    const response = await edgeRequest(app, '/v1/stt', { method: 'POST', token, body: sttForm(2) });
    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      transcript: 'hello world',
      durationMs: 1500,
    });
    const headers = new Headers(spy.calls[0]?.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer gsk_live_key');
  });
});

describe('limits and configuration', () => {
  it('rate limits with Retry-After', async () => {
    const { app } = await makeApp({ overrides: { RATE_LIMIT_PER_MIN: '3' } });
    const token = await authenticate(app);
    for (let i = 0; i < 3; i += 1) {
      expect((await edgeRequest(app, '/v1/config', { token })).status).toBe(200);
    }
    const limited = await edgeRequest(app, '/v1/config', { token });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect((await limited.json()) as Record<string, unknown>).toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('allows only one concurrent request per token', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app } = await makeApp({
      responder: async () => {
        await gate;
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const token = await authenticate(app);
    const first = edgeRequest(app, '/v1/brain', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody()),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await edgeRequest(app, '/v1/brain', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody('second')),
    });
    expect(second.status).toBe(429);
    expect((await second.json()) as Record<string, unknown>).toMatchObject({
      code: 'CONCURRENT_REQUEST',
    });
    release?.();
    expect((await first).status).toBe(200);
  });

  it('returns 501 for TTS', async () => {
    const { app } = await makeApp();
    const token = await authenticate(app);
    const response = await edgeRequest(app, '/v1/tts', {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(501);
  });

  it('fails closed on /v1/* when secrets are missing while /healthz stays up', async () => {
    const { app } = await makeApp({
      overrides: { EDGE_SESSION_SECRET: '', MOCK_STT: '0', GROQ_API_KEY: '' },
    });
    const health = await app.request('/healthz');
    expect(health.status).toBe(200);
    expect((await health.json()) as Record<string, unknown>).toMatchObject({
      ok: true,
      configured: false,
    });
    const configResponse = await edgeRequest(app, '/v1/config');
    expect(configResponse.status).toBe(503);
    expect((await configResponse.json()) as Record<string, unknown>).toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });

  it('never logs secrets, tokens or page contents', async () => {
    const lines: string[] = [];
    const logger: BrainLogger = {
      debug: (event) => lines.push(JSON.stringify(event)),
      info: (event) => lines.push(JSON.stringify(event)),
      warn: (event) => lines.push(JSON.stringify(event)),
      error: (event) => lines.push(JSON.stringify(event)),
    };
    const { app } = await makeApp({
      logger,
      overrides: { MOCK_STT: '0', GROQ_API_KEY: 'gsk_supersecret_value' },
      responder: async () =>
        new Response(JSON.stringify({ transcript: 'private words' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const token = await authenticate(app);
    await edgeRequest(app, '/v1/stt', { method: 'POST', token, body: sttForm(2) });
    const joined = lines.join('\n');
    expect(joined).toContain('route');
    expect(joined).not.toContain(SECRET);
    expect(joined).not.toContain('gsk_supersecret_value');
    expect(joined).not.toContain(token);
    expect(joined).not.toContain('private words');
  });

  it('accepts the documented protocol fixture shape', () => {
    expect(ProcessCommandRequestSchema.safeParse(requestBody()).success).toBe(true);
  });
});
