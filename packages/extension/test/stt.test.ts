import { afterEach, describe, expect, it, vi } from 'vitest';

import { EdgeSession } from '../src/audio/session';
import {
  normaliseTranscript,
  resetSttForTests,
  transcribe,
  type AuthorizedSession,
  type SttMetrics,
} from '../src/audio/stt';

const WAV = new ArrayBuffer(44 + 3200);

function fakeSession(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const session: AuthorizedSession = {
    fetchWithAuth: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
  };
  return { session, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const fastSleep = async (): Promise<void> => undefined;

afterEach(() => {
  resetSttForTests();
});

describe('transcribe', () => {
  it('returns a result with latency and metrics on the happy path', async () => {
    const metrics: SttMetrics[] = [];
    const { session } = fakeSession(async () =>
      json({ transcript: 'hello there', provider: 'groq' }),
    );
    const result = await transcribe(
      WAV,
      { onMetrics: (value) => metrics.push(value) },
      { session, edgeUrl: 'http://edge.test' },
    );
    expect(result.transcript).toBe('hello there');
    expect(result.provider).toBe('groq');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.truncated).toBe(false);
    expect(metrics[0]).toMatchObject({ bytes: WAV.byteLength });
    expect(metrics[0]?.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('refreshes the session once and retries when the edge returns 401', async () => {
    let sttCalls = 0;
    let sessionCalls = 0;
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (String(input).endsWith('/v1/session')) {
        sessionCalls += 1;
        return json({ token: `t${sessionCalls}`, expiresAt: Date.now() + 86_400_000 });
      }
      sttCalls += 1;
      const auth = new Headers(init?.headers).get('authorization');
      return sttCalls === 1
        ? json({ code: 'UNAUTHORIZED' }, 401, { 'x-auth': auth ?? '' })
        : json({ transcript: 'recovered' });
    });
    const storage = {
      get: async () => ({}),
      set: async () => undefined,
    };
    const session = new EdgeSession({
      edgeUrl: 'http://edge.test',
      extensionId: 'id',
      storage,
      fetcher: fetcher as unknown as typeof fetch,
    });
    const result = await transcribe(
      WAV,
      {},
      { session, edgeUrl: 'http://edge.test', sleep: fastSleep },
    );
    expect(result.transcript).toBe('recovered');
    expect(sttCalls).toBe(2);
    expect(sessionCalls).toBe(2);
  });

  it('honours Retry-After on 429 and retries once', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const { session } = fakeSession(async () => {
      calls += 1;
      if (calls === 1) return json({ code: 'RATE_LIMITED' }, 429, { 'retry-after': '1' });
      return json({ transcript: 'after wait' });
    });
    const result = await transcribe(
      WAV,
      {},
      {
        session,
        edgeUrl: 'http://edge.test',
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    expect(result.transcript).toBe('after wait');
    expect(sleeps).toEqual([1000]);
    expect(calls).toBe(2);
  });

  it('does not retry a 400 validation error', async () => {
    const { session, calls } = fakeSession(async () => json({ code: 'INVALID_REQUEST' }, 400));
    await expect(
      transcribe(WAV, {}, { session, edgeUrl: 'http://edge.test', sleep: fastSleep }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
    expect(calls).toHaveLength(1);
  });

  it('maps audio-too-long to TOO_LONG without retrying', async () => {
    const { session, calls } = fakeSession(async () => json({ code: 'AUDIO_TOO_LONG' }, 422));
    await expect(
      transcribe(WAV, {}, { session, edgeUrl: 'http://edge.test', sleep: fastSleep }),
    ).rejects.toMatchObject({ code: 'TOO_LONG' });
    expect(calls).toHaveLength(1);
  });

  it('rejects with TIMEOUT when the request hangs', async () => {
    const { session } = fakeSession(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    await expect(
      transcribe(WAV, { timeoutMs: 20, retries: 0 }, { session, edgeUrl: 'http://edge.test' }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('aborts the older request when a new utterance arrives', async () => {
    let releaseFirst: (() => void) | undefined;
    const { session } = fakeSession(
      (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          releaseFirst = () => resolve(json({ transcript: 'first' }));
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const first = transcribe(WAV, { retries: 0 }, { session, edgeUrl: 'http://edge.test' });
    const second = transcribe(WAV, { retries: 0 }, { session, edgeUrl: 'http://edge.test' });
    await expect(first).rejects.toMatchObject({ code: 'ABORTED' });
    releaseFirst?.();
    void second.catch(() => undefined);
  });

  it('rejects empty audio before any network call', async () => {
    const { session, calls } = fakeSession(async () => json({ transcript: 'x' }));
    await expect(
      transcribe(new ArrayBuffer(0), {}, { session, edgeUrl: 'http://edge.test' }),
    ).rejects.toMatchObject({ code: 'EMPTY_AUDIO' });
    expect(calls).toHaveLength(0);
  });

  it('drops noise and hallucinated silence', async () => {
    for (const transcript of ['', '[BLANK_AUDIO]', 'Thank you.', '(silence)']) {
      const { session } = fakeSession(async () => json({ transcript }));
      await expect(
        transcribe(WAV, {}, { session, edgeUrl: 'http://edge.test', sleep: fastSleep }),
      ).rejects.toMatchObject({ code: 'EMPTY_AUDIO' });
    }
    expect(normaliseTranscript('  ').text).toBe('');
  });
});

describe('normaliseTranscript', () => {
  it('collapses whitespace without changing semantics', () => {
    expect(normaliseTranscript('  john   at  gmail dot com ').text).toBe('john at gmail dot com');
  });

  it('does not rewrite dictated values', () => {
    expect(normaliseTranscript('john at gmail dot com').text).toBe('john at gmail dot com');
    expect(normaliseTranscript('john at gmail dot com').text).not.toContain('@');
  });

  it('strips a repeated hallucination block', () => {
    const text =
      'Please read the terms and conditions carefully. Please read the terms and conditions carefully. Please read the terms and conditions carefully.';
    const result = normaliseTranscript(text);
    expect(result.text.match(/Please read the terms/g)).toHaveLength(1);
  });

  it('marks long or ellipsis-ended transcripts as truncated', () => {
    expect(normaliseTranscript(`${'a'.repeat(200)}${'b'.repeat(201)}`).truncated).toBe(true);
    expect(normaliseTranscript('I was going to say…').truncated).toBe(true);
    expect(normaliseTranscript('Short and complete.').truncated).toBe(false);
  });
});
