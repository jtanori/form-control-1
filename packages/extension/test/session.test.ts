import { describe, expect, it, vi } from 'vitest';

import { EdgeSession, SessionError, type SessionStorage } from '../src/audio/session';

function memoryStorage(
  initial: Record<string, unknown> = {},
): SessionStorage & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (items) => {
      Object.assign(data, items);
    },
    remove: async (key) => {
      delete data[key];
    },
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('EdgeSession', () => {
  it('registers once and caches the token', async () => {
    const storage = memoryStorage();
    const fetcher = vi.fn(async () => json({ token: 't1', expiresAt: Date.now() + 86_400_000 }));
    const session = new EdgeSession({
      edgeUrl: 'http://edge.test/',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      storage,
      fetcher,
    });
    expect(await session.token()).toBe('t1');
    expect(await session.token()).toBe('t1');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0] as string).toBe('http://edge.test/v1/session');
    expect(storage.data.vfeSession).toMatchObject({ token: 't1' });
  });

  it('refreshes an expired token', async () => {
    const storage = memoryStorage({ vfeSession: { token: 'old', expiresAt: 1000 } });
    const fetcher = vi.fn(async () => json({ token: 'new', expiresAt: Date.now() + 86_400_000 }));
    const session = new EdgeSession({
      edgeUrl: 'http://edge.test',
      extensionId: 'id',
      storage,
      fetcher,
      now: () => 5000,
    });
    expect(await session.token()).toBe('new');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('surfaces registration failures as typed errors', async () => {
    const session = new EdgeSession({
      edgeUrl: 'http://edge.test',
      extensionId: 'id',
      storage: memoryStorage(),
      fetcher: async () => json({ code: 'NOT_CONFIGURED' }, 503),
    });
    await expect(session.token()).rejects.toBeInstanceOf(SessionError);
  });

  it('refreshes once and retries after a 401', async () => {
    const storage = memoryStorage();
    let sessions = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.endsWith('/v1/session')) {
        sessions += 1;
        return json({ token: `t${sessions}`, expiresAt: Date.now() + 86_400_000 });
      }
      return json({ ok: true });
    });
    const session = new EdgeSession({
      edgeUrl: 'http://edge.test',
      extensionId: 'id',
      storage,
      fetcher,
    });
    const first = await session.fetchWithAuth('http://edge.test/v1/stt');
    expect(first.status).toBe(200);

    // Force a 401: the next data call gets rejected once, then succeeds.
    let reject = true;
    const guarded = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/v1/session')) {
        sessions += 1;
        return json({ token: `t${sessions}`, expiresAt: Date.now() + 86_400_000 });
      }
      const auth = new Headers(init?.headers).get('authorization');
      if (reject) {
        reject = false;
        return json({ code: 'UNAUTHORIZED' }, 401, { 'x-seen': auth ?? '' });
      }
      return json({ ok: true });
    });
    const session2 = new EdgeSession({
      edgeUrl: 'http://edge.test',
      extensionId: 'id',
      storage,
      fetcher: guarded,
    });
    await session2.token();
    const response = await session2.fetchWithAuth('http://edge.test/v1/stt');
    expect(response.status).toBe(200);
    expect(guarded.mock.calls.filter(([url]) => String(url).endsWith('/v1/stt'))).toHaveLength(2);
  });
});
