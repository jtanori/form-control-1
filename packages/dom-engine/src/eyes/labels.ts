import { collectRoots, escapeId, findByIdInRoots } from './dom';
import { resolveValidationError } from './errors';
import { clearGroupCache, resolveGroupLabel } from './group';
import {
  containsControl,
  hasRequiredMarker,
  isTextVisible,
  normaliseLabel,
  textWithoutControls,
} from './text';

export type LabelSource =
  | 'aria-label'
  | 'aria-labelledby'
  | 'label-for'
  | 'label-parent'
  | 'proximity'
  | 'placeholder'
  | 'name-attr'
  | 'fallback';

export interface ResolvedContext {
  /** Never empty: falls back to a readable token. */
  label: string;
  labelSource: LabelSource;
  groupLabel?: string;
  validationError?: string;
  required: boolean;
  requiredSource: 'html' | 'aria' | 'label-marker' | 'none';
}

interface RawLabel {
  text: string;
  marker: boolean;
  source: LabelSource;
}

const PROXIMITY_SELECTOR = 'label, span, div, p';
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
const CONTROL_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);

let contextCache = new WeakMap<Element, ResolvedContext>();
const usedProximityTexts = new Map<string, Element>();

/** Clear all per-pass caches (tests, and A-3 between distillation passes). */
export function clearContextCache(): void {
  contextCache = new WeakMap<Element, ResolvedContext>();
  usedProximityTexts.clear();
  clearGroupCache();
}

function labelFromNode(node: Element | null, depth: number, seen: Set<Element>): RawLabel | null {
  if (!node || seen.has(node)) return null;
  const text = textWithoutControls(node);
  if (text) return { text, marker: hasRequiredMarker(node.textContent), source: 'aria-labelledby' };
  const nested = resolveRaw(node as HTMLElement, depth + 1, seen);
  return nested ? { ...nested, source: 'aria-labelledby' } : null;
}

function labelledByLabel(el: Element, depth: number, seen: Set<Element>): RawLabel | null {
  const ids = el.getAttribute('aria-labelledby');
  if (!ids) return null;
  const root = el.getRootNode() as Document | ShadowRoot;
  const parts: string[] = [];
  let marker = false;
  for (const id of ids.split(/\s+/)) {
    const target = findByIdInRoots(id, root);
    const resolved = labelFromNode(target, depth, seen);
    if (resolved) {
      parts.push(resolved.text);
      marker = marker || resolved.marker;
    }
  }
  const text = normaliseLabel(parts.join(' '));
  return text ? { text, marker, source: 'aria-labelledby' } : null;
}

function forIdLabel(el: Element): RawLabel | null {
  if (!el.id) return null;
  const selector = `label[for="${escapeId(el.id)}"]`;
  const root = el.getRootNode() as Document | ShadowRoot;
  const labels = new Set<Element>();
  for (const candidateRoot of collectRoots(root).roots) {
    for (const node of Array.from(candidateRoot.querySelectorAll(selector))) labels.add(node);
  }
  for (const node of Array.from(
    collectRoots(document).roots.flatMap((r) => Array.from(r.querySelectorAll(selector))),
  )) {
    labels.add(node);
  }
  const parts: string[] = [];
  let marker = false;
  for (const label of labels) {
    const text = textWithoutControls(label);
    if (text) {
      parts.push(text);
      marker = marker || hasRequiredMarker(label.textContent);
    }
  }
  const text = normaliseLabel(parts.join(' '));
  return text ? { text, marker, source: 'label-for' } : null;
}

function parentLabel(el: Element): RawLabel | null {
  const label = el.closest('label');
  if (!label) return null;
  const text = textWithoutControls(label);
  if (!text) return null;
  return { text, marker: hasRequiredMarker(label.textContent), source: 'label-parent' };
}

function proximityCandidates(el: Element): Element[] {
  const candidates: Element[] = [];
  const previous = el.previousElementSibling;
  if (previous) candidates.push(previous);
  const parent = el.parentElement;
  const parentPrevious = parent?.previousElementSibling;
  if (parentPrevious) candidates.push(parentPrevious);

  let wrapper: Element | null = el.parentElement;
  for (let level = 0; level < 2 && wrapper; level += 1) {
    const first = Array.from(wrapper.children).find((child) => child.matches(PROXIMITY_SELECTOR));
    if (first) candidates.push(first);
    wrapper = wrapper.parentElement;
  }
  return candidates;
}

function proximityLabel(el: Element): RawLabel | null {
  for (const candidate of proximityCandidates(el)) {
    if (candidate === el || candidate.contains(el)) continue;
    if (candidate.matches('input, select, textarea, button')) continue;
    if (candidate.matches(HEADING_SELECTOR)) continue;
    if (containsControl(candidate)) continue;
    if (!isTextVisible(candidate)) continue;
    const text = textWithoutControls(candidate);
    if (!text || text.length > 60) continue;
    const key = text.toLowerCase();
    const owner = usedProximityTexts.get(key);
    if (owner && owner !== el) continue;
    usedProximityTexts.set(key, el);
    return {
      text,
      marker: hasRequiredMarker(candidate.textContent),
      source: 'proximity',
    };
  }
  return null;
}

function humanise(raw: string): string {
  return raw
    .replace(/^(input|field|txt)[-_]/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\d+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function fallbackLabel(el: HTMLElement): RawLabel {
  const placeholder = normaliseLabel(el.getAttribute('placeholder'));
  if (placeholder) return { text: placeholder, marker: false, source: 'placeholder' };

  const name = el.getAttribute('name');
  if (name) {
    const humanised = humanise(name);
    if (humanised) return { text: humanised, marker: false, source: 'name-attr' };
  }

  for (const attribute of ['data-testid', 'id']) {
    const value = el.getAttribute(attribute);
    if (!value) continue;
    const humanised = humanise(value);
    if (humanised) return { text: humanised, marker: false, source: 'fallback' };
  }

  return { text: 'Field', marker: false, source: 'fallback' };
}

function resolveRaw(el: HTMLElement, depth = 0, seen = new Set<Element>()): RawLabel | null {
  if (depth > 2 || seen.has(el)) return null;
  seen.add(el);

  const ariaLabel = normaliseLabel(el.getAttribute('aria-label'));
  if (ariaLabel) {
    return {
      text: ariaLabel,
      marker: hasRequiredMarker(el.getAttribute('aria-label')),
      source: 'aria-label',
    };
  }

  const labelled = labelledByLabel(el, depth, seen);
  if (labelled) return labelled;

  // A role=option's own text *is* its label ("California" in a custom listbox).
  if (el.getAttribute('role') === 'option') {
    const own = textWithoutControls(el);
    if (own) return { text: own, marker: false, source: 'label-parent' };
  }

  return forIdLabel(el) ?? parentLabel(el) ?? proximityLabel(el) ?? null;
}

function requiredOf(
  el: HTMLElement,
  marker: boolean,
): Pick<ResolvedContext, 'required' | 'requiredSource'> {
  const native = (el as HTMLInputElement).required === true;
  if (native) return { required: true, requiredSource: 'html' };
  if (el.getAttribute('aria-required') === 'true')
    return { required: true, requiredSource: 'aria' };
  if (marker) return { required: true, requiredSource: 'label-marker' };
  return { required: false, requiredSource: 'none' };
}

/**
 * Resolve everything the Brain needs to know about one control's text: its
 * label (never empty), the group it belongs to, its visible error, and whether
 * it is required (and why).
 */
export function resolveContext(el: HTMLElement): ResolvedContext {
  const cached = contextCache.get(el);
  if (cached) return cached;

  let resolved: ResolvedContext;
  try {
    const raw = resolveRaw(el);
    const fallback = raw ?? fallbackLabel(el);
    resolved = {
      label: fallback.text || 'Field',
      labelSource: fallback.source,
      ...requiredOf(el, fallback.marker),
    };
    const groupLabel = resolveGroupLabel(el);
    if (groupLabel) resolved.groupLabel = groupLabel;
    const validationError = resolveValidationError(el);
    if (validationError) resolved.validationError = validationError;
  } catch {
    resolved = { label: 'Field', labelSource: 'fallback', required: false, requiredSource: 'none' };
  }

  contextCache.set(el, resolved);
  return resolved;
}

/** Exported for callers that only need the humanised label. */
export function labelOf(el: HTMLElement): string {
  return resolveContext(el).label;
}

/** Controls eligible for proximity-label sharing (used by A-2 tests). */
export function isControlTag(el: Element): boolean {
  return CONTROL_TAGS.has(el.tagName);
}

export { normaliseLabel };
