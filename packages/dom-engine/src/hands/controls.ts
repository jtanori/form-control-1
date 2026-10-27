import type { Action, ActionResult } from '@vfe/protocol';

import { dispatch, nextFrame, nowMs, sleep } from './dispatch';
import {
  activeElementAcrossRoots,
  failure,
  setNativeChecked,
  setNativeValue,
  success,
  withElement,
  type InteractionOptions,
} from './element';
import { hasBox, pointerClick, proxyLabelFor } from './pointer';

export interface ControlOptions extends InteractionOptions {
  /** How long to wait for a custom dropdown to open. Default 800 ms. */
  openTimeoutMs?: number;
}

export interface OptionLike {
  label: string;
  value: string;
}

export type OptionMatch =
  | { ok: true; option: OptionLike }
  | { ok: false; reason: 'not-found' | 'ambiguous'; candidates: string[] };

function normaliseText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const ACRONYM_STOP_WORDS = new Set(['of', 'the', 'and', 'de', 'la']);

function acronymOf(text: string): string {
  return text
    .split(/\s+/)
    .filter((word) => !ACRONYM_STOP_WORDS.has(word.replace(/[^a-z0-9]/gi, '').toLowerCase()))
    .map((word) => word.replace(/[^a-z0-9]/gi, '')[0] ?? '')
    .join('')
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let column = 1; column <= b.length; column += 1) {
    let previous = rows[0] ?? 0;
    rows[0] = column;
    for (let row = 1; row <= a.length; row += 1) {
      const current = rows[row] ?? 0;
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      rows[row] = Math.min((rows[row] ?? 0) + 1, (rows[row - 1] ?? 0) + 1, previous + cost);
      previous = current;
    }
  }
  return rows[a.length] ?? 0;
}

/** The SELECT matching waterfall: first hit wins, ambiguity never guesses. */
export function matchOption(options: OptionLike[], query: string): OptionMatch {
  const wanted = query.trim();
  const exactValue = options.filter((option) => option.value === wanted);
  if (exactValue.length === 1) return { ok: true, option: exactValue[0] as OptionLike };
  if (exactValue.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: exactValue.map((o) => o.label) };
  }

  const ciValue = options.filter((option) => option.value.toLowerCase() === wanted.toLowerCase());
  if (ciValue.length === 1) return { ok: true, option: ciValue[0] as OptionLike };
  if (ciValue.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: ciValue.map((o) => o.label) };
  }

  const exactLabel = options.filter((option) => option.label.trim() === wanted);
  if (exactLabel.length === 1) return { ok: true, option: exactLabel[0] as OptionLike };
  if (exactLabel.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: exactLabel.map((o) => o.label) };
  }

  const ciLabel = options.filter(
    (option) => option.label.trim().toLowerCase() === wanted.toLowerCase(),
  );
  if (ciLabel.length === 1) return { ok: true, option: ciLabel[0] as OptionLike };
  if (ciLabel.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: ciLabel.map((o) => o.label) };
  }

  const normalisedWanted = normaliseText(wanted);
  const normalised = options.filter((option) => normaliseText(option.label) === normalisedWanted);
  if (normalised.length === 1) return { ok: true, option: normalised[0] as OptionLike };
  if (normalised.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: normalised.map((o) => o.label) };
  }

  const acronym = options.filter((option) => acronymOf(option.label) === normalisedWanted);
  if (acronym.length === 1) return { ok: true, option: acronym[0] as OptionLike };
  if (acronym.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: acronym.map((o) => o.label) };
  }

  if (wanted.length >= 3) {
    const prefix = options.filter((option) =>
      option.label.trim().toLowerCase().startsWith(wanted.toLowerCase()),
    );
    if (prefix.length === 1) return { ok: true, option: prefix[0] as OptionLike };
  }

  const substring = options.filter((option) =>
    normaliseText(option.label).includes(normalisedWanted),
  );
  if (substring.length === 1) return { ok: true, option: substring[0] as OptionLike };
  if (substring.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: substring.map((o) => o.label) };
  }

  const scored = options
    .map((option) => ({
      option,
      distance: levenshtein(normaliseText(option.label), normalisedWanted),
    }))
    .filter((entry) => entry.distance <= 2)
    .sort((a, b) => a.distance - b.distance);
  if (scored.length === 1)
    return { ok: true, option: (scored[0] as { option: OptionLike }).option };
  if (scored.length > 1 && scored[0]?.distance !== scored[1]?.distance) {
    return { ok: true, option: (scored[0] as { option: OptionLike }).option };
  }
  if (scored.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      candidates: scored.map((entry) => entry.option.label),
    };
  }

  return { ok: false, reason: 'not-found', candidates: [] };
}

function nodeOptions(select: HTMLSelectElement): OptionLike[] {
  return Array.from(select.options, (option) => ({
    label: (option.textContent ?? '').trim(),
    value: option.value,
  }));
}

function selectNativeOption(el: HTMLSelectElement, query: string, action: Action): ActionResult {
  const startedAt = nowMs();
  const options = nodeOptions(el);
  const match = matchOption(options, query);
  if (!match.ok) {
    return failure(action, 'OPTION_NOT_FOUND', `No option matches "${query}"`, startedAt, {
      details:
        match.reason === 'ambiguous'
          ? { ambiguous: match.candidates.slice(0, 20) }
          : { available: options.map((option) => option.label).slice(0, 20) },
    });
  }

  el.focus?.({ preventScroll: true });
  dispatch(el, 'focus', { bubbles: false });
  dispatch(el, 'focusin', {});

  if (el.multiple) {
    for (const option of Array.from(el.options))
      option.selected = option.value === match.option.value;
  } else {
    setNativeValue(el, match.option.value);
  }
  dispatch(el, 'input', { inputType: 'insertText', data: match.option.value });
  dispatch(el, 'change', {});
  dispatch(el, 'keyup', { key: 'Unidentified' });

  if (el.multiple) {
    const selected = Array.from(el.selectedOptions, (option) => option.value);
    if (!selected.includes(match.option.value)) {
      return failure(action, 'VALUE_MISMATCH', 'Option was not selected', startedAt, {
        details: { expected: match.option.value, actual: selected },
      });
    }
  } else if (el.value !== match.option.value) {
    return failure(action, 'VALUE_MISMATCH', 'Select did not change', startedAt, {
      details: { expected: match.option.value, actual: el.value },
    });
  }

  return success(action, startedAt);
}

function isVisibleOption(option: Element): boolean {
  const style = getComputedStyle(option);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function visibleAriaOptions(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).filter(
    isVisibleOption,
  );
}

async function ariaSelect(
  action: Action,
  el: HTMLElement,
  query: string,
  options: ControlOptions,
): Promise<ActionResult> {
  const startedAt = nowMs();
  const timeoutMs = options.openTimeoutMs ?? 800;

  const expanded = el.getAttribute('aria-expanded') === 'true';
  if (!expanded && visibleAriaOptions().length === 0) {
    pointerClick(el);
    const deadline = nowMs() + timeoutMs;
    while (nowMs() < deadline && visibleAriaOptions().length === 0) await sleep(25);
  }

  const candidates = visibleAriaOptions();
  const match = matchOption(
    candidates.map((option) => ({
      label: (option.textContent ?? '').replace(/\s+/g, ' ').trim(),
      value: option.getAttribute('data-value') ?? (option.textContent ?? '').trim(),
    })),
    query,
  );

  if (!match.ok) {
    if (candidates.length === 0) {
      if (el.getAttribute('role') === 'combobox' && el.tagName === 'INPUT') {
        setNativeValue(el, query);
        dispatch(el, 'input', { inputType: 'insertText', data: query });
        await sleep(150);
        const retry = visibleAriaOptions();
        const retryMatch = matchOption(
          retry.map((option) => ({
            label: option.textContent ?? '',
            value: option.textContent ?? '',
          })),
          query,
        );
        if (retryMatch.ok) {
          const target = retry.find(
            (option) => (option.textContent ?? '').trim() === retryMatch.option.label,
          );
          if (target) {
            pointerClick(target);
            return success(action, startedAt);
          }
        }
        dispatch(el, 'keydown', { key: 'ArrowDown', code: 'ArrowDown' });
        dispatch(el, 'keydown', { key: 'Enter', code: 'Enter' });
        return success(action, startedAt, ['TYPEAHEAD_FALLBACK']);
      }
      dispatch(el, 'keydown', { key: 'Escape', code: 'Escape' });
      return failure(action, 'TIMEOUT', 'The option list never opened', startedAt);
    }
    return failure(action, 'OPTION_NOT_FOUND', `No option matches "${query}"`, startedAt, {
      details:
        match.reason === 'ambiguous'
          ? { ambiguous: match.candidates.slice(0, 20) }
          : { available: candidates.map((option) => option.textContent?.trim()).slice(0, 20) },
    });
  }

  const target =
    candidates.find((option) => (option.textContent ?? '').trim() === match.option.label) ??
    candidates.find((option) => (option.getAttribute('data-value') ?? '') === match.option.value);
  if (!target) return failure(action, 'OPTION_NOT_FOUND', 'Matched option disappeared', startedAt);

  pointerClick(target);
  await nextFrame();

  const stillExpanded = el.getAttribute('aria-expanded') === 'true';
  const text = (el.textContent ?? '').toLowerCase();
  if (stillExpanded && !text.includes(match.option.label.toLowerCase())) {
    return failure(action, 'VALUE_MISMATCH', 'The combobox did not accept the option', startedAt, {
      details: { optionClicked: true },
    });
  }
  return success(action, startedAt);
}

/** SELECT: native select or an ARIA combobox/listbox state machine. */
export async function selectOption(
  targetId: string,
  value: string,
  options: ControlOptions = {},
): Promise<ActionResult> {
  const action: Action = { action: 'SELECT', targetId, value };
  return withElement(
    action,
    { scroll: options.scroll, timeoutMs: options.timeoutMs, signal: options.signal },
    async (el) => {
      if (el.tagName === 'SELECT')
        return selectNativeOption(el as HTMLSelectElement, value, action);
      const role = el.getAttribute('role');
      if (role === 'combobox' || role === 'listbox' || el.tagName === 'INPUT') {
        return ariaSelect(action, el, value, options);
      }
      return failure(action, 'ELEMENT_NOT_FILLABLE', 'Not a select or combobox', nowMs());
    },
  );
}

/** SET_CHECKED: idempotent checkbox/radio/switch handling, proxy-aware. */
export async function setChecked(
  targetId: string,
  checked: boolean,
  options: ControlOptions = {},
): Promise<ActionResult> {
  const action: Action = { action: 'SET_CHECKED', targetId, checked };
  return withElement(
    action,
    { scroll: options.scroll, timeoutMs: options.timeoutMs, signal: options.signal },
    async (el) => {
      const startedAt = nowMs();
      const isNative = el.tagName === 'INPUT';
      const native = el as HTMLInputElement;

      const current = isNative ? native.checked : el.getAttribute('aria-checked') === 'true';
      if (current === checked) return success(action, startedAt, ['NO_OP']);

      const proxy = proxyLabelFor(el);
      if (hasBox(el)) {
        pointerClick(el);
      } else if (proxy && hasBox(proxy)) {
        pointerClick(proxy);
      } else if (isNative) {
        setNativeChecked(native, checked);
        dispatch(el, 'input', {});
        dispatch(el, 'change', {});
      } else {
        el.setAttribute('aria-checked', String(checked));
        dispatch(el, 'click', {});
        dispatch(el, 'input', {});
        dispatch(el, 'change', {});
      }

      await nextFrame();
      const after = isNative ? native.checked : el.getAttribute('aria-checked') === 'true';
      if (after !== checked) {
        return failure(action, 'VALUE_MISMATCH', 'Checkbox did not change', startedAt, {
          details: { expected: checked, actual: after },
        });
      }
      return success(action, startedAt);
    },
  );
}

const SUBMIT_TEXT = /submit|continue|next|pay|sign ?in|log ?in|save/i;

function isSubmitLike(el: HTMLElement): boolean {
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    if (type === 'submit') return true;
  }
  if (el.getAttribute('type') === 'submit') return true;
  const text = (el.textContent ?? '').trim();
  return SUBMIT_TEXT.test(text) || SUBMIT_TEXT.test(el.getAttribute('aria-label') ?? '');
}

/** CLICK: full pointer sequence at the visual centre. */
export async function clickElement(
  targetId: string,
  options: ControlOptions = {},
): Promise<ActionResult> {
  const action: Action = { action: 'CLICK', targetId };
  return withElement(
    action,
    { scroll: options.scroll, timeoutMs: options.timeoutMs, signal: options.signal },
    async (el) => {
      const startedAt = nowMs();
      if (el.matches('a[href^="javascript:"]')) {
        return failure(action, 'VALUE_INVALID', 'Refusing to click a javascript: link', startedAt);
      }
      const submit = isSubmitLike(el);
      pointerClick(el);
      await nextFrame();
      return success(action, startedAt, submit ? ['NAVIGATION'] : []);
    },
  );
}

/** FOCUS: focus and verify the active element, crossing shadow roots. */
export async function focusElement(
  targetId: string,
  options: ControlOptions = {},
): Promise<ActionResult> {
  const action: Action = { action: 'FOCUS', targetId };
  return withElement(
    action,
    { scroll: options.scroll, timeoutMs: options.timeoutMs, signal: options.signal },
    async (el) => {
      const startedAt = nowMs();
      try {
        el.focus({ preventScroll: false });
      } catch {
        el.focus();
      }
      dispatch(el, 'focusin', {});
      await nextFrame();
      const active = activeElementAcrossRoots(el);
      if (active !== el) {
        return failure(action, 'ELEMENT_NOT_FOUND', 'Element did not receive focus', startedAt, {
          details: { activeElement: active?.tagName ?? null },
        });
      }
      return success(action, startedAt);
    },
  );
}

function findScrollContainer(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('[style*="overflow"], main, [role="main"], .content'),
  );
  let best: HTMLElement | null = null;
  let bestDelta = 0;
  for (const candidate of candidates) {
    const delta = candidate.scrollHeight - candidate.clientHeight;
    if (delta > bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }
  return best;
}

/** SCROLL: page or the dominant scroll container. */
export async function scrollPage(
  direction: 'up' | 'down' | 'top' | 'bottom',
  options: ControlOptions = {},
): Promise<ActionResult> {
  const action: Action = { action: 'SCROLL', direction };
  const startedAt = nowMs();
  if (options.signal?.aborted) return failure(action, 'ABORTED', 'Aborted', startedAt);

  const container = findScrollContainer();
  const viewport = typeof window !== 'undefined' ? window.innerHeight : 768;
  const current = container ? container.scrollTop : (window.scrollY ?? 0);

  const next =
    direction === 'top'
      ? 0
      : direction === 'bottom'
        ? container
          ? container.scrollHeight
          : document.body.scrollHeight
        : Math.max(0, current + (direction === 'down' ? viewport * 0.8 : -viewport * 0.8));

  const moved = next !== current;
  try {
    if (container) {
      container.scrollTo?.({ top: next, behavior: 'smooth' });
    } else {
      window.scrollTo?.({ top: next, behavior: 'smooth' });
    }
  } catch {
    /* jsdom does not implement scrolling */
  }

  if (moved) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 400);
      window.addEventListener(
        'scrollend',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
  return success(action, startedAt);
}
