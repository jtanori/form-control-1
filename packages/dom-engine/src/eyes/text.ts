import { parentOf } from './dom';

const CONTROL_SELECTOR = 'input, select, textarea, button, [role="button"], svg';
const EMBEDDED_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

/**
 * The single text normaliser used by labels, group labels and errors.
 * Strips whitespace noise, required markers, trailing colons and helper text.
 */
export function normaliseLabel(raw: string | null | undefined): string {
  const cleaned = (raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(EMBEDDED_EMOJI, '')
    .replace(/[*✱]/g, '')
    .replace(/\u200B/g, '')
    .replace(/\s*[:(]\s*required\s*\)?\s*$/i, '')
    .replace(/\s*:+\s*$/, '')
    .replace(/^required\s+/i, '')
    .trim()
    .slice(0, 120);
  return /^(required|\*)$/i.test(cleaned) ? '' : cleaned;
}

/** True when the raw label carries a required marker (`*`, `✱`, `(required)`). */
export function hasRequiredMarker(raw: string | null | undefined): boolean {
  const text = raw ?? '';
  return (
    /[*✱]/.test(text) || /[:(]\s*required\s*\)?/i.test(text) || /^required\b/i.test(text.trim())
  );
}

/** Style-level visibility (no geometry: text helpers have no box guarantees). */
export function isTextVisible(el: Element): boolean {
  for (let node: Element | null = el; node; node = parentOf(node)) {
    if (node.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(node);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (parseFloat(style.opacity) === 0) return false;
    if (node.hasAttribute('hidden')) return false;
  }
  return true;
}

/** Visible text of a node, with embedded controls removed (clone, never live). */
export function textWithoutControls(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(CONTROL_SELECTOR).forEach((node) => node.remove());
  const text = typeof clone.innerText === 'string' ? clone.innerText : clone.textContent;
  return normaliseLabel(text);
}

/** True when a node contains (or is) an interactive control. */
export function containsControl(el: Element): boolean {
  if (el.matches(CONTROL_SELECTOR)) return true;
  return el.querySelector(CONTROL_SELECTOR) !== null;
}

export function compareDocumentOrder(a: Element, b: Element): number {
  if (a === b) return 0;
  const position = a.compareDocumentPosition(b);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}
