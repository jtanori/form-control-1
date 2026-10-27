import type { Action, ActionResult } from '@vfe/protocol';

import { setChecked } from './controls';
import { dispatch, nextFrame, nowMs, sleep } from './dispatch';
import {
  failure,
  isContentEditableElement,
  setNativeValue,
  success,
  targetIdOf,
  withElement,
  type InteractionOptions,
} from './element';
import { normaliseForElement } from './normalise';

export interface FillOptions extends InteractionOptions {
  /** Simulate one event triple per character. Default false. */
  keystrokes?: boolean;
  /** Per-character delay in keystrokes mode. Default 12 ms. */
  keystrokeDelayMs?: number;
  /** Dispatch blur/focusout after the change. Default true. */
  blur?: boolean;
  /** Escape suggestions after filling. Default true. */
  dismissAutocomplete?: boolean;
}

const MAX_KEYSTROKE_LENGTH = 200;

function isTextLike(el: HTMLElement): boolean {
  if (isContentEditableElement(el)) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return ![
    'checkbox',
    'radio',
    'button',
    'submit',
    'reset',
    'file',
    'image',
    'range',
    'color',
  ].includes(type);
}

function isExactType(el: HTMLElement): boolean {
  if (el.tagName !== 'INPUT') return false;
  return ['date', 'number', 'email', 'tel', 'time', 'url'].includes((el as HTMLInputElement).type);
}

function readText(el: HTMLElement): string {
  if (isContentEditableElement(el)) {
    const text = typeof el.innerText === 'string' ? el.innerText : el.textContent;
    return text ?? '';
  }
  return (el as HTMLInputElement).value ?? '';
}

function emitTextEvents(el: HTMLElement, value: string, kind: 'insert' | 'delete'): void {
  const inputType = kind === 'insert' ? 'insertText' : 'deleteContentBackward';
  dispatch(el, 'beforeinput', { inputType, data: kind === 'insert' ? value : null });
  dispatch(el, 'keydown', { key: 'Unidentified' });
  dispatch(el, 'input', { inputType, data: kind === 'insert' ? value : null });
  dispatch(el, 'keyup', { key: 'Unidentified' });
  dispatch(el, 'change', {});
}

function focusEvents(el: HTMLElement): void {
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
  dispatch(el, 'focus', { bubbles: false });
  dispatch(el, 'focusin', {});
}

function selectExisting(el: HTMLElement): void {
  if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
  try {
    (el as HTMLInputElement).setSelectionRange(0, (el as HTMLInputElement).value.length);
  } catch {
    /* number/date inputs reject selection APIs */
  }
}

function fillByKeystrokes(el: HTMLElement, value: string): void {
  setNativeValue(el, '');
  let prefix = '';
  for (const char of value) {
    prefix += char;
    setNativeValue(el, prefix);
    dispatch(el, 'keydown', { key: char });
    dispatch(el, 'input', { inputType: 'insertText', data: char });
    dispatch(el, 'keyup', { key: char });
  }
  dispatch(el, 'change', {});
}

function fillContentEditable(el: HTMLElement, value: string): void {
  el.focus?.();
  try {
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection?.removeAllRanges();
    selection?.addRange(range);
  } catch {
    /* selection APIs are optional in jsdom */
  }
  dispatch(el, 'beforeinput', { inputType: 'insertReplacementText', data: value });
  el.textContent = value;
  dispatch(el, 'input', { inputType: 'insertText', data: value });
  dispatch(el, 'change', {});
}

async function applyFill(
  action: Extract<Action, { action: 'FILL' }>,
  el: HTMLElement,
  rawValue: string,
  options: FillOptions,
): Promise<ActionResult> {
  const startedAt = nowMs();

  if (el.tagName === 'SELECT' || !isTextLike(el)) {
    return failure(
      action,
      'ELEMENT_NOT_FILLABLE',
      `Cannot type into a ${el.tagName.toLowerCase()}`,
      startedAt,
    );
  }
  if ((el as HTMLInputElement).readOnly === true) {
    return failure(action, 'ELEMENT_DISABLED', 'Field is read-only', startedAt, {
      details: { readOnly: true },
    });
  }

  const normalised = normaliseForElement(el, rawValue);
  if (!normalised.ok) {
    return failure(action, 'VALUE_INVALID', normalised.message, startedAt, {
      details: { value: rawValue },
    });
  }

  let value = normalised.value;
  const warnings: string[] = [];
  const maxLength = (el as HTMLInputElement).maxLength;
  if (typeof maxLength === 'number' && maxLength > 0 && value.length > maxLength) {
    value = value.slice(0, maxLength);
    warnings.push('MAXLENGTH_TRUNCATED');
  }

  if (options.keystrokes && value.length > MAX_KEYSTROKE_LENGTH) {
    return failure(
      action,
      'VALUE_INVALID',
      `Keystroke mode is capped at ${MAX_KEYSTROKE_LENGTH} characters`,
      startedAt,
    );
  }

  focusEvents(el);
  selectExisting(el);

  if (isContentEditableElement(el)) {
    fillContentEditable(el, value);
  } else if (options.keystrokes) {
    fillByKeystrokes(el, value);
    if ((options.keystrokeDelayMs ?? 12) > 0)
      await sleep((options.keystrokeDelayMs ?? 12) * value.length);
  } else {
    const allowed = dispatch(el, 'beforeinput', { inputType: 'insertText', data: value });
    setNativeValue(el, value);
    if (!allowed) {
      // A widget rejected the synthetic edit: fall back to per-character events.
      fillByKeystrokes(el, value);
    } else {
      dispatch(el, 'keydown', { key: 'Unidentified' });
      dispatch(el, 'input', { inputType: 'insertText', data: value });
      dispatch(el, 'keyup', { key: 'Unidentified' });
      dispatch(el, 'change', {});
    }
  }

  if (options.dismissAutocomplete !== false) {
    dispatch(el, 'keydown', { key: 'Escape' });
    dispatch(el, 'keyup', { key: 'Escape' });
  }

  if (options.blur !== false) {
    await sleep(0);
    dispatch(el, 'blur', { bubbles: false });
    dispatch(el, 'focusout', {});
  }

  await nextFrame();

  const actual = readText(el);
  const expected = isExactType(el) ? value : value.trim();
  const observed = isExactType(el) ? actual : actual.trim();
  if (observed !== expected) {
    return failure(action, 'VALUE_MISMATCH', 'The page did not keep the value', startedAt, {
      details: { expected: value, actual },
      warnings,
    });
  }

  return success(action, startedAt, warnings);
}

/** FILL: set a text-like control's value through the native setter. */
export async function fillValue(
  targetId: string,
  value: string,
  options: FillOptions = {},
): Promise<ActionResult> {
  const action: Action = { action: 'FILL', targetId, value };
  return withElement(
    action,
    { scroll: options.scroll, timeoutMs: options.timeoutMs, signal: options.signal },
    (el) => applyFill(action as Extract<Action, { action: 'FILL' }>, el, value, options),
  );
}

async function applyClear(
  action: Action,
  el: HTMLElement,
  options: FillOptions,
): Promise<ActionResult> {
  const startedAt = nowMs();

  if (el.tagName === 'SELECT') {
    const select = el as HTMLSelectElement;
    focusEvents(el);
    select.selectedIndex = -1;
    dispatch(el, 'input', { inputType: 'deleteContentBackward' });
    dispatch(el, 'change', {});
    if (select.value !== '' && select.selectedIndex !== -1) {
      return failure(action, 'VALUE_MISMATCH', 'Select did not clear', startedAt, {
        details: { actual: select.value },
      });
    }
    return success(action, startedAt);
  }

  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    if (type === 'checkbox' || type === 'radio') {
      const targetId = targetIdOf(action) ?? '';
      const result = await setChecked(targetId, false, options);
      return { ...result, action };
    }
  }

  if (!isTextLike(el)) {
    return failure(
      action,
      'ELEMENT_NOT_FILLABLE',
      `Cannot clear a ${el.tagName.toLowerCase()}`,
      startedAt,
    );
  }

  focusEvents(el);
  selectExisting(el);
  if (isContentEditableElement(el)) {
    dispatch(el, 'beforeinput', { inputType: 'deleteContentBackward', data: null });
    el.textContent = '';
    dispatch(el, 'input', { inputType: 'deleteContentBackward', data: null });
    dispatch(el, 'change', {});
  } else {
    setNativeValue(el, '');
    emitTextEvents(el, '', 'delete');
  }

  await nextFrame();
  if (readText(el) !== '') {
    return failure(action, 'VALUE_MISMATCH', 'Field did not clear', startedAt, {
      details: { actual: readText(el) },
    });
  }
  return success(action, startedAt);
}

/** CLEAR: empty a control (checkbox/radio are unchecked). */
export async function clearValue(
  targetId: string,
  options: FillOptions = {},
): Promise<ActionResult> {
  const action: Action = { action: 'CLEAR', targetId };
  return withElement(
    action,
    { scroll: options.scroll, timeoutMs: options.timeoutMs, signal: options.signal },
    (el) => applyClear(action, el, options),
  );
}
