export interface Viewport {
  width: number;
  height: number;
}

export interface Placement {
  x: number;
  y: number;
  visible: boolean;
}

export interface RectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export const BADGE_SIZE = 20;
export const BADGE_OFFSET = 10;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Badge sits just outside the control's top-left corner, clamped to the viewport. */
export function placeBadge(rect: RectLike, viewport: Viewport): Placement {
  const offscreen =
    rect.bottom < 0 || rect.top > viewport.height || rect.right < 0 || rect.left > viewport.width;
  const collapsed = rect.width === 0 && rect.height === 0;
  if (offscreen || collapsed) return { x: 0, y: 0, visible: false };

  return {
    x: clamp(rect.left - BADGE_OFFSET, 2, viewport.width - BADGE_SIZE - 2),
    y: clamp(rect.top - BADGE_OFFSET, 2, viewport.height - BADGE_SIZE - 2),
    visible: true,
  };
}

export function transformFor(x: number, y: number): string {
  return `translate3d(${x}px, ${y}px, 0)`;
}
