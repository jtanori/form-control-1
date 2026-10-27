export interface SttResult {
  transcript: string;
  confidence?: number;
  provider: string;
  latencyMs: number;
  truncated: boolean;
}

export type SttErrorCode =
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'TOO_LONG'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'EMPTY_AUDIO'
  | 'ABORTED';

export class SttError extends Error {
  readonly code: SttErrorCode;
  readonly retryable: boolean;

  constructor(code: SttErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'SttError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface SttMetrics {
  encodeMs: number;
  uploadMs: number;
  providerMs: number;
  totalMs: number;
  bytes: number;
}

export interface SttOptions {
  language?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  onMetrics?: (metrics: SttMetrics) => void;
}

export interface AuthorizedSession {
  fetchWithAuth: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface SttDeps {
  session?: AuthorizedSession;
  edgeUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const UNSUPPORTED_STT_URL = 'http://localhost:8788';

let defaultSession: AuthorizedSession | null = null;
let defaultEdgeUrl = UNSUPPORTED_STT_URL;
let active: AbortController | null = null;

/** Wired once by the service worker after it builds the EdgeSession. */
export function configureStt(session: AuthorizedSession, edgeUrl: string): void {
  defaultSession = session;
  defaultEdgeUrl = edgeUrl.replace(/\/$/, '');
}

/** Test helper: clears module state between cases. */
export function resetSttForTests(): void {
  defaultSession = null;
  defaultEdgeUrl = UNSUPPORTED_STT_URL;
  active = null;
}

const NOISE = /^(\[.*\]|\(.*\)|thank you\.?|you\.?)$/i;

/** Deterministic post-processing; never rewrites semantics. */
export function normaliseTranscript(raw: string): { text: string; truncated: boolean } {
  let text = raw.trim().replace(/\s+/g, ' ');
  if (text.length < 2 || NOISE.test(text)) return { text: '', truncated: false };

  // Whisper sometimes repeats the same clause when it loses the thread.
  const repeated = /(.{20,}?)(?:\s+\1){2,}/.exec(text);
  if (repeated?.[1]) {
    text =
      `${text.slice(0, repeated.index)}${repeated[1]}${text.slice(repeated.index + repeated[0].length)}`.trim();
  }

  const truncated = text.length > 400 || text.endsWith('…');
  return { text, truncated };
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after');
  if (!header) return 300;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 300;
}

async function sleepDefault(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One in-flight transcription at a time; a newer utterance aborts the older
 * request instead of queueing a backlog.
 */
export async function transcribe(
  wav: ArrayBuffer,
  options: SttOptions = {},
  deps: SttDeps = {},
): Promise<SttResult> {
  const now = deps.now ?? (() => performance.now());
  const sleep = deps.sleep ?? sleepDefault;
  const started = now();

  if (wav.byteLength <= 44) {
    throw new SttError('EMPTY_AUDIO', 'Audio buffer is empty', false);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = options.timeoutMs ?? 6000;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort);

  const previous = active;
  active = controller;
  previous?.abort();

  const session = deps.session ?? defaultSession;
  const edgeUrl = (deps.edgeUrl ?? defaultEdgeUrl).replace(/\/$/, '');
  const retries = Math.max(0, options.retries ?? 1);

  try {
    if (!session) {
      throw new SttError('NETWORK', 'Edge session is not configured', true);
    }

    const form = new FormData();
    form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav');
    form.append('language', options.language ?? 'en');
    form.append('client', 'extension');

    let lastError: SttError | null = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await session.fetchWithAuth(`${edgeUrl}/v1/stt`, {
          method: 'POST',
          body: form,
          signal: controller.signal,
        });

        if (response.ok) {
          const body = (await response.json()) as {
            transcript?: string;
            confidence?: number;
            provider?: string;
          };
          const { text, truncated } = normaliseTranscript(body.transcript ?? '');
          if (!text) throw new SttError('EMPTY_AUDIO', 'Transcript was empty or noise', false);
          const totalMs = Math.round(now() - started);
          options.onMetrics?.({
            encodeMs: 0,
            uploadMs: 0,
            providerMs: totalMs,
            totalMs,
            bytes: wav.byteLength,
          });
          return {
            transcript: text,
            ...(typeof body.confidence === 'number' ? { confidence: body.confidence } : {}),
            provider: body.provider ?? 'edge',
            latencyMs: totalMs,
            truncated,
          };
        }

        if (response.status === 401) {
          throw new SttError('UNAUTHORIZED', 'Edge session was rejected', false);
        }
        if (response.status === 413 || response.status === 422) {
          const payload = (await response.json().catch(() => ({}))) as { code?: string };
          throw new SttError(
            payload.code === 'AUDIO_TOO_LONG' ? 'TOO_LONG' : 'PROVIDER_ERROR',
            payload.code ?? `Edge rejected the audio (HTTP ${response.status})`,
            false,
          );
        }
        if (response.status === 429) {
          lastError = new SttError('RATE_LIMITED', 'Rate limited by the edge proxy', true);
          if (attempt < retries) {
            await sleep(retryAfterMs(response));
            continue;
          }
          throw lastError;
        }
        lastError = new SttError(
          'PROVIDER_ERROR',
          `Edge returned HTTP ${response.status}`,
          response.status >= 500,
        );
        if (lastError.retryable && attempt < retries) {
          await sleep(300);
          continue;
        }
        throw lastError;
      } catch (error) {
        if (error instanceof SttError) {
          if (!error.retryable || attempt >= retries) throw error;
          lastError = error;
          await sleep(300);
          continue;
        }
        if (controller.signal.aborted) {
          throw timedOut
            ? new SttError('TIMEOUT', `Transcription timed out after ${timeoutMs} ms`, false)
            : new SttError('ABORTED', 'Transcription was superseded', false);
        }
        lastError = new SttError(
          'NETWORK',
          error instanceof Error ? error.message : 'Network failed',
          true,
        );
        if (attempt >= retries) throw lastError;
        await sleep(300);
      }
    }
    throw lastError ?? new SttError('PROVIDER_ERROR', 'Transcription failed', false);
  } catch (error) {
    if (error instanceof SttError) throw error;
    if (controller.signal.aborted) {
      throw timedOut
        ? new SttError('TIMEOUT', 'Transcription timed out', false)
        : new SttError('ABORTED', 'Transcription was superseded', false);
    }
    throw new SttError(
      'NETWORK',
      error instanceof Error ? error.message : 'Transcription failed',
      false,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
    if (active === controller) active = null;
  }
}

export function isTranscribing(): boolean {
  return active !== null;
}
