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
import { afterEach, beforeEach, expect } from 'vitest';

const isDomEnvironment = typeof window !== 'undefined' && typeof document !== 'undefined';

// A handful of tests run in the `node` environment (bundle budgets, file
// scans); they get no DOM shims and no DOM matchers.
if (isDomEnvironment) {
  await import('@testing-library/jest-dom/vitest');
}

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

interface LayoutRecord {
  width: number;
  height: number;
  top: number;
  left: number;
  display?: string;
  visibility?: string;
  opacity?: string;
  contentVisibility?: string;
  color?: string;
  clientRects?: number;
}

const records = new WeakMap<Element, LayoutRecord>();
const patched = new Set<Element>();

function toRecord(config: MockLayoutConfig): LayoutRecord {
  // Only explicit style overrides are recorded: the real inline styles of the
  // page must keep working (a fixture with `display:none` stays hidden even
  // when its box is mocked).
  return {
    width: config.width ?? 120,
    height: config.height ?? 24,
    top: config.top ?? 0,
    left: config.left ?? 0,
    ...(config.display === undefined ? {} : { display: config.display }),
    ...(config.visibility === undefined ? {} : { visibility: config.visibility }),
    ...(config.opacity === undefined ? {} : { opacity: String(config.opacity) }),
    ...(config.contentVisibility === undefined
      ? {}
      : { contentVisibility: config.contentVisibility }),
    ...(config.color === undefined ? {} : { color: config.color }),
    ...(config.clientRects === undefined ? {} : { clientRects: config.clientRects }),
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
  if (!isDomEnvironment) return;
  for (const el of patched) {
    Reflect.deleteProperty(el, 'getBoundingClientRect');
    Reflect.deleteProperty(el, 'getClientRects');
    records.delete(el);
  }
  patched.clear();
}

const originalGetComputedStyle: typeof window.getComputedStyle | null = isDomEnvironment
  ? window.getComputedStyle.bind(window)
  : null;

function fakeComputedStyle(el: Element, pseudo?: string | null): CSSStyleDeclaration {
  if (!originalGetComputedStyle) throw new Error('getComputedStyle needs the jsdom environment');
  const base = originalGetComputedStyle(el, pseudo ?? undefined);
  const record = records.get(el);
  if (!record) return base;
  const overrides: Record<string, string> = {};
  if (record.display !== undefined) overrides.display = record.display;
  if (record.visibility !== undefined) overrides.visibility = record.visibility;
  if (record.opacity !== undefined) overrides.opacity = record.opacity;
  if (record.contentVisibility !== undefined) {
    overrides.contentVisibility = record.contentVisibility;
  }
  if (record.color !== undefined) overrides.color = record.color;
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
if (isDomEnvironment && !Object.getOwnPropertyDescriptor(window, 'innerWidth')?.configurable) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: 1024,
  });
}
if (isDomEnvironment && !Object.getOwnPropertyDescriptor(window, 'innerHeight')?.configurable) {
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: 768,
  });
}

beforeEach(() => {
  if (!isDomEnvironment) return;
  window.getComputedStyle = ((el: Element, pseudo?: string | null) =>
    fakeComputedStyle(el, pseudo)) as typeof window.getComputedStyle;
});

afterEach(() => {
  if (!isDomEnvironment) return;
  resetLayoutMocks();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  window.innerWidth = 1024;
  window.innerHeight = 768;
  expect(window.getComputedStyle(document.documentElement).display).toBeDefined();
});
