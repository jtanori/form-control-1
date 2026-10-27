import type { FormElement, PageState } from '@vfe/protocol';

import { discoverInteractiveElements, VFE_BADGE_ATTRIBUTE, VFE_ID_ATTRIBUTE } from './discover';
import { collectRoots } from './dom';
import { clearContextCache, resolveContext } from './labels';
import { mapType, serializeElement } from './serialize';
import { isTextVisible } from './text';

export interface DistillOptions {
  root?: Document | ShadowRoot;
  maxElements?: number;
  /** Default true. Passwords are always redacted. */
  includeValues?: boolean;
  /** Default 250 (kept for API symmetry with the watcher options). */
  debounceMs?: number;
  /** Default 120. */
  observerDebounceMs?: number;
}

export interface StateChange {
  pageState: PageState;
  added: string[];
  removed: string[];
  updated: string[];
  reason: 'mutation' | 'manual';
}

export interface PageWatcher {
  start: () => void;
  stop: () => void;
  refresh: () => StateChange;
  current: () => PageState | null;
}

const REUSE_TTL_MS = 60_000;

interface FingerprintEntry {
  vfeId: string;
  expiresAt: number;
}

let seenElements = new WeakSet<Element>();
const idFingerprints = new Map<string, FingerprintEntry>();

/** Reset the ID re-adoption registry (tests, HUD teardown). */
export function clearDistillState(): void {
  idFingerprints.clear();
  seenElements = new WeakSet<Element>();
}

function fingerprintOf(el: HTMLElement): string {
  const context = resolveContext(el);
  return [el.getAttribute('name') ?? '', mapType(el), context.label, context.groupLabel ?? ''].join(
    '|',
  );
}

function pageTitle(): string {
  const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  const path = typeof location !== 'undefined' ? location.pathname : '';
  return (document.title || og || path || 'Untitled').slice(0, 200);
}

const PAGE_BOUNDARY_TAGS = new Set(['BODY', 'HTML', 'MAIN', 'FORM', 'SECTION']);

function isPageLevelAlert(alert: Element): boolean {
  let current: Element | null = alert.parentElement;
  for (let level = 0; level < 3 && current; level += 1) {
    if (PAGE_BOUNDARY_TAGS.has(current.tagName)) return true;
    const hasControl = Array.from(
      current.querySelectorAll('input, select, textarea, [role="textbox"]'),
    ).some((control) => !alert.contains(control));
    if (hasControl) return false;
    current = current.parentElement;
  }
  return true;
}

function collectGlobalErrors(): string[] {
  const errors: string[] = [];
  const push = (text: string | null | undefined): void => {
    const normalised = (text ?? '').replace(/\s+/g, ' ').trim();
    if (normalised && normalised.length < 300 && !errors.includes(normalised))
      errors.push(normalised);
  };

  for (const node of Array.from(document.querySelectorAll('[role="alert"]'))) {
    if (!isTextVisible(node) || !isPageLevelAlert(node)) continue;
    push(node.textContent);
  }
  for (const node of Array.from(document.querySelectorAll('[aria-live="assertive"]'))) {
    if (!isTextVisible(node)) continue;
    push(node.textContent);
  }
  for (const node of Array.from(document.querySelectorAll('form *'))) {
    const marker = `${node.getAttribute('class') ?? ''} ${node.id}`;
    if (!/(error|alert|danger|toast)/i.test(marker)) continue;
    if (!isTextVisible(node)) continue;
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length === 0 || text.length >= 300) continue;
    push(text);
  }

  return errors.slice(0, 5);
}

function reassignIds(
  entries: Array<{ element: HTMLElement; vfeId: string; badgeIndex: number }>,
): void {
  const idsInPass = new Set(entries.map((entry) => entry.vfeId));
  const now = Date.now();
  const counts = new Map<string, number>();

  const keys = new Map<Element, string>();
  for (const entry of entries) {
    const key = fingerprintOf(entry.element);
    keys.set(entry.element, key);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const entry of entries) {
    const key = keys.get(entry.element) ?? '';
    if (counts.get(key) !== 1) continue;
    if (!seenElements.has(entry.element)) {
      const remembered = idFingerprints.get(key);
      if (
        remembered &&
        remembered.expiresAt > now &&
        !idsInPass.has(remembered.vfeId) &&
        remembered.vfeId !== entry.vfeId
      ) {
        entry.element.setAttribute(VFE_ID_ATTRIBUTE, remembered.vfeId);
        idsInPass.delete(entry.vfeId);
        entry.vfeId = remembered.vfeId;
        idsInPass.add(remembered.vfeId);
      }
    }
    seenElements.add(entry.element);
    idFingerprints.set(key, { vfeId: entry.vfeId, expiresAt: now + REUSE_TTL_MS });
  }
}

/** The Eyes, complete: a validated `PageState` snapshot of the page. */
export function distillPage(options: DistillOptions = {}): PageState {
  clearContextCache();
  const discovery = discoverInteractiveElements({
    ...(options.root ? { root: options.root } : {}),
    ...(options.maxElements === undefined ? {} : { maxElements: options.maxElements }),
  });

  const entries = discovery.elements.map((entry) => ({
    element: entry.element,
    vfeId: entry.vfeId,
    badgeIndex: entry.badgeIndex,
  }));
  reassignIds(entries);

  const elements: FormElement[] = entries.map((entry) =>
    serializeElement(entry.element, entry.vfeId, entry.badgeIndex, {
      includeValues: options.includeValues ?? true,
    }),
  );

  const state: PageState = { urlOrAppTitle: pageTitle(), elements };
  const globalErrors = collectGlobalErrors();
  if (globalErrors.length > 0) state.globalErrors = globalErrors;
  return state;
}

interface FingerprintState {
  value: unknown;
  disabled: boolean;
  focused: boolean;
  validationError?: string;
  optionsLength: number;
}

function snapshot(element: FormElement): FingerprintState {
  return {
    value: element.value,
    disabled: element.disabled,
    focused: element.focused,
    ...(element.validationError === undefined ? {} : { validationError: element.validationError }),
    optionsLength: element.options?.length ?? 0,
  };
}

export function diffPageStates(
  before: PageState | null,
  after: PageState,
): Pick<StateChange, 'added' | 'removed' | 'updated'> {
  if (!before) {
    return {
      added: after.elements.map((element) => element.id),
      removed: [],
      updated: [],
    };
  }
  const beforeById = new Map(before.elements.map((element) => [element.id, element]));
  const afterById = new Map(after.elements.map((element) => [element.id, element]));
  const added = after.elements.filter((element) => !beforeById.has(element.id)).map((el) => el.id);
  const removed = before.elements
    .filter((element) => !afterById.has(element.id))
    .map((el) => el.id);
  const updated = after.elements
    .filter((element) => {
      const previous = beforeById.get(element.id);
      if (!previous) return false;
      return JSON.stringify(snapshot(previous)) !== JSON.stringify(snapshot(element));
    })
    .map((element) => element.id);
  return { added, removed, updated };
}

const IGNORED_ATTRIBUTE_PREFIX = 'data-vfe-';

function isOwnMutation(records: MutationRecord[]): boolean {
  if (records.length === 0) return true;
  return records.every(
    (record) =>
      record.type === 'attributes' &&
      record.attributeName !== null &&
      record.attributeName.startsWith(IGNORED_ATTRIBUTE_PREFIX),
  );
}

/**
 * Debounced, shadow-aware mutation watcher. Emits a `StateChange` whenever the
 * distilled page state actually changes — never for its own tag writes.
 */
export function watchPage(
  onChange: (change: StateChange) => void,
  options: DistillOptions = {},
): PageWatcher {
  const root = options.root ?? document;
  const debounceMs = options.observerDebounceMs ?? 120;
  const maxWaitMs = 500;
  const maxElements = options.maxElements;

  let previous: PageState | null = null;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstPendingAt = 0;
  const observers: MutationObserver[] = [];

  const observeRoots = (): void => {
    if (typeof MutationObserver === 'undefined') return;
    const { roots } = collectRoots(root);
    const observed = new Set(
      observers.map((observer) => (observer as MutationObserver & { __root?: Node }).__root),
    );
    for (const currentRoot of roots) {
      if (observed.has(currentRoot)) continue;
      const observer = new MutationObserver((records) => {
        if (isOwnMutation(records)) return;
        schedule();
      }) as MutationObserver & { __root?: Node };
      observer.__root = currentRoot;
      observer.observe(currentRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
        attributeFilter: [
          'data-vfe-id',
          'aria-hidden',
          'aria-invalid',
          'aria-expanded',
          'disabled',
          'value',
          'class',
          'style',
          'hidden',
          'role',
          'aria-checked',
          'aria-label',
          'placeholder',
          'type',
          'required',
        ],
      });
      observers.push(observer);
    }
  };

  const run = (reason: StateChange['reason']): StateChange => {
    const pageState = distillPage({
      ...(options.root ? { root: options.root } : {}),
      ...(maxElements === undefined ? {} : { maxElements }),
      ...(options.includeValues === undefined ? {} : { includeValues: options.includeValues }),
    });
    const diff = diffPageStates(previous, pageState);
    previous = pageState;
    return { pageState, ...diff, reason };
  };

  const fire = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    firstPendingAt = 0;
    observeRoots();
    const change = run('mutation');
    if (change.added.length === 0 && change.removed.length === 0 && change.updated.length === 0)
      return;
    onChange(change);
  };

  function schedule(): void {
    if (!running) return;
    const now = Date.now();
    if (firstPendingAt === 0) firstPendingAt = now;
    const elapsed = now - firstPendingAt;
    const delay = Math.max(0, Math.min(debounceMs, maxWaitMs - elapsed));
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, delay);
  }

  const onUserEvent = (): void => schedule();

  const start = (): void => {
    if (running) return;
    running = true;
    previous = distillPage({
      ...(options.root ? { root: options.root } : {}),
      ...(maxElements === undefined ? {} : { maxElements }),
      ...(options.includeValues === undefined ? {} : { includeValues: options.includeValues }),
    });
    observeRoots();
    root.addEventListener('input', onUserEvent, true);
    root.addEventListener('change', onUserEvent, true);
    root.addEventListener('focusin', onUserEvent, true);
    root.addEventListener('focusout', onUserEvent, true);
  };

  const stop = (): void => {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    firstPendingAt = 0;
    for (const observer of observers.splice(0)) observer.disconnect();
    root.removeEventListener('input', onUserEvent, true);
    root.removeEventListener('change', onUserEvent, true);
    root.removeEventListener('focusin', onUserEvent, true);
    root.removeEventListener('focusout', onUserEvent, true);
  };

  return {
    start,
    stop,
    refresh: () => {
      observeRoots();
      return run('manual');
    },
    current: () => previous,
  };
}

/** Badge attribute helper reused by the HUD (kept here so timings stay in one place). */
export const BADGE_ATTRIBUTE = VFE_BADGE_ATTRIBUTE;
export { serializeElement } from './serialize';
