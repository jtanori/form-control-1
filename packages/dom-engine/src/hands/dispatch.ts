export type DispatchInit = EventInit & Record<string, unknown>;

type Ctor = new (type: string, init?: EventInit) => Event;

function ctorFor(type: string): Ctor {
  const candidates: Array<Ctor | undefined> = [];
  if (type === 'beforeinput' || type === 'input') candidates.push(globalThis.InputEvent as Ctor);
  if (type.startsWith('key')) candidates.push(globalThis.KeyboardEvent as Ctor);
  if (type.startsWith('pointer')) {
    candidates.push(globalThis.PointerEvent as Ctor);
    candidates.push(globalThis.MouseEvent as Ctor);
  }
  if (type.startsWith('mouse') || type === 'click' || type === 'dblclick') {
    candidates.push(globalThis.MouseEvent as Ctor);
  }
  if (type === 'focus' || type === 'blur' || type === 'focusin' || type === 'focusout') {
    candidates.push(globalThis.FocusEvent as Ctor);
  }
  candidates.push(globalThis.Event as Ctor);
  return (
    candidates.find((candidate): candidate is Ctor => typeof candidate === 'function') ?? Event
  );
}

/**
 * The one event-construction helper used by every handler.
 * Events bubble, are cancelable and composed so they cross shadow boundaries.
 */
export function dispatch(el: Element, type: string, init: DispatchInit = {}): boolean {
  const Ctor = ctorFor(type);
  const eventInit: DispatchInit = { bubbles: true, cancelable: true, composed: true, ...init };
  try {
    return el.dispatchEvent(new Ctor(type, eventInit));
  } catch {
    return el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, composed: true }));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return sleep(0);
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
