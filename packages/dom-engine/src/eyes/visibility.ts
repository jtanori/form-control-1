import { parentOf } from './dom';
import type { VisibilityResult } from './types';

export interface VisibilityContext {
  /** One style computation per element per pass (avoids layout thrash). */
  styleCache: Map<Element, CSSStyleDeclaration>;
  viewportWidth: number;
  viewportHeight: number;
}

export function createVisibilityContext(): VisibilityContext {
  return {
    styleCache: new Map(),
    viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1024,
    viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 768,
  };
}

function contentVisibilityOf(style: CSSStyleDeclaration): string {
  const direct = (style as CSSStyleDeclaration & { contentVisibility?: string }).contentVisibility;
  return direct ?? style.getPropertyValue('content-visibility');
}

function styleOf(el: Element, ctx: VisibilityContext): CSSStyleDeclaration {
  const cached = ctx.styleCache.get(el);
  if (cached) return cached;
  const style = getComputedStyle(el);
  ctx.styleCache.set(el, style);
  return style;
}

function numbersOf(el: Element): {
  width: number;
  height: number;
  right: number;
  bottom: number;
  left: number;
  top: number;
} {
  const rect = el.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    top: rect.top,
  };
}

/**
 * True when the element has a visible `<label>` proxy (custom checkbox/radio
 * markup hides the native input and styles the label instead).
 */
export function hasVisibleProxyLabel(el: Element, ctx: VisibilityContext): boolean {
  const input = el as HTMLInputElement;
  if (input.tagName === 'INPUT' && (input.type === 'checkbox' || input.type === 'radio')) {
    const labels = input.labels ? Array.from(input.labels) : [];
    if (labels.some((label) => boxIsVisible(label, ctx))) return true;
    const wrapping = el.closest('label');
    if (wrapping && boxIsVisible(wrapping, ctx)) return true;
  }
  if (el.tagName === 'SELECT') {
    const wrapping = el.closest('label');
    if (wrapping && boxIsVisible(wrapping, ctx)) return true;
  }
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const root = el.getRootNode() as Document | ShadowRoot;
    for (const id of labelledBy.split(/\s+/)) {
      const target = root.getElementById?.(id) ?? document.getElementById(id);
      if (target && boxIsVisible(target, ctx)) return true;
    }
  }
  return false;
}

function boxIsVisible(el: Element, ctx: VisibilityContext): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = styleOf(el, ctx);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' &&
    parseFloat(style.opacity) !== 0
  );
}

function proxyEligible(el: Element): boolean {
  if (el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return type === 'checkbox' || type === 'radio';
}

/**
 * Visibility algorithm (A-1 §3). Pure reads: no layout is forced by writes and
 * no style is computed twice per pass.
 */
export function isVisibleWithContext(el: Element, ctx: VisibilityContext): VisibilityResult {
  if (!el.isConnected) return { visible: false, reason: 'detached' };

  // 3.1 aria-hidden / inert on self or any ancestor (crossing shadow hosts).
  for (let node: Element | null = el; node; node = parentOf(node)) {
    if (node.getAttribute?.('aria-hidden') === 'true') {
      return { visible: false, reason: 'aria-hidden' };
    }
    // `inert` is both an attribute and a reflected property; jsdom only
    // reflects the attribute, browsers set both.
    if ((node as HTMLElement).inert === true || node.hasAttribute('inert')) {
      return { visible: false, reason: 'inert' };
    }
  }

  // 3.2 computed style on the element itself.
  const style = styleOf(el, ctx);
  if (style.display === 'none') return { visible: false, reason: 'display-none' };
  if (style.visibility === 'hidden' || style.visibility === 'collapse') {
    return { visible: false, reason: 'visibility-hidden' };
  }
  if (contentVisibilityOf(style) === 'hidden') {
    return { visible: false, reason: 'content-visibility-hidden' };
  }

  // 3.3 opacity: 0 on self or any ancestor.
  for (let node: Element | null = el; node; node = parentOf(node)) {
    if (parseFloat(styleOf(node, ctx).opacity) === 0) {
      if (proxyEligible(el) && hasVisibleProxyLabel(el, ctx)) {
        return { visible: true, viaProxy: true };
      }
      return { visible: false, reason: 'opacity-0' };
    }
  }

  // 3.4 zero-size / no box (never evaluated on ancestors: display:contents).
  const rects = el.getClientRects();
  const box = numbersOf(el);
  if (rects.length === 0 || box.width === 0 || box.height === 0) {
    if (proxyEligible(el) && hasVisibleProxyLabel(el, ctx)) {
      return { visible: true, viaProxy: true };
    }
    return { visible: false, reason: 'zero-size' };
  }

  // 3.5 honeypot / off-screen positioning.
  const farOutside =
    box.right < -500 ||
    box.bottom < -500 ||
    box.left > ctx.viewportWidth + 5000 ||
    box.top > ctx.viewportHeight + 5000;
  if (farOutside) {
    if (proxyEligible(el) && hasVisibleProxyLabel(el, ctx)) {
      return { visible: true, viaProxy: true };
    }
    return { visible: false, reason: 'offscreen-honeypot' };
  }
  if (box.width <= 1 && box.height <= 1) {
    if (proxyEligible(el) && hasVisibleProxyLabel(el, ctx)) {
      return { visible: true, viaProxy: true };
    }
    return { visible: false, reason: 'zero-size' };
  }

  return { visible: true };
}

/** Public single-element check (builds a throw-away style cache). */
export function isVisible(el: Element): VisibilityResult {
  return isVisibleWithContext(el, createVisibilityContext());
}
