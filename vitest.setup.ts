/**
 * Shared Vitest setup for every DOM-aware package.
 *
 * jsdom has no layout engine: `getBoundingClientRect()` always returns a 0×0
 * rect, `getClientRects()` returns an empty list and `getComputedStyle()`
 * ignores most stylesheet rules. The `mockLayout()` helper below patches an
 * element so layout-dependent code (the DOM distiller) can be tested without
 * lying to itself: a test that forgets to call it will fail, which is exactly
 * what ADR-007 asks for.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect } from 'vitest';

export interface MockLayoutConfig {
  /** Border-box width in px. Default 120. */
  width?: number;
  /** Border-box height in px. Default 24. */
  height?: number;
  /** Viewport-relative top in px. Default 0. */
  top?: number;
  /** Viewport-relative left in px. Default 0. */
  left?: number;
  /** Computed `display`. Default `block`. */
  display?: string;
  /** Computed `visibility`. Default `visible`. */
  visibility?: string;
  /** Computed `opacity`. Default `1`. */
  opacity?: number | string;
  /** Computed `content-visibility`. Default `visible`. */
  contentVisibility?: string;
  /** Computed `color`. Default `rgb(0, 0, 0)`. */
  color?: string;
  /** Number of client rects to report. Defaults to 1 when the box has size. */
  clientRects?: number;
}

interface LayoutRecord extends MockLayoutConfig {
  width: number;
  height: number;
  top: number;
  left: number;
  display: string;
  visibility: string;
  opacity: string;
  contentVisibility: string;
  color: string;
}

const records = new WeakMap<Element, LayoutRecord>();
const patched = new Set<Element>();

function toRecord(config: MockLayoutConfig): LayoutRecord {
  return {
    width: config.width ?? 120,
    height: config.height ?? 24,
    top: config.top ?? 0,
    left: config.left ?? 0,
    display: config.display ?? 'block',
    visibility: config.visibility ?? 'visible',
    opacity: String(config.opacity ?? 1),
    contentVisibility: config.contentVisibility ?? 'visible',
    color: config.color ?? 'rgb(0, 0, 0)',
    clientRects: config.clientRects,
  };
}

function rectOf(record: LayoutRecord): DOMRect {
  const { top, left, width, height } = record;
  return {
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return {
        x: left,
        y: top,
        top,
        left,
        width,
        height,
        right: left + width,
        bottom: top + height,
      };
    },
  } as DOMRect;
}

/**
 * Give an element a synthetic layout box and (optionally) computed styles.
 * Returns the element for chaining.
 */
export function mockLayout<T extends Element>(el: T, config: MockLayoutConfig = {}): T {
  const record = toRecord(config);
  records.set(el, record);
  patched.add(el);

  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => rectOf(record),
  });
  Object.defineProperty(el, 'getClientRects', {
    configurable: true,
    value: () => {
      const count =
        record.clientRects ??
        (record.display === 'none' || record.width <= 0 || record.height <= 0 ? 0 : 1);
      const list = Array.from({ length: count }, () => rectOf(record)) as unknown as DOMRect[];
      (list as unknown as { item: (i: number) => DOMRect | null }).item = (i: number) =>
        list[i] ?? null;
      return list as unknown as DOMRectList;
    },
  });
  return el;
}

/** Remove every synthetic layout box installed by `mockLayout`. */
export function resetLayoutMocks(): void {
  for (const el of patched) {
    Reflect.deleteProperty(el, 'getBoundingClientRect');
    Reflect.deleteProperty(el, 'getClientRects');
    records.delete(el);
  }
  patched.clear();
}

const originalGetComputedStyle = window.getComputedStyle.bind(window);

function fakeComputedStyle(el: Element, pseudo?: string | null): CSSStyleDeclaration {
  const base = originalGetComputedStyle(el, pseudo ?? undefined);
  const record = records.get(el);
  if (!record) return base;
  const overrides: Record<string, string> = {
    display: record.display,
    visibility: record.visibility,
    opacity: record.opacity,
    contentVisibility: record.contentVisibility,
    contentVisibilityValue: record.contentVisibility,
    color: record.color,
  };
  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in overrides) return overrides[prop];
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === 'string' && prop in overrides) {
        return { configurable: true, enumerable: true, value: overrides[prop] };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop) ?? undefined;
    },
    has(target, prop) {
      return (typeof prop === 'string' && prop in overrides) || Reflect.has(target, prop);
    },
    ownKeys(target) {
      return Array.from(new Set([...Reflect.ownKeys(target), ...Object.keys(overrides)]));
    },
  }) as CSSStyleDeclaration;
}

// jsdom does not expose a writable `innerWidth`/`innerHeight` from CSS; pin a
// deterministic viewport so off-screen scores are stable across runs.
if (!Object.getOwnPropertyDescriptor(window, 'innerWidth')?.configurable) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: 1024,
  });
}
if (!Object.getOwnPropertyDescriptor(window, 'innerHeight')?.configurable) {
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: 768,
  });
}

beforeEach(() => {
  window.getComputedStyle = ((el: Element, pseudo?: string | null) =>
    fakeComputedStyle(el, pseudo)) as typeof window.getComputedStyle;
});

afterEach(() => {
  resetLayoutMocks();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  window.innerWidth = 1024;
  window.innerHeight = 768;
  expect(window.getComputedStyle(document.documentElement).display).toBeDefined();
});
