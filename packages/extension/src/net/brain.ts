import { ProcessCommandResponseSchema, type ProcessCommandResponse } from '@vfe/protocol';

import type { EdgeSession } from '../audio/session';

export type BrainErrorCode =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'UPSTREAM'
  | 'INVALID_RESPONSE'
  | 'ABORTED';

export class BrainError extends Error {
  readonly code: BrainErrorCode;

  constructor(code: BrainErrorCode, message: string) {
    super(message);
    this.name = 'BrainError';
    this.code = code;
  }
}

export interface BrainRequest {
  transcript: string;
  pageState: unknown;
  conversationHistory: unknown[];
  clientContext?: unknown;
}

export interface BrainDeps {
  session?: Pick<EdgeSession, 'token'>;
  edgeUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  clientVersion?: string;
}

const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * `POST /v1/brain` through the edge proxy. The extension holds a session token,
 * never a provider key, and never talks to a provider directly.
 */
export async function requestBrain(
  request: BrainRequest,
  deps: BrainDeps,
  options: { signal?: AbortSignal } = {},
): Promise<ProcessCommandResponse> {
  const fetcher = deps.fetcher ?? ((input, init) => fetch(input, init));
  const edgeUrl = deps.edgeUrl.replace(/\/$/, '');
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  const token = deps.session ? await deps.session.token().catch(() => null) : null;
  if (deps.session && !token) {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    throw new BrainError('UNAUTHORIZED', 'Could not obtain an edge session');
  }

  const body = JSON.stringify({
    transcript: request.transcript,
    pageState: request.pageState,
    conversationHistory: request.conversationHistory,
    clientContext: request.clientContext ?? {
      client: 'extension',
      clientVersion: deps.clientVersion ?? '0.1.0',
      protocolVersion: '1.0.0',
    },
  });

  try {
    const response = await fetcher(`${edgeUrl}/v1/brain`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new BrainError('UNAUTHORIZED', 'Edge session rejected the request');
    }
    if (response.status === 429) {
      throw new BrainError('RATE_LIMITED', 'Too many requests');
    }
    if (response.status === 409) {
      throw new BrainError('UPSTREAM', 'Protocol version mismatch');
    }
    if (response.status === 504) {
      throw new BrainError('TIMEOUT', 'The assistant timed out');
    }
    if (!response.ok) {
      throw new BrainError('UPSTREAM', `Assistant returned HTTP ${response.status}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new BrainError('INVALID_RESPONSE', 'Assistant returned non-JSON output');
    }
    const parsed = ProcessCommandResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new BrainError('INVALID_RESPONSE', 'Assistant response failed protocol validation');
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof BrainError) throw error;
    if (controller.signal.aborted) {
      throw new BrainError(
        options.signal?.aborted ? 'ABORTED' : 'TIMEOUT',
        options.signal?.aborted ? 'The request was cancelled' : 'The assistant timed out',
      );
    }
    throw new BrainError('NETWORK', error instanceof Error ? error.message : 'Network failure');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
