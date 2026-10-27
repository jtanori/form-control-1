export interface RectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export interface CollisionInput {
  pill: RectLike;
  focused?: RectLike | null;
  bottomBars: RectLike[];
  viewport: { width: number; height: number };
  baseBottom?: number;
}

export const BASE_BOTTOM = 24;
export const LIFTED_BOTTOM = 96;
export const FOCUS_LIFT = 64;

export function intersects(a: RectLike, b: RectLike): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Bottom offset heuristic:
 *  - a fixed bar covering > 60 vw near the bottom lifts the pill to 96 px;
 *  - a focused control under the pill adds another 64 px.
 */
export function bottomOffset(input: CollisionInput): number {
  const base = input.baseBottom ?? BASE_BOTTOM;
  const barBlocks = input.bottomBars.some(
    (bar) =>
      bar.width > input.viewport.width * 0.6 &&
      bar.bottom > input.viewport.height - 40 &&
      intersects(input.pill, bar),
  );
  let offset = barBlocks ? LIFTED_BOTTOM : base;
  if (input.focused) {
    const shifted = {
      ...input.pill,
      top: input.pill.top - (offset - base),
      bottom: input.pill.bottom - (offset - base),
    };
    if (intersects(shifted, input.focused)) offset += FOCUS_LIFT;
  }
  return offset;
}

/** Structured-clone-safe snapshot of a rect. */
export function rectOf(
  rect:
    | DOMRect
    | { top: number; bottom: number; left: number; right: number; width: number; height: number },
): RectLike {
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    width: rect.width,
    height: rect.height,
  };
}

/** Cap the fixed-element scan; a 500 ms throttle keeps this cheap. */
export function collectBottomBars(doc: Document, viewportWidth: number, limit = 1500): RectLike[] {
  const results: RectLike[] = [];
  const all = doc.body?.querySelectorAll<HTMLElement>('*');
  if (!all) return results;
  const count = Math.min(all.length, limit);
  for (let index = 0; index < count; index += 1) {
    const element = all[index];
    if (!element) continue;
    const style = doc.defaultView?.getComputedStyle(element);
    if (!style || style.position !== 'fixed') continue;
    const rect = element.getBoundingClientRect();
    if (rect.width > viewportWidth * 0.6 && rect.height > 0) {
      results.push(rectOf(rect));
    }
  }
  return results;
}
