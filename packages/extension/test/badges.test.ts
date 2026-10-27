import type { FormElement, PageState } from '@vfe/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBadgeController } from '../src/content/badges/controller';
import { destroyBadges, mountBadges } from '../src/content/badges/mount';
import { placeBadge } from '../src/content/badges/position';
import { createScheduler } from '../src/content/badges/scheduler';

function element(index: number, overrides: Partial<FormElement> = {}): FormElement {
  return {
    id: `vfe_${index}`,
    badgeIndex: index,
    type: 'text',
    label: `Field ${index}`,
    value: '',
    required: false,
    disabled: false,
    focused: false,
    ...overrides,
  };
}

function state(elements: FormElement[]): PageState {
  return { urlOrAppTitle: 'Badge test', elements };
}

/** A real DOM node carrying the A-1 marker, with a synthetic layout box. */
function control(id: string, rect = { top: 100, left: 50, width: 200, height: 30 }): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('data-vfe-id', id);
  document.body.append(input);
  Object.defineProperty(input, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: rect.top,
      bottom: rect.top + rect.height,
      left: rect.left,
      right: rect.left + rect.width,
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  });
  return input;
}

function layer(): HTMLElement {
  const host = document.querySelector('vfe-badges');
  const node = host?.shadowRoot?.querySelector('[data-vfe-badge-layer]') as HTMLElement | null;
  expect(node).toBeTruthy();
  return node as HTMLElement;
}

function badges(): HTMLElement[] {
  return Array.from(layer().querySelectorAll<HTMLElement>('.badge'));
}

/** MutationObserver callbacks are microtasks; fake timers keep them flushed. */
const tick = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => undefined);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  destroyBadges();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('sync', () => {
  it('creates one numbered badge per element', () => {
    const controller = mountBadges();
    for (let index = 1; index <= 5; index += 1) control(`vfe_${index}`);
    controller.sync(state([1, 2, 3, 4, 5].map((index) => element(index))));
    controller.reposition();

    const nodes = badges();
    expect(nodes).toHaveLength(5);
    expect(nodes.map((node) => node.textContent)).toEqual(['1', '2', '3', '4', '5']);
    expect(nodes.map((node) => node.dataset.visible)).toEqual([
      'true',
      'true',
      'true',
      'true',
      'true',
    ]);
    expect(nodes[0]?.dataset.vfeId).toBe('vfe_1');
    expect(nodes[0]?.dataset.badgeIndex).toBe('1');
  });

  it('diffs by id instead of rebuilding', async () => {
    const controller = mountBadges();
    control('vfe_1');
    control('vfe_2');
    controller.sync(state([element(1), element(2)]));
    controller.reposition();

    const firstNode = badges()[0];
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(layer(), {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
    });

    // Identical state: the hot path must not touch the DOM at all.
    controller.sync(state([element(1), element(2)]));
    await tick();
    expect(mutations).toHaveLength(0);

    controller.sync(state([element(1), element(2), element(3)]));
    await tick();
    expect(badges()).toHaveLength(3);
    expect(badges()[0]).toBe(firstNode);

    controller.sync(state([element(2), element(3)]));
    await tick();
    expect(badges()).toHaveLength(2);
    expect(badges().map((node) => node.dataset.vfeId)).toEqual(['vfe_2', 'vfe_3']);

    observer.disconnect();
  });

  it('renumbers without replacing the node', () => {
    const controller = mountBadges();
    control('vfe_1');
    control('vfe_2');
    controller.sync(state([element(1), element(2)]));
    const node = badges()[1];
    controller.sync(state([element(1), element(2, { badgeIndex: 9 })]));
    expect(badges()[1]).toBe(node);
    expect(node?.textContent).toBe('9');
  });

  it('reflects disabled, error and focused states', () => {
    const controller = mountBadges();
    control('vfe_1');
    control('vfe_2');
    control('vfe_3');
    controller.sync(
      state([
        element(1, { disabled: true }),
        element(2, { validationError: 'Required' }),
        element(3, { focused: true }),
      ]),
    );
    expect(badges().map((node) => node.dataset.state)).toEqual(['disabled', 'error', 'focused']);
  });

  it('caps the badge count at 250', () => {
    const controller = mountBadges();
    const elements = Array.from({ length: 300 }, (_, index) => element(index + 1));
    controller.sync(state(elements));
    expect(badges()).toHaveLength(250);
  });
});

describe('positioning', () => {
  it('clamps a badge to the viewport edges', () => {
    const placement = placeBadge(
      { top: 100, bottom: 130, left: -50, right: 10, width: 60, height: 30 },
      { width: 1024, height: 768 },
    );
    expect(placement).toEqual({ x: 2, y: 90, visible: true });
  });

  it('hides offscreen badges without writing a transform', () => {
    const controller = mountBadges();
    control('vfe_1', { top: 2000, left: 10, width: 100, height: 30 });
    controller.sync(state([element(1)]));
    controller.reposition();
    const node = badges()[0];
    expect(node?.dataset.visible).toBe('false');
    expect(node?.style.transform).toBe('');
  });

  it('re-resolves an element that was detached and re-added', () => {
    const controller = mountBadges();
    const input = control('vfe_1');
    controller.sync(state([element(1)]));
    controller.reposition();
    expect(badges()[0]?.dataset.visible).toBe('true');

    input.remove();
    controller.reposition();
    expect(badges()[0]?.dataset.visible).toBe('false');

    const replacement = control('vfe_1', { top: 200, left: 20, width: 100, height: 30 });
    expect(replacement.isConnected).toBe(true);
    controller.reposition();
    expect(badges()[0]?.dataset.visible).toBe('true');
    expect(badges()[0]?.style.transform).toBe('translate3d(10px, 190px, 0)');
  });

  it('separates every rect read from every style write', () => {
    const controller = mountBadges();
    const inputs = [1, 2, 3].map((index) => control(`vfe_${index}`));
    const writesDuringReads: number[] = [];
    for (const input of inputs) {
      const original = input.getBoundingClientRect.bind(input);
      Object.defineProperty(input, 'getBoundingClientRect', {
        configurable: true,
        value: () => {
          writesDuringReads.push(controller.debugStats().writes);
          return original();
        },
      });
    }
    controller.sync(state([element(1), element(2), element(3)]));
    controller.reposition();
    expect(writesDuringReads).toHaveLength(3);
    expect(writesDuringReads).toEqual([0, 0, 0]);
  });

  it('does nothing while disabled', () => {
    const controller = mountBadges();
    const input = control('vfe_1');
    controller.sync(state([element(1)]));
    controller.reposition();
    const before = badges()[0]?.style.transform;
    controller.setEnabled(false);
    input.setAttribute('data-moved', 'true');
    controller.reposition();
    expect(badges()[0]?.style.transform).toBe(before);
  });
});

describe('modes', () => {
  it('chooses no-listener mode for a page that cannot scroll', () => {
    const controller = mountBadges();
    expect(controller.getMode()).toBe('no-listener');
  });

  it('polls once a second in no-listener mode', async () => {
    const controller = mountBadges();
    control('vfe_1', { top: 100, left: 10, width: 100, height: 30 });
    controller.sync(state([element(1)]));
    controller.reposition();
    const before = badges()[0]?.style.transform;

    // No scroll event, no resize: only the poll can move the badge.
    const input = document.querySelector('[data-vfe-id="vfe_1"]') as HTMLElement;
    Object.defineProperty(input, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 300,
        bottom: 330,
        left: 10,
        right: 110,
        width: 100,
        height: 30,
        x: 10,
        y: 300,
        toJSON: () => ({}),
      }),
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(badges()[0]?.style.transform).not.toBe(before);
  });
});

describe('flash', () => {
  it('marks a badge active then restores it', async () => {
    const controller = mountBadges();
    control('vfe_1');
    controller.sync(state([element(1)]));
    controller.flash('vfe_1');
    expect(badges()[0]?.dataset.state).toBe('active');
    await vi.advanceTimersByTimeAsync(900);
    expect(badges()[0]?.dataset.state).toBe('default');
  });

  it('uses the error style for failures', () => {
    const controller = mountBadges();
    control('vfe_1');
    controller.sync(state([element(1)]));
    controller.flash('vfe_1', 'error');
    expect(badges()[0]?.dataset.state).toBe('error');
  });

  it('ignores unknown ids', () => {
    const controller = mountBadges();
    expect(() => controller.flash('vfe_404')).not.toThrow();
  });
});

describe('scheduler', () => {
  it('coalesces many schedule() calls into one pass', () => {
    const frames: Array<() => void> = [];
    const run = vi.fn();
    const scheduler = createScheduler(run, (callback) => {
      frames.push(callback);
      return frames.length;
    });
    for (let index = 0; index < 10; index += 1) scheduler.schedule();
    expect(frames).toHaveLength(1);
    frames[0]?.();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('flushes synchronously on demand', () => {
    const run = vi.fn();
    const scheduler = createScheduler(run, () => 1);
    scheduler.schedule();
    scheduler.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle', () => {
  it('removes nodes, listeners and timers on destroy', async () => {
    const controller = mountBadges();
    control('vfe_1');
    controller.sync(state([element(1)]));
    controller.flash('vfe_1');
    controller.destroy();
    expect(document.querySelectorAll('vfe-badges')).toHaveLength(0);
    expect(() => controller.sync(state([element(1)]))).not.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
  });

  it('mounts once and can be destroyed and re-mounted', () => {
    const first = mountBadges();
    expect(mountBadges()).toBe(first);
    expect(document.querySelectorAll('vfe-badges')).toHaveLength(1);
    first.destroy();
    expect(document.querySelectorAll('vfe-badges')).toHaveLength(0);
    control('vfe_1');
    mountBadges().sync(state([element(1)]));
    expect(badges()).toHaveLength(1);
  });

  it('keeps the overlay invisible to the accessibility tree', () => {
    mountBadges();
    expect(layer().getAttribute('aria-hidden')).toBe('true');
    const style = document.querySelector('vfe-badges')?.shadowRoot?.querySelector('style');
    expect(style?.textContent).toContain('pointer-events: none');
  });
});

describe('controller independence', () => {
  it('works with a bare layer, without mounting a host', () => {
    const bare = document.createElement('div');
    const controller = createBadgeController({ layer: bare, doc: document });
    control('vfe_1');
    controller.sync(state([element(1)]));
    expect(bare.querySelectorAll('.badge')).toHaveLength(1);
    controller.destroy();
    expect(bare.querySelectorAll('.badge')).toHaveLength(0);
  });
});
