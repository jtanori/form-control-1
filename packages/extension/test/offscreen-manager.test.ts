import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OffscreenManager } from '../src/background/offscreen-manager';

function fakeApi(has = false) {
  let doc = has;
  return {
    hasDocument: vi.fn(async () => doc),
    createDocument: vi.fn(async () => {
      doc = true;
    }),
    closeDocument: vi.fn(async () => {
      doc = false;
    }),
    get open() {
      return doc;
    },
  };
}

describe('OffscreenManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates exactly one document for concurrent ensure() calls', async () => {
    const api = fakeApi();
    const manager = new OffscreenManager(api);
    const results = await Promise.all([manager.ensure(), manager.ensure(), manager.ensure()]);
    expect(api.createDocument).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result === 'created')).toHaveLength(1);
    expect(manager.documentsCreated).toBe(1);
  });

  it('reuses an existing document', async () => {
    const api = fakeApi(true);
    const manager = new OffscreenManager(api);
    expect(await manager.ensure()).toBe('existing');
    expect(api.createDocument).not.toHaveBeenCalled();
  });

  it('closes the document after the idle timeout', async () => {
    const api = fakeApi(true);
    const manager = new OffscreenManager(api, { idleMs: 5000 });
    manager.scheduleIdleClose();
    expect(manager.idleScheduled).toBe(true);
    await vi.advanceTimersByTimeAsync(4999);
    expect(api.closeDocument).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.closeDocument).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending idle close when listening restarts', async () => {
    const api = fakeApi(true);
    const manager = new OffscreenManager(api, { idleMs: 5000 });
    manager.scheduleIdleClose();
    expect(await manager.ensure()).toBe('existing');
    expect(manager.idleScheduled).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.closeDocument).not.toHaveBeenCalled();
  });
});
