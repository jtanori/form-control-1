import type { Action, ActionErrorCode, ActionResult } from '@vfe/protocol';

import { findByVfeId } from '../eyes/discover';

import { nowMs } from './dispatch';

export interface InteractionOptions {
  scroll?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function actionDuration(startedAt: number): number {
  return Math.max(0, Math.round((nowMs() - startedAt) * 10) / 10);
}

export function success(action: Action, startedAt: number, warnings: string[] = []): ActionResult {
  return { action, ok: true, durationMs: actionDuration(startedAt), warnings };
}

export function failure(
  action: Action,
  code: ActionErrorCode,
  message: string,
  startedAt: number,
  options: { details?: Record<string, unknown>; warnings?: string[] } = {},
): ActionResult {
  return {
    action,
    ok: false,
    error: {
      code,
      message,
      ...(options.details ? { details: options.details } : {}),
    },
    warnings: options.warnings ?? [],
    durationMs: actionDuration(startedAt),
  };
}

export function targetIdOf(action: Action): string | null {
  return 'targetId' in action ? action.targetId : null;
}

export function isContentEditableElement(el: HTMLElement): boolean {
  if (el.isContentEditable === true) return true;
  const attr = el.getAttribute('contenteditable');
  return attr === '' || attr === 'true';
}

export function isElementDisabled(el: HTMLElement): boolean {
  if ((el as HTMLInputElement).disabled === true) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  return el.closest('fieldset[disabled]') !== null;
}

export function activeElementAcrossRoots(el: HTMLElement): Element | null {
  const root = el.getRootNode() as Document | ShadowRoot;
  return root.activeElement ?? document.activeElement;
}

/** Centre of the element is inside the current viewport. */
export function isInViewport(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const width = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const height = typeof window !== 'undefined' ? window.innerHeight : 768;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return centerX >= 0 && centerX <= width && centerY >= 0 && centerY <= height;
}

export async function waitForInViewport(
  el: HTMLElement,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (isInViewport(el)) return;
  const startedAt = nowMs();
  await new Promise<void>((resolve) => {
    const tick = (): void => {
      if (signal?.aborted || isInViewport(el) || nowMs() - startedAt >= timeoutMs) {
        resolve();
        return;
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
      else setTimeout(tick, 16);
    };
    tick();
  });
}

/**
 * Shared interaction prologue: resolve, guard, scroll, focus.
 * Returns either the live element or a typed failure — never throws.
 */
export async function withElement(
  action: Action,
  options: InteractionOptions,
  run: (el: HTMLElement) => Promise<ActionResult>,
): Promise<ActionResult> {
  const startedAt = nowMs();
  const targetId = targetIdOf(action);
  if (!targetId) {
    return failure(action, 'VALUE_INVALID', 'This action needs a targetId', startedAt);
  }
  const el = findByVfeId(targetId);
  if (!el) {
    return failure(
      action,
      'ELEMENT_NOT_FOUND',
      `No element with data-vfe-id="${targetId}"`,
      startedAt,
      {
        details: { targetId },
      },
    );
  }
  if (isElementDisabled(el)) {
    return failure(action, 'ELEMENT_DISABLED', `Element ${targetId} is disabled`, startedAt);
  }

  if (options.scroll !== false) {
    try {
      el.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } catch {
      /* jsdom and older engines do not implement smooth scrolling */
    }
    await waitForInViewport(el, options.timeoutMs ?? 2000, options.signal);
  }
  el.focus?.({ preventScroll: true });
  return run(el);
}

/** Set a control's value through the prototype setter (framework bypass). */
export function setNativeValue(el: HTMLElement, value: string): void {
  const proto =
    el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor?.set) descriptor.set.call(el, value);
  else (el as HTMLInputElement).value = value;

  // React stores its own copy in `_valueTracker`; clearing it makes the next
  // input event look like a real change even in the edge cases where the
  // prototype setter alone is not enough.
  try {
    const tracker = (el as HTMLElement & { _valueTracker?: { setValue: (v: string) => void } })
      ._valueTracker;
    tracker?.setValue('');
  } catch {
    /* tracker internals are private — never fail the fill over this */
  }
}

export function setNativeChecked(el: HTMLInputElement, checked: boolean): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
  if (descriptor?.set) descriptor.set.call(el, checked);
  else el.checked = checked;
}
