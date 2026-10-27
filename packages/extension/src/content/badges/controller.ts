import { findByVfeId } from '@vfe/dom-engine';
import type { PageState } from '@vfe/protocol';

import { placeBadge, transformFor, type RectLike, type Viewport } from './position';
import { createScheduler, type Scheduler } from './scheduler';

export type BadgeResult = 'ok' | 'error';

export type BadgeMode = 'scroll-listener' | 'no-listener';

export interface BadgeController {
  /** Replace the badge set from a distilled page state. */
  sync: (pageState: PageState) => void;
  /** Momentarily highlight a badge (green) — driven by B-3's action events. */
  flash: (vfeId: string, result?: BadgeResult) => void;
  /** Pause all repositioning (e.g. while the tab is hidden). */
  setEnabled: (enabled: boolean) => void;
  /** Force one reposition pass now (tests, tab visibility). */
  reposition: () => void;
  destroy: () => void;
  /** Which repositioning strategy this instance chose at mount. */
  getMode: () => BadgeMode;
  /** Test-only counters proving the read/write split. */
  debugStats: () => { reads: number; writes: number };
}

export interface BadgeControllerOptions {
  layer: HTMLElement;
  doc?: Document;
  /** Hard cap; matches A-1's `maxElements`. */
  maxBadges?: number;
  flashMs?: number;
  /** `auto` picks `no-listener` for pages that cannot scroll (SPA shells). */
  mode?: BadgeMode | 'auto';
}

interface BadgeNode {
  id: string;
  index: number;
  state: string;
  node: HTMLDivElement;
  element: HTMLElement | null;
}

const MAX_BADGES = 250;

export function createBadgeController(options: BadgeControllerOptions): BadgeController {
  const doc = options.doc ?? document;
  const layer = options.layer;
  const maxBadges = Math.min(options.maxBadges ?? MAX_BADGES, MAX_BADGES);
  const flashMs = options.flashMs ?? 900;
  const entries = new Map<string, BadgeNode>();
  const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const stats = { reads: 0, writes: 0 };
  const abort = new AbortController();
  let enabled = true;
  let destroyed = false;

  /**
   * Badge nodes carry `data-vfe-id` for tests, so the overlay is part of the
   * search space. A hit inside our own layer means the real element is gone —
   * `findByVfeId` searches the document before any shadow root.
   */
  const resolveElement = (id: string): HTMLElement | null => {
    const found = findByVfeId(id, doc);
    return found && !layer.contains(found) ? found : null;
  };

  const position = (): void => {
    if (destroyed || !enabled) return;
    const viewport: Viewport = {
      width: doc.defaultView?.innerWidth ?? 1024,
      height: doc.defaultView?.innerHeight ?? 768,
    };

    // Read phase: every rect is collected before a single style is written.
    const reads: Array<{ entry: BadgeNode; rect: RectLike | null }> = [];
    for (const entry of entries.values()) {
      stats.reads += 1;
      const element = entry.element?.isConnected
        ? entry.element
        : (entry.element = resolveElement(entry.id));
      if (!element) {
        reads.push({ entry, rect: null });
        continue;
      }
      const rect = element.getBoundingClientRect();
      reads.push({
        entry,
        rect: {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        },
      });
    }

    // Write phase: transforms and visibility only, no layout reads.
    for (const { entry, rect } of reads) {
      const placement = rect ? placeBadge(rect, viewport) : { x: 0, y: 0, visible: false };
      if (!placement.visible) {
        stats.writes += 1;
        entry.node.dataset.visible = 'false';
        continue;
      }
      stats.writes += 1;
      entry.node.dataset.visible = 'true';
      entry.node.style.transform = transformFor(placement.x, placement.y);
    }
  };

  const scheduler: Scheduler = createScheduler(position);

  const schedule = (): void => {
    if (!enabled || destroyed) return;
    if (doc.hidden) return;
    scheduler.schedule();
  };

  const setState = (entry: BadgeNode, next: string): void => {
    if (entry.state === next) return;
    entry.state = next;
    entry.node.dataset.state = next;
  };

  const createNode = (id: string, index: number): HTMLDivElement => {
    const node = doc.createElement('div');
    node.className = 'badge';
    node.dataset.vfeId = id;
    node.dataset.badgeIndex = String(index);
    node.dataset.state = 'default';
    node.dataset.visible = 'false';
    node.textContent = String(index);
    node.setAttribute('aria-hidden', 'true');
    return node;
  };

  const sync = (pageState: PageState): void => {
    if (destroyed) return;
    const desired = pageState.elements.slice(0, maxBadges);
    const desiredIds = new Set(desired.map((element) => element.id));
    let changed = false;

    for (const [id, entry] of entries) {
      if (desiredIds.has(id)) continue;
      entry.node.remove();
      entries.delete(id);
      changed = true;
    }

    for (const element of desired) {
      const existing = entries.get(element.id);
      const state =
        element.disabled === true
          ? 'disabled'
          : element.validationError
            ? 'error'
            : element.focused === true
              ? 'focused'
              : 'default';

      if (!existing) {
        const node = createNode(element.id, element.badgeIndex);
        node.dataset.state = state;
        layer.append(node);
        entries.set(element.id, {
          id: element.id,
          index: element.badgeIndex,
          state,
          node,
          element: resolveElement(element.id),
        });
        changed = true;
        continue;
      }

      if (existing.index !== element.badgeIndex) {
        existing.index = element.badgeIndex;
        existing.node.textContent = String(element.badgeIndex);
        existing.node.dataset.badgeIndex = String(element.badgeIndex);
        changed = true;
      }
      if (existing.state !== state) {
        setState(existing, state);
        changed = true;
      }
    }

    // Hot path during `watchPage` bursts: an identical state must not touch the DOM.
    if (!changed) return;
    schedule();
  };

  const flash = (vfeId: string, result: BadgeResult = 'ok'): void => {
    const entry = entries.get(vfeId);
    if (!entry || destroyed) return;
    const existing = flashTimers.get(vfeId);
    if (existing) clearTimeout(existing);
    setState(entry, result === 'ok' ? 'active' : 'error');
    flashTimers.set(
      vfeId,
      setTimeout(() => {
        flashTimers.delete(vfeId);
        const current = entries.get(vfeId);
        if (current) setState(current, 'default');
      }, flashMs),
    );
  };

  const onVisibility = (): void => {
    if (doc.hidden) {
      scheduler.cancel();
      return;
    }
    position();
  };

  const view = doc.defaultView;
  const canScroll = (): boolean => {
    const scrolling = doc.scrollingElement ?? doc.documentElement;
    if (!scrolling) return true;
    return scrolling.scrollHeight > (view?.innerHeight ?? 0) + 1;
  };
  const mode: BadgeMode =
    options.mode && options.mode !== 'auto'
      ? options.mode
      : canScroll()
        ? 'scroll-listener'
        : 'no-listener';

  // A page that cannot scroll still moves: accordions, sheets and re-renders.
  const poll = mode === 'no-listener' ? setInterval(() => schedule(), 1000) : null;

  view?.addEventListener('scroll', schedule, {
    passive: true,
    capture: true,
    signal: abort.signal,
  });
  view?.addEventListener('resize', schedule, { passive: true, signal: abort.signal });
  doc.addEventListener('focusin', schedule, { signal: abort.signal });
  doc.addEventListener('keydown', schedule, { signal: abort.signal, capture: true });
  doc.addEventListener('transitionend', schedule, { signal: abort.signal, capture: true });
  doc.addEventListener('animationend', schedule, { signal: abort.signal, capture: true });
  doc.addEventListener('visibilitychange', onVisibility, { signal: abort.signal });

  return {
    sync,
    flash,
    setEnabled: (next: boolean) => {
      enabled = next;
      if (!next) scheduler.cancel();
      else scheduler.schedule();
    },
    reposition: () => {
      if (enabled) position();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      abort.abort();
      scheduler.cancel();
      if (poll) clearInterval(poll);
      for (const timer of flashTimers.values()) clearTimeout(timer);
      flashTimers.clear();
      for (const entry of entries.values()) entry.node.remove();
      entries.clear();
    },
    getMode: () => mode,
    debugStats: () => ({ ...stats }),
  };
}
