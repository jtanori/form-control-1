import { ActionSchema, type Action, type ActionResult } from '@vfe/protocol';

import { findByVfeId } from '../eyes/discover';

import { clickElement, focusElement, scrollPage, selectOption, setChecked } from './controls';
import { nowMs, sleep } from './dispatch';
import { failure } from './element';
import { clearValue, fillValue } from './fill';

export interface ActionHandlers {
  fill: (targetId: string, value: string) => Promise<ActionResult>;
  clear: (targetId: string) => Promise<ActionResult>;
  select: (targetId: string, value: string) => Promise<ActionResult>;
  setChecked: (targetId: string, checked: boolean) => Promise<ActionResult>;
  click: (targetId: string) => Promise<ActionResult>;
  focus: (targetId: string) => Promise<ActionResult>;
  scroll: (direction: 'up' | 'down' | 'top' | 'bottom') => Promise<ActionResult>;
}

export interface ExecuteOptions {
  /** Delay between actions. Default 100 ms. */
  stepDelayMs?: number;
  /** Extra settle time after a change. Default 0. */
  settleMs?: number;
  /** Stop on the first hard failure. Default false. */
  stopOnError?: boolean;
  /** Per-action timeout. Default 4000 ms. */
  actionTimeoutMs?: number;
  /** Retries for transient failures (ELEMENT_NOT_FOUND / TIMEOUT). Default 1. */
  retries?: number;
  /** Delay before a retry. Default 150 ms. */
  retryDelayMs?: number;
  /** Wait after a submit-like click. Default 500 ms. */
  submitSettleMs?: number;
  onActionStart?: (action: Action, index: number, total: number) => void;
  onActionEnd?: (result: ActionResult, index: number, total: number) => void;
  signal?: AbortSignal;
  /** Injection seam for tests; production uses the real Hands. */
  handlers?: Partial<ActionHandlers>;
}

export interface ExecutionReport {
  results: ActionResult[];
  ok: boolean;
  aborted: boolean;
  totalMs: number;
  firstError?: ActionResult;
  /** Compact, value-free trace for debugging. */
  trace: Array<{ index: number; action: string; ok: boolean; code?: string; durationMs: number }>;
}

const TRANSIENT: ReadonlySet<string> = new Set(['ELEMENT_NOT_FOUND', 'TIMEOUT']);
const SUBMIT_TEXT = /submit|continue|next|pay|sign ?in|log ?in|save/i;

const defaultHandlers: ActionHandlers = {
  fill: (targetId, value) => fillValue(targetId, value),
  clear: (targetId) => clearValue(targetId),
  select: (targetId, value) => selectOption(targetId, value),
  setChecked: (targetId, checked) => setChecked(targetId, checked),
  click: (targetId) => clickElement(targetId),
  focus: (targetId) => focusElement(targetId),
  scroll: (direction) => scrollPage(direction),
};

function abortedResult(action: Action, startedAt: number): ActionResult {
  return failure(action, 'ABORTED', 'The action was cancelled', startedAt);
}

function isSubmitTarget(targetId: string): boolean {
  const el = findByVfeId(targetId);
  if (!el) return false;
  if (el.getAttribute('type') === 'submit') return true;
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'submit') return true;
  const text = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
  return SUBMIT_TEXT.test(text);
}

async function runWithTimeout(
  action: Action,
  handler: () => Promise<ActionResult>,
  timeoutMs: number,
): Promise<ActionResult> {
  const startedAt = nowMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ActionResult>((resolve) => {
    timer = setTimeout(
      () => resolve(failure(action, 'TIMEOUT', `Action exceeded ${timeoutMs} ms`, startedAt)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([handler(), timeout]);
  } catch (error) {
    return failure(
      action,
      'VALUE_INVALID',
      error instanceof Error ? error.message : 'Handler failed',
      startedAt,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function invoke(action: Action, handlers: ActionHandlers): Promise<ActionResult> {
  switch (action.action) {
    case 'FILL':
      return handlers.fill(action.targetId, action.value);
    case 'CLEAR':
      return handlers.clear(action.targetId);
    case 'SELECT':
      return handlers.select(action.targetId, action.value);
    case 'SET_CHECKED':
      return handlers.setChecked(action.targetId, action.checked);
    case 'CLICK':
      return handlers.click(action.targetId);
    case 'FOCUS':
      return handlers.focus(action.targetId);
    case 'SCROLL':
      return handlers.scroll(action.direction);
    case 'ASK_CLARIFICATION':
      return { action, ok: true, warnings: ['CLARIFICATION_REQUESTED'], durationMs: 0 };
  }
}

/** One mutex for every queue so two batches can never interleave DOM writes. */
let chain: Promise<unknown> = Promise.resolve();

async function runQueue(actions: Action[], options: ExecuteOptions): Promise<ExecutionReport> {
  const startedAt = nowMs();
  const total = actions.length;
  const results: ActionResult[] = [];
  const trace: ExecutionReport['trace'] = [];
  const handlers: ActionHandlers = { ...defaultHandlers, ...options.handlers };
  const stepDelayMs = options.stepDelayMs ?? 100;
  const settleMs = options.settleMs ?? 0;
  const actionTimeoutMs = options.actionTimeoutMs ?? 4000;
  const retries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 150;
  const submitSettleMs = options.submitSettleMs ?? 500;

  const push = (result: ActionResult, index: number): void => {
    results.push(result);
    trace.push({
      index,
      action: result.action?.action ?? 'UNKNOWN',
      ok: result.ok,
      ...(result.error ? { code: result.error.code } : {}),
      durationMs: result.durationMs,
    });
    options.onActionEnd?.(result, index, total);
  };

  const parsed: Array<Action | null> = actions.map((action) => {
    const result = ActionSchema.safeParse(action);
    return result.success ? result.data : null;
  });

  let aborted = false;
  let skipTrailing = false;

  for (let index = 0; index < total; index += 1) {
    const action = parsed[index];
    if (skipTrailing) break;

    if (!action) {
      push(
        failure(
          { action: 'ASK_CLARIFICATION', questionToUser: '' } as Action,
          'VALUE_INVALID',
          'Malformed action dropped',
          nowMs(),
        ),
        index,
      );
      if (options.stopOnError) break;
      continue;
    }

    if (options.signal?.aborted) {
      aborted = true;
      for (let rest = index; rest < total && parsed[rest] !== undefined; rest += 1) {
        const restAction = parsed[rest];
        if (!restAction) continue;
        push(abortedResult(restAction, nowMs()), rest);
      }
      break;
    }

    options.onActionStart?.(action, index, total);

    if (action.action === 'ASK_CLARIFICATION') {
      push({ action, ok: true, warnings: ['CLARIFICATION_REQUESTED'], durationMs: 0 }, index);
      aborted = true;
      break;
    }

    let result = await runWithTimeout(action, () => invoke(action, handlers), actionTimeoutMs);

    for (let attempt = 0; attempt < retries; attempt += 1) {
      if (result.ok || !TRANSIENT.has(result.error?.code ?? '')) break;
      await sleep(retryDelayMs);
      if (options.signal?.aborted) break;
      result = await runWithTimeout(action, () => invoke(action, handlers), actionTimeoutMs);
    }

    const isSubmitClick = action.action === 'CLICK' && result.ok && isSubmitTarget(action.targetId);
    if (isSubmitClick) {
      result = {
        ...result,
        warnings: Array.from(new Set([...result.warnings, 'POSSIBLE_NAVIGATION'])),
      };
    }

    push(result, index);

    if (!result.ok && options.stopOnError) break;

    if (isSubmitClick) {
      await sleep(submitSettleMs);
      skipTrailing = true;
      continue;
    }

    const isLast = index === total - 1;
    if (!isLast && action.action !== 'SCROLL') {
      await sleep(stepDelayMs + settleMs);
    }
  }

  const ok = results.every((result) => result.ok);
  const firstError = results.find((result) => !result.ok);
  return {
    results,
    ok,
    aborted,
    totalMs: Math.round((nowMs() - startedAt) * 10) / 10,
    ...(firstError ? { firstError } : {}),
    trace,
  };
}

/**
 * Execute a batch of actions strictly in order, resiliently, with typed
 * results. DOM failures never throw; a non-array input throws a TypeError.
 */
export function executeActions(
  actions: Action[],
  options: ExecuteOptions = {},
): Promise<ExecutionReport> {
  if (!Array.isArray(actions)) throw new TypeError('executeActions expects an array of actions');
  const task = chain.then(() => runQueue(actions, options));
  chain = task.catch(() => undefined);
  return task;
}
