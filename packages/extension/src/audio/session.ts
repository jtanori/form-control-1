export interface SessionStorage {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove?: (key: string) => Promise<void>;
}

export interface EdgeSessionOptions {
  edgeUrl: string;
  extensionId: string;
  storage: SessionStorage;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export interface CachedSession {
  token: string;
  expiresAt: number;
}

export class SessionError extends Error {
  readonly code: 'UNAUTHORIZED' | 'NETWORK';

  constructor(code: 'UNAUTHORIZED' | 'NETWORK', message: string) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

const SESSION_KEY = 'vfeSession';
const REFRESH_MARGIN_MS = 60_000;

/**
 * Registration + token cache for the C-3 edge proxy. The extension never holds
 * a provider key — this is the only credential it has, and it never touches
 * `chrome.storage.sync`.
 */
export class EdgeSession {
  private readonly edgeUrl: string;
  private readonly extensionId: string;
  private readonly storage: SessionStorage;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private inflight: Promise<CachedSession> | null = null;
  private memory: CachedSession | null = null;

  constructor(options: EdgeSessionOptions) {
    this.edgeUrl = options.edgeUrl.replace(/\/$/, '');
    this.extensionId = options.extensionId;
    this.storage = options.storage;
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async token(forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      const cached = await this.readCache();
      if (cached && cached.expiresAt - REFRESH_MARGIN_MS > this.now()) return cached.token;
    }
    const session = await this.refresh();
    return session.token;
  }

  private async readCache(): Promise<CachedSession | null> {
    if (this.memory && this.memory.expiresAt > this.now()) return this.memory;
    try {
      const stored = await this.storage.get(SESSION_KEY);
      const value = stored[SESSION_KEY] as Partial<CachedSession> | undefined;
      if (typeof value?.token === 'string' && typeof value.expiresAt === 'number') {
        this.memory = { token: value.token, expiresAt: value.expiresAt };
        return this.memory;
      }
    } catch {
      // Storage can be unavailable in tests or during shutdown.
    }
    return null;
  }

  private async refresh(): Promise<CachedSession> {
    if (this.inflight) return this.inflight;
    this.inflight = this.register().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async register(): Promise<CachedSession> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.edgeUrl}/v1/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ extensionId: this.extensionId }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new SessionError(
          'UNAUTHORIZED',
          `Session registration failed with HTTP ${response.status}`,
        );
      }
      const body = (await response.json()) as Partial<CachedSession>;
      if (typeof body.token !== 'string' || typeof body.expiresAt !== 'number') {
        throw new SessionError('UNAUTHORIZED', 'Session registration returned an invalid body');
      }
      const session: CachedSession = { token: body.token, expiresAt: body.expiresAt };
      this.memory = session;
      await this.storage.set({ [SESSION_KEY]: session });
      return session;
    } catch (error) {
      if (error instanceof SessionError) throw error;
      const message = error instanceof Error ? error.message : 'Session registration failed';
      throw new SessionError('NETWORK', message);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Authenticated fetch with exactly one refresh-and-retry on 401. */
  async fetchWithAuth(input: string, init: RequestInit = {}): Promise<Response> {
    const attempt = async (forceRefresh: boolean): Promise<Response> => {
      const token = await this.token(forceRefresh);
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${token}`);
      return this.fetcher(input, { ...init, headers });
    };
    const response = await attempt(false);
    if (response.status !== 401) return response;
    return attempt(true);
  }

  async clear(): Promise<void> {
    this.memory = null;
    try {
      await this.storage.remove?.(SESSION_KEY);
    } catch {
      // Ignore storage failures during shutdown.
    }
  }
}
