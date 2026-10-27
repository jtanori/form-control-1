import type { Action, ActionResult } from '@vfe/protocol';
import { describe, expect, it } from 'vitest';

import { mockLayout } from '../../../vitest.setup';
import { executeActions, type ActionHandlers } from '../src/hands/execute';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ok(action: Action, warnings: string[] = []): ActionResult {
  return { action, ok: true, warnings, durationMs: 0 };
}

function handlers(overrides: Partial<ActionHandlers> = {}): Partial<ActionHandlers> {
  return {
    fill: async (targetId) => ok({ action: 'FILL', targetId, value: '' }),
    clear: async (targetId) => ok({ action: 'CLEAR', targetId }),
    select: async (targetId, value) => ok({ action: 'SELECT', targetId, value }),
    setChecked: async (targetId, checked) => ok({ action: 'SET_CHECKED', targetId, checked }),
    click: async (targetId) => ok({ action: 'CLICK', targetId }),
    focus: async (targetId) => ok({ action: 'FOCUS', targetId }),
    scroll: async (direction) => ok({ action: 'SCROLL', direction }),
    ...overrides,
  };
}

const fill = (targetId: string, value = 'x'): Action => ({ action: 'FILL', targetId, value });

describe('executeActions', () => {
  it('executes actions strictly in order', async () => {
    const seen: string[] = [];
    const report = await executeActions(
      [fill('a'), fill('b'), { action: 'CLICK', targetId: 'c' }],
      {
        stepDelayMs: 0,
        handlers: handlers({
          fill: async (targetId) => {
            seen.push(targetId);
            return ok({ action: 'FILL', targetId, value: '' });
          },
          click: async (targetId) => {
            seen.push(targetId);
            return ok({ action: 'CLICK', targetId });
          },
        }),
      },
    );
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(report.ok).toBe(true);
    expect(report.results).toHaveLength(3);
    expect(report.trace.map((entry) => entry.index)).toEqual([0, 1, 2]);
  });

  it('applies the step delay between actions but not after the last', async () => {
    const started = Date.now();
    await executeActions([fill('a'), fill('b')], { stepDelayMs: 60, handlers: handlers() });
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });

  it('does not consume the step delay after SCROLL', async () => {
    const report = await executeActions(
      [fill('a'), { action: 'SCROLL', direction: 'bottom' }, fill('b')],
      { stepDelayMs: 0, settleMs: 40, handlers: handlers() },
    );
    expect(report.ok).toBe(true);
    expect(report.totalMs).toBeLessThan(200);
  });

  it('keeps going after a missing target and reports firstError', async () => {
    const report = await executeActions([fill('a'), fill('missing'), fill('c')], {
      stepDelayMs: 0,
      retryDelayMs: 0,
      handlers: handlers({
        fill: async (targetId) =>
          targetId === 'missing'
            ? {
                action: { action: 'FILL', targetId, value: 'x' },
                ok: false,
                error: { code: 'ELEMENT_NOT_FOUND', message: 'nope' },
                warnings: [],
                durationMs: 0,
              }
            : ok({ action: 'FILL', targetId, value: 'x' }),
      }),
    });
    expect(report.ok).toBe(false);
    expect(report.results).toHaveLength(3);
    expect(report.results[1]?.error?.code).toBe('ELEMENT_NOT_FOUND');
    expect(report.firstError?.error?.code).toBe('ELEMENT_NOT_FOUND');
  });

  it('stops on the first hard failure when stopOnError is set', async () => {
    const report = await executeActions([fill('a'), fill('b'), fill('c')], {
      stopOnError: true,
      stepDelayMs: 0,
      handlers: handlers({
        fill: async (targetId) =>
          targetId === 'b'
            ? {
                action: { action: 'FILL', targetId, value: 'x' },
                ok: false,
                error: { code: 'VALUE_INVALID', message: 'bad' },
                warnings: [],
                durationMs: 0,
              }
            : ok({ action: 'FILL', targetId, value: 'x' }),
      }),
    });
    expect(report.results).toHaveLength(2);
    expect(report.aborted).toBe(false);
  });

  it('retries transient failures once', async () => {
    let calls = 0;
    const report = await executeActions([fill('a')], {
      retryDelayMs: 0,
      handlers: handlers({
        fill: async (targetId) => {
          calls += 1;
          if (calls === 1) {
            return {
              action: { action: 'FILL', targetId, value: 'x' },
              ok: false,
              error: { code: 'ELEMENT_NOT_FOUND', message: 'race' },
              warnings: [],
              durationMs: 0,
            };
          }
          return ok({ action: 'FILL', targetId, value: 'x' });
        },
      }),
    });
    expect(calls).toBe(2);
    expect(report.ok).toBe(true);
    expect(report.results).toHaveLength(1);
  });

  it('never retries hard failures', async () => {
    let calls = 0;
    await executeActions([{ action: 'SELECT', targetId: 'a', value: 'nope' }], {
      retryDelayMs: 0,
      handlers: handlers({
        select: async (targetId, value) => {
          calls += 1;
          return {
            action: { action: 'SELECT', targetId, value },
            ok: false,
            error: { code: 'OPTION_NOT_FOUND', message: 'nope' },
            warnings: [],
            durationMs: 0,
          };
        },
      }),
    });
    expect(calls).toBe(1);
  });

  it('enforces a per-action timeout and continues', async () => {
    const report = await executeActions([fill('slow'), fill('fast')], {
      actionTimeoutMs: 20,
      stepDelayMs: 0,
      handlers: handlers({
        fill: async (targetId) => {
          if (targetId === 'slow') await delay(500);
          return ok({ action: 'FILL', targetId, value: 'x' });
        },
      }),
    });
    expect(report.results[0]?.error?.code).toBe('TIMEOUT');
    expect(report.results[1]?.ok).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('reports ABORTED results for a cancelled queue', async () => {
    const controller = new AbortController();
    controller.abort();
    const report = await executeActions([fill('a'), fill('b')], {
      signal: controller.signal,
      handlers: handlers(),
    });
    expect(report.aborted).toBe(true);
    expect(report.results.map((result) => result.error?.code)).toEqual(['ABORTED', 'ABORTED']);
  });

  it('stops at ASK_CLARIFICATION after executing prior actions', async () => {
    const clicked: string[] = [];
    const report = await executeActions(
      [
        fill('a'),
        { action: 'ASK_CLARIFICATION', questionToUser: 'Which address?' },
        { action: 'CLICK', targetId: 'submit' },
      ],
      {
        stepDelayMs: 0,
        handlers: handlers({
          click: async (targetId) => {
            clicked.push(targetId);
            return ok({ action: 'CLICK', targetId });
          },
        }),
      },
    );
    expect(report.aborted).toBe(true);
    expect(report.results).toHaveLength(2);
    expect(report.results[1]?.warnings).toContain('CLARIFICATION_REQUESTED');
    expect(clicked).toEqual([]);
  });

  it('detects a submit click, warns and skips trailing actions', async () => {
    document.body.innerHTML =
      '<button id="submit" type="submit" data-vfe-id="vfe_9">Place order</button>';
    mockLayout(document.getElementById('submit') as HTMLElement);
    const after: string[] = [];
    const report = await executeActions([{ action: 'CLICK', targetId: 'vfe_9' }, fill('after')], {
      submitSettleMs: 0,
      stepDelayMs: 0,
      handlers: handlers({
        fill: async (targetId) => {
          after.push(targetId);
          return ok({ action: 'FILL', targetId, value: 'x' });
        },
      }),
    });
    expect(report.results[0]?.warnings).toContain('POSSIBLE_NAVIGATION');
    expect(after).toEqual([]);
    expect(report.results).toHaveLength(1);
  });

  it('throws a TypeError for a non-array input', () => {
    expect(() => executeActions(null as unknown as Action[])).toThrow(TypeError);
    expect(() => executeActions({} as unknown as Action[])).toThrow(TypeError);
  });

  it('fires start and end callbacks once per action with indices', async () => {
    const starts: number[] = [];
    const ends: number[] = [];
    await executeActions([fill('a'), fill('b')], {
      stepDelayMs: 0,
      handlers: handlers(),
      onActionStart: (_action, index, total) => starts.push(index * 10 + total),
      onActionEnd: (result, index, total) => ends.push(index * 10 + total + (result.ok ? 0 : 1)),
    });
    expect(starts).toEqual([2, 12]);
    expect(ends).toEqual([2, 12]);
  });

  it('serialises concurrent queues so DOM writes never interleave', async () => {
    const log: string[] = [];
    const slowHandlers = handlers({
      fill: async (targetId) => {
        log.push(`start-${targetId}`);
        await delay(10);
        log.push(`end-${targetId}`);
        return ok({ action: 'FILL', targetId, value: 'x' });
      },
    });
    const first = executeActions([fill('a')], { handlers: slowHandlers, stepDelayMs: 0 });
    const second = executeActions([fill('b')], { handlers: slowHandlers, stepDelayMs: 0 });
    await Promise.all([first, second]);
    expect(log).toEqual(['start-a', 'end-a', 'start-b', 'end-b']);
  });

  it('drops malformed actions and records a failure', async () => {
    const report = await executeActions([{ action: 'EXPLODE' } as unknown as Action, fill('a')], {
      stepDelayMs: 0,
      handlers: handlers(),
    });
    expect(report.results).toHaveLength(2);
    expect(report.results[0]?.ok).toBe(false);
    expect(report.results[0]?.error?.code).toBe('VALUE_INVALID');
    expect(report.results[1]?.ok).toBe(true);
  });

  it('passes real options through to the default handlers (ELEMENT_NOT_FOUND)', async () => {
    const report = await executeActions([fill('vfe_404')], {
      retries: 0,
      stepDelayMs: 0,
      actionTimeoutMs: 1000,
    });
    expect(report.results[0]?.error?.code).toBe('ELEMENT_NOT_FOUND');
  });
});
