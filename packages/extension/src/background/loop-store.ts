import type { ConversationTurn, PageState } from '@vfe/protocol';

import { appendTurn, pruneHistory } from '../loop/history';

export interface LoopStorageApi {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

export interface TabLoopState {
  generation: number;
  pageState: PageState | null;
  history: ConversationTurn[];
  updatedAt: number;
}

export const LOOP_STORE_KEY = 'vfeLoopState';
const MAX_TABS = 8;

/**
 * The service worker is ephemeral, so the loop's shared state lives in
 * `chrome.storage.session`: the armed generation per tab, the freshest page
 * state and the conversation history (capped and expiring).
 */
export class LoopStore {
  private readonly storage: LoopStorageApi;
  private readonly now: () => number;

  constructor(storage: LoopStorageApi, now: () => number = Date.now) {
    this.storage = storage;
    this.now = now;
  }

  private async readAll(): Promise<Record<string, TabLoopState>> {
    try {
      const stored = await this.storage.get(LOOP_STORE_KEY);
      const value = stored[LOOP_STORE_KEY];
      return value && typeof value === 'object' ? (value as Record<string, TabLoopState>) : {};
    } catch {
      return {};
    }
  }

  private async write(all: Record<string, TabLoopState>): Promise<void> {
    const entries = Object.entries(all)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_TABS);
    try {
      await this.storage.set({ [LOOP_STORE_KEY]: Object.fromEntries(entries) });
    } catch {
      // Storage can be unavailable while the worker shuts down.
    }
  }

  async arm(tabId: number, generation: number, pageState: PageState): Promise<TabLoopState> {
    const all = await this.readAll();
    const previous = all[tabId];
    const next: TabLoopState = {
      generation,
      pageState,
      history: previous ? pruneHistory(previous.history, this.now()) : [],
      updatedAt: this.now(),
    };
    all[tabId] = next;
    await this.write(all);
    return next;
  }

  async updatePageState(tabId: number, generation: number, pageState: PageState): Promise<void> {
    const all = await this.readAll();
    const entry = all[tabId];
    // Only the armed generation may update the snapshot: a stale tab must not
    // overwrite the page the user is actually talking about.
    if (!entry || entry.generation !== generation) return;
    all[tabId] = { ...entry, pageState, updatedAt: this.now() };
    await this.write(all);
  }

  async get(tabId: number): Promise<TabLoopState | null> {
    const all = await this.readAll();
    const entry = all[tabId];
    if (!entry) return null;
    const history = pruneHistory(entry.history ?? [], this.now());
    return { ...entry, history };
  }

  async appendTurn(tabId: number, role: ConversationTurn['role'], text: string): Promise<void> {
    const all = await this.readAll();
    const entry = all[tabId];
    if (!entry) return;
    all[tabId] = {
      ...entry,
      history: appendTurn(entry.history ?? [], role, text, this.now()),
      updatedAt: this.now(),
    };
    await this.write(all);
  }

  async clear(tabId: number): Promise<void> {
    const all = await this.readAll();
    if (!(tabId in all)) return;
    delete all[tabId];
    await this.write(all);
  }
}
