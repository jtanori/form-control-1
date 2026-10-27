import { describe, expect, it, vi } from 'vitest';

import { BrainError, requestBrain } from '../src/net/brain';

const okBody = {
  brainResponse: {
    thoughtProcess: 'fill',
    actions: [{ action: 'FILL', targetId: 'vfe_1', value: 'Ada' }],
  },
  meta: { provider: 'openai', model: 'gpt-4o', latencyMs: 12, requestId: 'r1' },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const request = {
  transcript: 'fill my name',
  pageState: { elements: [] },
  conversationHistory: [],
};

describe('requestBrain', () => {
  it('posts to /v1/brain with the session token and validates the envelope', async () => {
    const fetcher = vi.fn(async () => jsonResponse(okBody));
    const session = { token: vi.fn(async () => 'tok_123') };
    const response = await requestBrain(request, {
      edgeUrl: 'http://localhost:8788/',
      session,
      fetcher,
    });
    expect(response.brainResponse.actions).toHaveLength(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:8788/v1/brain');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok_123');
    const body = JSON.parse(String(init.body));
    expect(body.transcript).toBe('fill my name');
    expect(body.clientContext).toMatchObject({ client: 'extension', protocolVersion: '1.0.0' });
  });

  it('maps 401 to UNAUTHORIZED', async () => {
    const fetcher = vi.fn(async () => jsonResponse({}, 401));
    await expect(requestBrain(request, { edgeUrl: 'http://x', fetcher })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('maps 429 to RATE_LIMITED and 504 to TIMEOUT', async () => {
    await expect(
      requestBrain(request, {
        edgeUrl: 'http://x',
        fetcher: vi.fn(async () => jsonResponse({}, 429)),
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(
      requestBrain(request, {
        edgeUrl: 'http://x',
        fetcher: vi.fn(async () => jsonResponse({}, 504)),
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('rejects a malformed envelope as INVALID_RESPONSE', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ brainResponse: { actions: 'nope' } }));
    await expect(requestBrain(request, { edgeUrl: 'http://x', fetcher })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects non-JSON output', async () => {
    const fetcher = vi.fn(async () => new Response('<html>', { status: 200 }));
    await expect(requestBrain(request, { edgeUrl: 'http://x', fetcher })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('reports a network failure', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(requestBrain(request, { edgeUrl: 'http://x', fetcher })).rejects.toMatchObject({
      code: 'NETWORK',
    });
  });

  it('aborts with the caller signal', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = requestBrain(
      request,
      { edgeUrl: 'http://x', fetcher: fetcher as unknown as typeof fetch },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(BrainError);
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('fails fast when the edge session cannot be issued', async () => {
    const fetcher = vi.fn();
    await expect(
      requestBrain(request, {
        edgeUrl: 'http://x',
        session: { token: vi.fn(async () => Promise.reject(new Error('nope'))) },
        fetcher,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
