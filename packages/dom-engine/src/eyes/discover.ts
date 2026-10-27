import { collectRoots, escapeId, isShadowRoot, parentOf } from './dom';
import type {
  DiscoveredElement,
  DiscoveryOptions,
  DiscoveryResult,
  VisibilityReason,
} from './types';
import { createVisibilityContext, isVisibleWithContext } from './visibility';

export const VFE_ID_ATTRIBUTE = 'data-vfe-id';
export const VFE_BADGE_ATTRIBUTE = 'data-vfe-badge';
export const VFE_VIA_PROXY_ATTRIBUTE = 'data-vfe-via-proxy';
export const VFE_TOUCHED_ATTRIBUTE = 'data-vfe-touched';
const VFE_OWN_ATTRIBUTES = [
  VFE_ID_ATTRIBUTE,
  VFE_BADGE_ATTRIBUTE,
  VFE_VIA_PROXY_ATTRIBUTE,
  VFE_TOUCHED_ATTRIBUTE,
];

const NON_ACTIONABLE_INPUT_TYPES = new Set(['hidden', 'file', 'submit', 'reset', 'image']);

const CANDIDATE_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="textbox"]',
  '[role="spinbutton"]',
  '[role="option"]',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  'a[href]',
].join(',');

const BUTTON_SELECTOR = 'button, [role="button"], input[type="button"]';

/** Monotonic ID registry — stable per DOM node for the lifetime of the page. */
let idCounter = 0;
let idByElement = new WeakMap<Element, string>();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function parseVfeNumber(id: string | null): number {
  if (!id) return 0;
  const match = /^vfe_(\d+)$/.exec(id);
  return match?.[1] ? Number(match[1]) : 0;
}

function vfeIdFor(el: Element): string {
  const existing = el.getAttribute(VFE_ID_ATTRIBUTE);
  if (existing) {
    idByElement.set(el, existing);
    idCounter = Math.max(idCounter, parseVfeNumber(existing));
    return existing;
  }
  const remembered = idByElement.get(el);
  if (remembered) return remembered;
  idCounter += 1;
  const id = `vfe_${idCounter}`;
  idByElement.set(el, id);
  return id;
}

function htmlTypeOf(el: Element): string | null {
  if (el.tagName === 'INPUT') return (el as HTMLInputElement).type.toLowerCase();
  const role = el.getAttribute('role');
  if (role) return role;
  if (el.tagName === 'BUTTON') return 'button';
  if (el.getAttribute('contenteditable') !== null) return 'textbox';
  return null;
}

function inputTypeExcluded(el: Element): boolean {
  return el.tagName === 'INPUT' && NON_ACTIONABLE_INPUT_TYPES.has((el as HTMLInputElement).type);
}

function insideOpenListbox(el: Element): boolean {
  for (let node = parentOf(el); node; node = parentOf(node)) {
    if (node.getAttribute('role') === 'listbox') return true;
  }
  return false;
}

function nearestListbox(el: Element): HTMLElement | null {
  for (let node = parentOf(el); node; node = parentOf(node)) {
    if (node.getAttribute('role') === 'listbox') return node as HTMLElement;
  }
  return null;
}

function isInsideModal(el: Element): boolean {
  for (let node: Element | null = el; node; node = parentOf(node)) {
    if (node.getAttribute('role') === 'dialog') return true;
    if (node.getAttribute('aria-modal') === 'true') return true;
    if (node.tagName === 'DIALOG' && (node as HTMLDialogElement).open) return true;
  }
  return false;
}

function isLinkCandidate(el: Element, includeLinks: boolean): boolean {
  if (el.tagName !== 'A') return true;
  const marked = el.hasAttribute('data-vfe-link');
  if (marked) return true;
  return includeLinks && el.closest('form') !== null;
}

/**
 * "The Eyes", part 1: walk the DOM (including open shadow roots), filter to
 * visible interactive controls, tag them with stable IDs and number them.
 */
export function discoverInteractiveElements(options: DiscoveryOptions = {}): DiscoveryResult {
  const startedAt = now();
  const root = options.root ?? document;
  const maxElements = options.maxElements ?? 250;
  const includeButtons = options.includeButtons ?? true;
  const includeLinks = options.includeLinks ?? false;
  const wantDebug = options.debug ?? false;

  const ctx = createVisibilityContext();
  const excluded: DiscoveryResult['excluded'] = [];
  const found: Array<{ element: HTMLElement; viaProxy: boolean }> = [];
  const seen = new Set<Element>();
  const debug = wantDebug
    ? { shadowRoots: 0, closedShadowRoots: 0, notes: [] as string[] }
    : undefined;

  const queue: Array<Document | ShadowRoot> = [root];
  let capped = false;

  while (queue.length > 0 && !capped) {
    const currentRoot = queue.shift();
    if (!currentRoot) break;
    if (isShadowRoot(currentRoot)) {
      if (debug) debug.shadowRoots += 1;
    }

    for (const el of Array.from(currentRoot.querySelectorAll('*'))) {
      const shadow = el.shadowRoot;
      if (shadow) queue.push(shadow);
      else if ((el as Element & { __vfeClosedShadow?: boolean }).__vfeClosedShadow && debug) {
        debug.closedShadowRoots += 1;
      }

      if (seen.has(el) || !el.matches(CANDIDATE_SELECTOR)) continue;
      seen.add(el);

      if (el.hasAttribute('data-vfe-ignore')) {
        debug?.notes.push(`ignored ${el.tagName.toLowerCase()} (data-vfe-ignore)`);
        continue;
      }
      if (!includeButtons && el.matches(BUTTON_SELECTOR)) continue;
      if (!isLinkCandidate(el, includeLinks)) continue;

      if (inputTypeExcluded(el)) {
        excluded.push({ tag: el.tagName.toLowerCase(), reason: 'type-hidden' });
        continue;
      }

      // role=option is only meaningful inside an *open, visible* listbox.
      if (el.getAttribute('role') === 'option') {
        if (!insideOpenListbox(el)) {
          excluded.push({ tag: el.tagName.toLowerCase(), reason: 'type-hidden' });
          continue;
        }
        const listbox = nearestListbox(el);
        if (listbox && !isVisibleWithContext(listbox, ctx).visible) {
          excluded.push({ tag: el.tagName.toLowerCase(), reason: 'type-hidden' });
          continue;
        }
      }

      const visibility = isVisibleWithContext(el, ctx);
      if (!visibility.visible) {
        excluded.push({
          tag: el.tagName.toLowerCase(),
          reason: visibility.reason ?? 'zero-size',
        });
        continue;
      }

      if (found.length >= maxElements) {
        excluded.push({ tag: el.tagName.toLowerCase(), reason: 'max-elements' });
        capped = true;
        break;
      }

      found.push({ element: el as HTMLElement, viaProxy: visibility.viaProxy === true });
    }
  }

  // Modal controls first: the Brain must see the dialog before the backdrop.
  const modal = found.filter((entry) => isInsideModal(entry.element));
  const rest = found.filter((entry) => !isInsideModal(entry.element));
  const ordered = [...modal, ...rest];

  const elements: DiscoveredElement[] = ordered.map((entry, index) => {
    const vfeId = vfeIdFor(entry.element);
    if (entry.element.getAttribute(VFE_ID_ATTRIBUTE) !== vfeId) {
      entry.element.setAttribute(VFE_ID_ATTRIBUTE, vfeId);
    }
    const badge = String(index + 1);
    if (entry.element.getAttribute(VFE_BADGE_ATTRIBUTE) !== badge) {
      entry.element.setAttribute(VFE_BADGE_ATTRIBUTE, badge);
    }
    if (entry.viaProxy && !entry.element.hasAttribute(VFE_VIA_PROXY_ATTRIBUTE)) {
      entry.element.setAttribute(VFE_VIA_PROXY_ATTRIBUTE, 'true');
    }
    return {
      vfeId,
      badgeIndex: index + 1,
      element: entry.element,
      tag: entry.element.tagName.toLowerCase(),
      htmlType: htmlTypeOf(entry.element),
      viaProxy: entry.viaProxy,
    };
  });

  return {
    elements,
    excluded,
    durationMs: now() - startedAt,
    ...(debug ? { debug } : {}),
  };
}

/**
 * Find the element carrying `data-vfe-id="id"`, searching the document and
 * every open shadow root (recursive `querySelectorAll` does not pierce roots).
 */
export function findByVfeId(
  id: string,
  root: Document | ShadowRoot = document,
): HTMLElement | null {
  const { roots } = collectRoots(root);
  const selector = `[${VFE_ID_ATTRIBUTE}="${escapeId(id)}"]`;
  for (const candidateRoot of roots) {
    const found = candidateRoot.querySelector(selector);
    if (found) return found as HTMLElement;
  }
  return null;
}

/**
 * Remove every engine-owned `data-vfe-*` attribute in the document and all
 * open shadow roots, and reset the ID registry (page session teardown).
 * Site-authored `data-vfe-ignore` markers are left untouched.
 */
export function clearVfeTags(root: Document | ShadowRoot = document): void {
  const { roots } = collectRoots(root);
  for (const candidateRoot of roots) {
    for (const el of Array.from(
      candidateRoot.querySelectorAll(VFE_OWN_ATTRIBUTES.map((a) => `[${a}]`).join(',')),
    )) {
      for (const attribute of VFE_OWN_ATTRIBUTES) el.removeAttribute(attribute);
    }
  }
  idByElement = new WeakMap<Element, string>();
  idCounter = 0;
}

/** Visibility reason helper for callers that only need the enum. */
export function exclusionReason(el: Element): VisibilityReason | undefined {
  return isVisibleWithContext(el, createVisibilityContext()).reason;
}
