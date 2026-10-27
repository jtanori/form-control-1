import { dispatch } from './dispatch';

/**
 * Full pointer sequence at the element's visual centre. Radix/Headless UI
 * listen on `pointerdown`, so a bare `.click()` is not enough.
 */
export function pointerClick(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const base = {
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 0,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };

  dispatch(el, 'pointerover', base);
  dispatch(el, 'pointerenter', { ...base, bubbles: false });
  dispatch(el, 'pointerdown', { ...base, buttons: 1, pressure: 0.5 });
  dispatch(el, 'mousedown', { ...base, buttons: 1, detail: 1 });
  el.focus?.({ preventScroll: true });
  dispatch(el, 'pointerup', base);
  dispatch(el, 'mouseup', { ...base, detail: 1 });
  dispatch(el, 'click', { ...base, detail: 1 });
}

/** Nearest clickable proxy for a visually hidden control. */
export function proxyLabelFor(el: HTMLElement): HTMLElement | null {
  const id = el.id;
  if (id) {
    const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (explicit) return explicit as HTMLElement;
  }
  const wrapping = el.closest('label');
  if (wrapping) return wrapping as HTMLElement;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const target = document.getElementById(labelledBy.split(/\s+/)[0] ?? '');
    if (target) return target as HTMLElement;
  }
  return null;
}

export function hasBox(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
