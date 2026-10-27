import { PROTOCOL_VERSION } from '@vfe/protocol';
import { Hono } from 'hono';
import { cors } from 'hono/cors';


import type { BrainConfig } from './config';
import { createProvider } from './llm/factory';
import type { LlmProvider } from './llm/types';
import { createConsoleLogger, type BrainLogger } from './logger';
import { processCommand, type BrainDeps } from './service';

export interface AppOptions {
  config: BrainConfig;
  provider?: LlmProvider;
  logger?: BrainLogger;
  servedAt?: () => number;
}

function authorised(config: BrainConfig, header: string | undefined): boolean {
  if (!config.BRAIN_AUTH_TOKEN) return true;
  return header === `Bearer ${config.BRAIN_AUTH_TOKEN}`;
}

function headersOf(c: {
  req: { header: (name: string) => string | undefined };
}): Record<string, string | undefined> {
  return {
    'x-request-id': c.req.header('x-request-id'),
    'idempotency-key': c.req.header('idempotency-key'),
    authorization: c.req.header('authorization'),
  };
}

export function createApp(options: AppOptions): Hono {
  const logger = options.logger ?? createConsoleLogger(options.config.LOG_LEVEL);
  const deps: BrainDeps = {
    config: options.config,
    provider: options.provider ?? createProvider(options.config),
    logger,
    now: options.servedAt,
  };
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: (origin) =>
        /^chrome-extension:\/\//.test(origin) ||
        /^http:\/\/localhost:(3000|5173|8787)$/.test(origin)
          ? origin
          : null,
      allowHeaders: ['content-type', 'authorization', 'x-request-id', 'idempotency-key'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      maxAge: 600,
    }),
  );

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      version: PROTOCOL_VERSION,
      status: 'ok',
      protocolVersion: PROTOCOL_VERSION,
      provider: deps.provider.name,
      model: deps.provider.model,
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );

  app.get('/api/capabilities', (c) =>
    c.json({
      protocolVersion: PROTOCOL_VERSION,
      supportedProtocolVersions: [PROTOCOL_VERSION],
      providers: ['openai', 'groq', 'anthropic', 'mock'],
      activeProvider: deps.provider.name,
      model: deps.provider.model,
      actionKinds: [
        'FILL',
        'SELECT',
        'SET_CHECKED',
        'CLICK',
        'FOCUS',
        'CLEAR',
        'SCROLL',
        'ASK_CLARIFICATION',
      ],
      limits: {
        maxElements: 250,
        maxTranscriptChars: 2000,
        maxTimeoutMs: 30_000,
        requestsPerMinute: options.config.RATE_LIMIT_PER_MINUTE,
      },
      features: { structuredOutputs: true, cache: true, idempotency: true },
    }),
  );

  app.post('/api/process-command', async (c) => {
    if (!authorised(options.config, c.req.header('authorization'))) {
      return c.json(
        { code: 'UNAUTHORIZED', message: 'Missing or invalid bearer token', requestId: 'auth' },
        401,
      );
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { code: 'INVALID_REQUEST', message: 'Body must be valid JSON', requestId: 'parse' },
        400,
      );
    }
    const result = await processCommand(deps, body, headersOf(c));
    return c.json(result.body as Record<string, unknown>, result.status as 200);
  });

  app.notFound((c) =>
    c.json(
      {
        code: 'NOT_FOUND',
        message: `No route for ${c.req.method} ${c.req.path}`,
        requestId: 'router',
      },
      404,
    ),
  );

  app.onError((error, c) => {
    logger.error({ outcome: 'unhandled_error', message: error.message });
    return c.json(
      { code: 'PROVIDER_UNAVAILABLE', message: 'Unexpected server error', requestId: 'error' },
      500,
    );
  });

  return app;
}
