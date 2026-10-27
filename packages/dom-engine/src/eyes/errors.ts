import { findByVfeId } from './discover';
import { findByIdInRoots } from './dom';
import { compareDocumentOrder, isTextVisible } from './text';

const ERRORISH = /error|invalid|required|must|can't|cannot|enter|valid/i;
const ERROR_CLASS = /(error|invalid|danger|feedback|helper-error|text-red)/i;
const MAX_ERROR_LENGTH = 200;

/** Error messages are prose, not labels: keep leading words like "Required". */
function normaliseMessage(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_LENGTH);
}

function readableText(node: Element | null): string {
  if (!node) return '';
  const text = normaliseMessage(node.textContent);
  return text.length > 0 && text.length < MAX_ERROR_LENGTH ? text : '';
}

const NON_WRAPPER_TAGS = new Set(['BODY', 'HTML', 'MAIN']);

function wrapperAncestors(el: Element, levels: number): Element[] {
  const ancestors: Element[] = [];
  let current = el.parentElement;
  while (current && ancestors.length < levels) {
    if (!NON_WRAPPER_TAGS.has(current.tagName)) ancestors.push(current);
    current = current.parentElement;
  }
  return ancestors;
}

function isReddish(color: string): boolean {
  const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(color);
  if (!match) return false;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  return r > 140 && r > g * 1.6 && r > b * 1.6;
}

function byIdFrom(el: Element, id: string): Element | null {
  return findByIdInRoots(id, el.getRootNode() as Document | ShadowRoot);
}

function resolveErrorText(el: Element): string {
  const ariaInvalid = el.getAttribute('aria-invalid') === 'true';

  // 1. aria-errormessage
  if (ariaInvalid) {
    const errormessage = el.getAttribute('aria-errormessage');
    if (errormessage) {
      const text = readableText(byIdFrom(el, errormessage));
      if (text) return text;
    }

    // 2. aria-describedby, only error-ish or role=alert targets.
    const describedBy = el.getAttribute('aria-describedby');
    if (describedBy) {
      for (const id of describedBy.split(/\s+/)) {
        const node = byIdFrom(el, id);
        if (!node) continue;
        const text = readableText(node);
        if (!text) continue;
        if (node.getAttribute('role') === 'alert' || ERRORISH.test(text)) return text;
      }
    }
  }

  const wrappers = wrapperAncestors(el, 3);

  // 3. role=alert inside the field wrapper.
  for (const wrapper of wrappers) {
    const alert = wrapper.querySelector('[role="alert"]');
    if (alert && isTextVisible(alert)) {
      const text = readableText(alert);
      if (text) return text;
    }
  }

  // 4. error-ish class/id on a visible node in the wrapper.
  const candidates: Element[] = [];
  for (const wrapper of wrappers) {
    for (const node of Array.from(wrapper.querySelectorAll('*'))) {
      if (node === el || node.contains(el)) continue;
      const marker = `${node.getAttribute('class') ?? ''} ${node.id}`;
      if (ERROR_CLASS.test(marker)) candidates.push(node);
    }
  }
  candidates.sort(compareDocumentOrder);
  for (const node of candidates) {
    if (!isTextVisible(node)) continue;
    const text = readableText(node);
    if (text) return text;
  }

  // 5. Red-ish text heuristic.
  for (const wrapper of wrappers) {
    for (const node of Array.from(wrapper.querySelectorAll('*'))) {
      if (node.children.length > 0 || !isTextVisible(node)) continue;
      const text = readableText(node);
      if (!text) continue;
      if (isReddish(getComputedStyle(node).color)) return text;
    }
  }

  // 6. HTML5 constraint validation, only once the user has interacted.
  if (el.getAttribute('data-vfe-touched') === 'true') {
    try {
      if (el.matches(':invalid')) {
        const message = (el as HTMLInputElement).validationMessage;
        if (message) return normaliseMessage(message);
      }
    } catch {
      /* :invalid is not supported everywhere — never throw from resolution. */
    }
  }

  return '';
}

/** Resolve the one visible validation error attached to a control, if any. */
export function resolveValidationError(el: Element): string | undefined {
  try {
    const text = resolveErrorText(el);
    return text || undefined;
  } catch {
    return undefined;
  }
}

/** Exported for tests: resolve a message by vfe id. */
export function validationErrorForId(id: string): string | undefined {
  const el = findByVfeId(id);
  return el ? resolveValidationError(el) : undefined;
}

export const ERROR_PATTERN = ERRORISH;
export const ERROR_CLASS_PATTERN = ERROR_CLASS;
