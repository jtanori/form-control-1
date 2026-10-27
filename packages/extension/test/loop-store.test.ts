import type { PageState } from '@vfe/protocol';
import { describe, expect, it } from 'vitest';

import { LoopStore, LOOP_STORE_KEY } from '../src/background/loop-store';

const page = (title: string): PageState => ({ urlOrAppTitle: title, elements: [] });

function memoryStorage(): {
  data: Record<string, unknown>;
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
} {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    set: async (items) => {
      Object.assign(data, items);
    },
  };
}

describe('LoopStore', () => {
  it('arms a generation with the page state and keeps history across activations', async () => {
    const storage = memoryStorage();
    const store = new LoopStore(storage, () => 1000);
    await store.arm(7, 1, page('Checkout'));
    await store.appendTurn(7, 'user', 'fill my name');
    const next = await store.arm(7, 2, page('Checkout step 2'));
    expect(next.generation).toBe(2);
    expect(next.history.map((turn) => turn.text)).toEqual(['fill my name']);
    expect(next.pageState.urlOrAppTitle).toBe('Checkout step 2');
  });

  it('ignores a page state from a stale generation', async () => {
    const store = new LoopStore(memoryStorage(), () => 1000);
    await store.arm(7, 3, page('Fresh'));
    await store.updatePageState(7, 2, page('Stale'));
    const entry = await store.get(7);
    expect(entry?.pageState.urlOrAppTitle).toBe('Fresh');
  });

  it('accepts a page state from the armed generation', async () => {
    const store = new LoopStore(memoryStorage(), () => 1000);
    await store.arm(7, 3, page('Fresh'));
    await store.updatePageState(7, 3, page('Updated'));
    expect((await store.get(7))?.pageState.urlOrAppTitle).toBe('Updated');
  });

  it('clears a tab on navigation and returns null for unknown tabs', async () => {
    const storage = memoryStorage();
    const store = new LoopStore(storage, () => 1000);
    await store.arm(7, 1, page('A'));
    await store.clear(7);
    expect(await store.get(7)).toBeNull();
    expect(storage.data[LOOP_STORE_KEY]).toEqual({});
  });

  it('prunes expired history when reading', async () => {
    let now = 1000;
    const store = new LoopStore(memoryStorage(), () => now);
    await store.arm(9, 1, page('A'));
    await store.appendTurn(9, 'user', 'old turn');
    now += 11 * 60_000;
    expect((await store.get(9))?.history).toEqual([]);
  });

  it('keeps at most eight tabs', async () => {
    const storage = memoryStorage();
    const store = new LoopStore(storage, () => 1000);
    for (let tab = 0; tab < 12; tab += 1) await store.arm(tab, 1, page(`tab ${tab}`));
    const stored = storage.data[LOOP_STORE_KEY] as Record<string, unknown>;
    expect(Object.keys(stored).length).toBeLessThanOrEqual(8);
  });
});
