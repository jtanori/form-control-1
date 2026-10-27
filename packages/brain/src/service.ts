import { createHash, randomUUID } from 'node:crypto';

import {
  assertProtocolVersion,
  BrainResponseSchema,
  isProtocolVersionCompatible,
  parseBrainResponse,
  ProcessCommandRequestSchema,
  ProcessCommandResponseSchema,
  PROTOCOL_VERSION,
  ProtocolError,
  type BrainResponse,
  type ProcessCommandRequest,
  type ProcessCommandResponse,
} from '@vfe/protocol';

import { LruCache } from './cache';
import type { BrainConfig } from './config';
import { BrainResponseStructuredSchema, normaliseStructuredResponse } from './llm/structured';
import type { LlmProvider, TokenUsage } from './llm/types';
import { silentLogger, type BrainLogger } from './logger';
import { buildSystemPrompt, SYSTEM_PROMPT_VERSION } from './prompt/system';
import { buildMessages } from './prompt/user-message';

export interface BrainDeps {
  config: BrainConfig;
  provider: LlmProvider;
  logger?: BrainLogger;
  now?: () => number;
}

export interface BrainResult {
  status: number;
  body: unknown;
}

type ErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_PROTOCOL_VERSION'
  | 'UNPROCESSABLE_BRAIN_OUTPUT'
  | 'UNKNOWN_TARGET'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'IDEMPOTENCY_MISMATCH'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND';

interface ErrorBody {
  code: ErrorCode;
  message: string;
  requestId: string;
  issues?: Array<{ path: string; message: string }>;
  details?: Record<string, unknown>;
}

function errorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
  extra: { issues?: ErrorBody['issues']; details?: Record<string, unknown> } = {},
): ErrorBody {
  return { code, message, requestId, ...extra };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requestIdFor(headers: Record<string, string | undefined>): string {
  return headers['x-request-id'] ?? `req_${randomUUID()}`;
}

function cacheKey(req: ProcessCommandRequest): string {
  return sha256(
    JSON.stringify({
      pageState: req.pageState,
      transcript: req.transcript,
      history: req.conversationHistory.slice(-4),
      provider: 'brain',
      prompt: SYSTEM_PROMPT_VERSION,
      protocol: PROTOCOL_VERSION,
    }),
  );
}

function unknownTargets(response: BrainResponse, ids: Set<string>): string[] {
  const unknown: string[] = [];
  for (const action of response.actions) {
    if ('targetId' in action && !ids.has(action.targetId)) unknown.push(action.targetId);
  }
  return Array.from(new Set(unknown));
}

type ProviderOutcome =
  | { ok: true; response: BrainResponse; usage: TokenUsage; calls: number }
  | { ok: false; error: BrainResult };

/**
 * One model round-trip plus at most one repair for malformed output, and at
 * most one additional pass when a target id does not exist on the page.
 */
async function complete(
  deps: BrainDeps,
  req: ProcessCommandRequest,
  requestId: string,
): Promise<ProviderOutcome> {
  const startedAt = (deps.now ?? Date.now)();
  const system = buildSystemPrompt();
  const baseMessages = buildMessages(req);
  const ids = new Set(req.pageState.elements.map((element) => element.id));
  let calls = 0;

  const call = async (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ parsed: unknown; usage: TokenUsage } | BrainResult> => {
    calls += 1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        deps.provider.complete({
          system,
          messages,
          schema: BrainResponseStructuredSchema,
          schemaName: 'brain_response',
          temperature: deps.config.LLM_TEMPERATURE,
          timeoutMs: deps.config.LLM_TIMEOUT_MS,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`provider timeout after ${deps.config.LLM_TIMEOUT_MS} ms`)),
            deps.config.LLM_TIMEOUT_MS,
          );
        }),
      ]);
      return { parsed: result.parsed, usage: result.usage };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider failed';
      const timedOut = /timeout|aborted|ETIMEDOUT/i.test(message);
      return {
        status: timedOut ? 504 : 503,
        body: errorBody(timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE', message, requestId),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const parseAttempt = (raw: unknown): BrainResponse | null => {
    const parsed = BrainResponseSchema.safeParse(normaliseStructuredResponse(raw));
    return parsed.success ? parsed.data : null;
  };

  const first = await call(baseMessages);
  if ('status' in first) return { ok: false, error: first };

  let response = parseAttempt(first.parsed);
  let usage = first.usage;

  if (!response) {
    const issues =
      BrainResponseSchema.safeParse(normaliseStructuredResponse(first.parsed)).error?.issues ?? [];
    const issueText = issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    const repair = await call([
      ...baseMessages,
      {
        role: 'user',
        content: `Your previous output failed validation: ${issueText}. Respond again with JSON that matches the schema exactly.`,
      },
    ]);
    if ('status' in repair) return { ok: false, error: repair };
    usage = repair.usage;
    response = parseAttempt(repair.parsed);
    if (!response) {
      return {
        ok: false,
        error: {
          status: 422,
          body: errorBody(
            'UNPROCESSABLE_BRAIN_OUTPUT',
            'The model returned unparseable JSON twice',
            requestId,
            {
              issues: issues.map((issue) => ({
                path: issue.path.join('.') || '(root)',
                message: issue.message,
              })),
            },
          ),
        },
      };
    }
  }

  const unknown = unknownTargets(response, ids);
  if (unknown.length > 0) {
    const correction = await call([
      ...baseMessages,
      {
        role: 'user',
        content: `Your previous output referenced ids that do not exist: ${unknown.join(', ')}. Use only these ids: ${Array.from(ids).join(', ')}. Respond again with JSON that matches the schema.`,
      },
    ]);
    if ('status' in correction) return { ok: false, error: correction };
    usage = correction.usage;
    const corrected = parseAttempt(correction.parsed);
    if (!corrected) {
      return {
        ok: false,
        error: {
          status: 422,
          body: errorBody(
            'UNPROCESSABLE_BRAIN_OUTPUT',
            'The model returned unparseable JSON',
            requestId,
          ),
        },
      };
    }
    const stillUnknown = unknownTargets(corrected, ids);
    if (stillUnknown.length > 0) {
      return {
        ok: false,
        error: {
          status: 422,
          body: errorBody(
            'UNKNOWN_TARGET',
            'The model referenced elements that do not exist',
            requestId,
            {
              details: { unknown: stillUnknown },
            },
          ),
        },
      };
    }
    response = corrected;
  }

  const latencyMs = (deps.now ?? Date.now)() - startedAt;
  if (latencyMs > deps.config.LLM_TIMEOUT_MS) {
    return {
      ok: false,
      error: { status: 504, body: errorBody('PROVIDER_TIMEOUT', 'Provider timed out', requestId) },
    };
  }
  return { ok: true, response, usage, calls };
}

const responseCache = new LruCache<ProcessCommandResponse>(500, 600_000);
const idempotencyCache = new LruCache<{ hash: string; response: ProcessCommandResponse }>(
  200,
  300_000,
);
const rateBuckets = new Map<string, number[]>();

/** Test/teardown hook: clears the in-process caches and rate counters. */
export function resetBrainState(): void {
  responseCache.clear();
  idempotencyCache.clear();
  rateBuckets.clear();
}

function rateLimited(client: string, limit: number, now: number): boolean {
  const bucket = (rateBuckets.get(client) ?? []).filter((at) => now - at < 60_000);
  bucket.push(now);
  rateBuckets.set(client, bucket);
  return bucket.length > limit;
}

/**
 * `POST /api/process-command` core. Validates, caches, calls the model at most
 * three times, guards every target id and validates the response on the way out.
 */
export async function processCommand(
  deps: BrainDeps,
  body: unknown,
  headers: Record<string, string | undefined> = {},
): Promise<BrainResult> {
  const logger = deps.logger ?? silentLogger;
  const now = deps.now ?? Date.now;
  const requestId = requestIdFor(headers);
  const startedAt = now();

  const parsedRequest = ProcessCommandRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return {
      status: 400,
      body: errorBody('INVALID_REQUEST', 'Request failed protocol validation', requestId, {
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      }),
    };
  }
  const req = parsedRequest.data;

  const version = req.clientContext?.protocolVersion;
  if (version && !isProtocolVersionCompatible(version)) {
    return {
      status: 409,
      body: errorBody(
        'UNSUPPORTED_PROTOCOL_VERSION',
        `Client protocol ${version} is incompatible with ${PROTOCOL_VERSION}`,
        requestId,
        { details: { serverProtocolVersion: PROTOCOL_VERSION } },
      ),
    };
  }
  if (version) {
    try {
      assertProtocolVersion(version);
    } catch (error) {
      if (error instanceof ProtocolError) {
        return {
          status: 409,
          body: errorBody('UNSUPPORTED_PROTOCOL_VERSION', error.message, requestId),
        };
      }
    }
  }

  const client = req.clientContext?.client ?? 'unknown';
  if (rateLimited(client, deps.config.RATE_LIMIT_PER_MINUTE, now())) {
    return {
      status: 429,
      body: errorBody('RATE_LIMITED', 'Too many requests for this client', requestId, {
        details: { retryAfterMs: 1000 },
      }),
    };
  }

  const bodyHash = sha256(JSON.stringify(body));
  const idempotencyKey = headers['idempotency-key'];
  if (idempotencyKey) {
    const stored = idempotencyCache.get(idempotencyKey);
    if (stored) {
      if (stored.hash !== bodyHash) {
        return {
          status: 409,
          body: errorBody(
            'IDEMPOTENCY_MISMATCH',
            'Idempotency-Key reused with a different body',
            requestId,
          ),
        };
      }
      return {
        status: 200,
        body: { ...stored.response, meta: { ...stored.response.meta, requestId, cached: true } },
      };
    }
  }

  const key = cacheKey(req);
  const cached = responseCache.get(key);
  if (cached) {
    const response: ProcessCommandResponse = {
      ...cached,
      meta: { ...cached.meta, requestId, latencyMs: now() - startedAt, cached: true },
    };
    logger.info({
      requestId,
      outcome: 'cache_hit',
      provider: cached.meta.provider,
      latencyMs: response.meta.latencyMs,
    });
    return { status: 200, body: response };
  }

  const outcome = await complete(deps, req, requestId);
  if (!outcome.ok) {
    const body = outcome.error.body as ErrorBody;
    logger.warn({ requestId, outcome: 'provider_error', errorCode: body.code });
    return outcome.error;
  }

  const latencyMs = now() - startedAt;
  const response = ProcessCommandResponseSchema.parse({
    brainResponse: outcome.response,
    meta: {
      provider: deps.provider.name,
      model: deps.provider.model,
      latencyMs,
      requestId,
      promptVersion: SYSTEM_PROMPT_VERSION,
    },
  });

  try {
    parseBrainResponse(outcome.response);
  } catch (error) {
    return {
      status: 422,
      body: errorBody(
        'UNPROCESSABLE_BRAIN_OUTPUT',
        error instanceof ProtocolError ? error.message : 'Invalid brain response',
        requestId,
      ),
    };
  }

  responseCache.set(key, response);
  if (idempotencyKey) idempotencyCache.set(idempotencyKey, { hash: bodyHash, response });

  logger.info({
    requestId,
    outcome: 'ok',
    provider: deps.provider.name,
    model: deps.provider.model,
    latencyMs,
    promptTokens: outcome.usage.promptTokens,
    completionTokens: outcome.usage.completionTokens,
    actionCount: response.brainResponse.actions.length,
    promptVersion: SYSTEM_PROMPT_VERSION,
  });

  return { status: 200, body: response };
}
