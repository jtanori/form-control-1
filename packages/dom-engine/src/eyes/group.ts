import { parentOf } from './dom';
import { isTextVisible, normaliseLabel, textWithoutControls } from './text';

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
const BOUNDARY_TAGS = new Set(['FORM', 'SECTION', 'MAIN']);
const groupCache = new WeakMap<Element, string | null>();

function textOf(el: Element | null): string {
  if (!el) return '';
  const text = textWithoutControls(el);
  return text.length > 0 && text.length < 80 ? text : normaliseLabel(el.textContent);
}

function ariaLabelOf(el: Element, depth = 0): string {
  const direct = normaliseLabel(el.getAttribute('aria-label'));
  if (direct) return direct;
  const ids = el.getAttribute('aria-labelledby');
  if (!ids || depth > 1) return '';
  const root = el.getRootNode() as Document | ShadowRoot;
  const parts = ids
    .split(/\s+/)
    .map((id) => root.getElementById?.(id) ?? document.getElementById(id))
    .filter((node): node is HTMLElement => node !== null)
    .map((node) => textOf(node))
    .filter(Boolean);
  return parts.join(' ');
}

const TEXT_BLOCK_TAGS = new Set(['DIV', 'P', 'SPAN', 'LABEL', 'STRONG']);

function isBareTextBlock(el: Element): boolean {
  if (el.matches(HEADING_SELECTOR)) return true;
  if (!TEXT_BLOCK_TAGS.has(el.tagName)) return false;
  if (el.querySelector('input, select, textarea, button') !== null) return false;
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 0 && text.length < 80;
}

/** Resolve the group/section label (fieldset legend, radiogroup, heading). */
export function resolveGroupLabel(el: Element): string | undefined {
  const cached = groupCache.get(el);
  if (cached !== undefined) return cached ?? undefined;

  const resolved = computeGroupLabel(el);
  groupCache.set(el, resolved ?? null);
  return resolved;
}

function computeGroupLabel(el: Element): string | undefined {
  // 1. Nearest fieldset legend, crossing shadow boundaries.
  for (let node = parentOf(el); node; node = parentOf(node)) {
    if (node.tagName === 'FIELDSET') {
      const legend = node.querySelector('legend');
      const text = textOf(legend);
      if (text) return text;
    }
  }

  // 2. role=group / radiogroup with an accessible name.
  for (let node = parentOf(el); node; node = parentOf(node)) {
    const role = node.getAttribute('role');
    if (role === 'group' || role === 'radiogroup') {
      const text = ariaLabelOf(node);
      if (text) return text;
      if (role === 'radiogroup') break;
    }
  }

  // 3. Walk backwards up to six levels looking for a heading or bare text block.
  let current: Element | null = el;
  for (let level = 0; level < 6 && current; level += 1) {
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (isBareTextBlock(sibling) && isTextVisible(sibling)) {
        const text = normaliseLabel(sibling.textContent);
        if (text) return text;
      }
      sibling = sibling.previousElementSibling;
    }
    const parent = parentOf(current);
    if (parent && BOUNDARY_TAGS.has(parent.tagName)) break;
    current = parent;
  }

  // 4. Section/form with an accessible name.
  for (let node = parentOf(el); node; node = parentOf(node)) {
    if (node.tagName === 'SECTION' || node.tagName === 'FORM') {
      const text = ariaLabelOf(node);
      if (text) return text;
    }
  }

  return undefined;
}

export function clearGroupCache(): void {
  // WeakMap has no clear(); reassigning is not possible for a const binding, so
  // group entries die with their elements. This function exists for symmetry
  // and future cache implementations.
}
