import type { Action, ExecutionReport } from '@vfe/dom-engine';
import type { PageState } from '@vfe/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLoopDriver, SILENCE_TIMEOUT_MS } from '../src/loop/driver';

const page: PageState = { urlOrAppTitle: 'Checkout', elements: [] };

function emptyReport(ok = true, failures: string[] = []): ExecutionReport {
  return {
    results: [],
    ok,
    aborted: false,
    totalMs: 5,
    trace: [],
    ...(failures.length > 0 ? { firstError: undefined } : {}),
  } as ExecutionReport;
}

function setup(options: { execute?: (actions: Action[]) => Promise<ExecutionReport> } = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const statuses: string[] = [];
  const messages: Array<{ text: string; kind?: string }> = [];
  const hints: string[] = [];
  const flashes: Array<{ id: string; result?: string }> = [];
  const spoken: string[] = [];
  const execute = vi.fn(options.execute ?? (async () => emptyReport()));
  const driver = createLoopDriver({
    hud: {
      setStatus: (status) => statuses.push(status),
      setMessage: (text, kind) => messages.push({ text, ...(kind ? { kind } : {}) }),
      setActionsProgress: () => undefined,
      showHint: (text) => hints.push(text),
    },
    badges: {
      sync: () => undefined,
      flash: (id, result) => flashes.push({ id, ...(result ? { result } : {}) }),
    },
    distill: () => page,
    send: (message) => {
      sent.push(message as Record<string, unknown>);
    },
    execute: execute as never,
    speak: async (text) => {
      spoken.push(text);
    },
    stopSpeaking: () => spoken.push('__stop__'),
    labelOf: (id) => (id === 'vfe_email' ? 'Email address' : 'Full name'),
  });
  return { driver, sent, statuses, messages, hints, flashes, spoken, execute };
}

/** Fake timers still need microtasks flushed; timers never run here. */
const tick = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => undefined);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('activation', () => {
  it('arms the worker with the freshest page state', async () => {
    const { driver, sent, statuses } = setup();
    driver.activate();
    await tick();
    expect(statuses.at(-1)).toBe('listening');
    expect(sent[0]).toEqual({ type: 'AUDIO_START' });
    expect(sent[1]).toMatchObject({ type: 'LOOP_ARMED', generation: 1, pageState: page });
  });

  it('auto-stops listening after the silence timeout', async () => {
    const { driver, sent, hints, statuses } = setup();
    driver.activate();
    await vi.advanceTimersByTimeAsync(SILENCE_TIMEOUT_MS);
    expect(driver.getState()).toEqual({ kind: 'idle' });
    expect(statuses.at(-1)).toBe('idle');
    expect(hints.at(-1)).toContain('Alt+V');
    expect(sent.some((message) => message.type === 'AUDIO_STOP')).toBe(true);
  });

  it('cancels the silence timer when speech ends first', async () => {
    const { driver, hints } = setup();
    driver.activate();
    driver.handleMessage({ type: 'LOOP_TRANSCRIBING', generation: 1 });
    await vi.advanceTimersByTimeAsync(SILENCE_TIMEOUT_MS + 100);
    expect(hints).toEqual([]);
    expect(driver.getState().kind).toBe('transcribing');
  });
});

describe('brain round trip', () => {
  it('executes actions, flashes badges and reports progress', async () => {
    const report = emptyReport();
    const execute = vi.fn(
      async (
        actions: Action[],
        options: {
          onActionStart?: (action: Action, index: number, total: number) => void;
          onActionEnd?: (result: {
            action: Action;
            ok: boolean;
            warnings: string[];
            durationMs: number;
          }) => void;
        },
      ) => {
        actions.forEach((action, index) => {
          options.onActionStart?.(action, index, actions.length);
          options.onActionEnd?.({ action, ok: true, warnings: [], durationMs: 1 });
        });
        return {
          ...report,
          results: actions.map((action) => ({ action, ok: true, warnings: [], durationMs: 1 })),
        } as unknown as ExecutionReport;
      },
    );
    const { driver, sent, flashes, spoken, statuses } = setup({ execute });
    driver.activate();
    driver.handleMessage({ type: 'LOOP_TRANSCRIBING', generation: 1 });
    driver.handleMessage({ type: 'LOOP_TRANSCRIPT', generation: 1, transcript: 'fill my name' });
    expect(statuses.at(-1)).toBe('thinking');

    driver.handleMessage({
      type: 'LOOP_BRAIN_RESULT',
      generation: 1,
      response: {
        thoughtProcess: 'fill',
        spokenFeedback: 'Filling your name',
        actions: [{ action: 'FILL', targetId: 'vfe_name', value: 'Ada' }],
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(flashes.length).toBeGreaterThan(0);
    expect(sent.some((message) => message.type === 'EXECUTION_REPORT')).toBe(true);
    expect(driver.getState()).toEqual({ kind: 'idle' });
    expect(spoken).toContain('Done.');
  });

  it('drops a brain result from an older generation', async () => {
    const { driver, execute, statuses } = setup();
    driver.activate();
    driver.handleMessage({ type: 'LOOP_TRANSCRIBING', generation: 1 });
    driver.handleMessage({ type: 'LOOP_TRANSCRIPT', generation: 1, transcript: 'first' });
    driver.activate(); // restart → generation 2
    driver.handleMessage({
      type: 'LOOP_BRAIN_RESULT',
      generation: 1,
      response: { thoughtProcess: '', actions: [] },
    });
    await tick();
    expect(execute).not.toHaveBeenCalled();
    expect(driver.getState().kind).toBe('listening');
    expect(statuses.at(-1)).toBe('listening');
  });

  it('speaks a partial failure and keeps the error state', async () => {
    const execute = vi.fn(async (actions: Action[]) => {
      return {
        ...emptyReport(false),
        results: actions.map((action, index) => ({
          action,
          ok: index === 0,
          warnings: [],
          durationMs: 1,
          ...(index === 0 ? {} : { error: { code: 'ELEMENT_NOT_FOUND', message: 'gone' } }),
        })),
      } as unknown as ExecutionReport;
    });
    const { driver, spoken, messages } = setup({ execute });
    driver.activate();
    driver.handleMessage({ type: 'LOOP_TRANSCRIBING', generation: 1 });
    driver.handleMessage({ type: 'LOOP_TRANSCRIPT', generation: 1, transcript: 'fill both' });
    driver.handleMessage({
      type: 'LOOP_BRAIN_RESULT',
      generation: 1,
      response: {
        thoughtProcess: '',
        actions: [
          { action: 'FILL', targetId: 'vfe_name', value: 'Ada' },
          { action: 'FILL', targetId: 'vfe_email', value: 'a@b.c' },
        ],
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(driver.getState()).toMatchObject({ kind: 'error', code: 'EXECUTION_PARTIAL' });
    expect(spoken.some((line) => line.includes('Email address'))).toBe(true);
    expect(messages.at(-1)?.kind).toBe('error');
  });
});

describe('cancellation', () => {
  it('Esc aborts an in-flight execution', async () => {
    let aborted = false;
    const execute = vi.fn(
      (actions: Action[], options: { signal?: AbortSignal }) =>
        new Promise<ExecutionReport>((resolve) => {
          options.signal?.addEventListener('abort', () => {
            aborted = true;
            resolve({ ...emptyReport(false), aborted: true } as ExecutionReport);
          });
        }),
    );
    const { driver, sent } = setup({ execute: execute as never });
    driver.activate();
    driver.handleMessage({ type: 'LOOP_TRANSCRIBING', generation: 1 });
    driver.handleMessage({ type: 'LOOP_TRANSCRIPT', generation: 1, transcript: 'fill' });
    driver.handleMessage({
      type: 'LOOP_BRAIN_RESULT',
      generation: 1,
      response: {
        thoughtProcess: '',
        actions: [{ action: 'FILL', targetId: 'vfe_name', value: 'Ada' }],
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    driver.stop();
    expect(aborted).toBe(true);
    expect(driver.getState()).toEqual({ kind: 'idle' });
    expect(sent.some((message) => message.type === 'AUDIO_STOP')).toBe(true);
  });
});

describe('errors', () => {
  it('shows the microphone copy when the device is denied', () => {
    const { driver, messages, statuses } = setup();
    driver.handleMessage({ type: 'AUDIO_ERROR', code: 'NOT_ALLOWED', message: 'denied' });
    expect(driver.getState()).toMatchObject({ kind: 'error', code: 'MIC_DENIED' });
    expect(statuses.at(-1)).toBe('error');
    expect(messages.at(-1)).toMatchObject({ kind: 'error' });
    expect(messages.at(-1)?.text).toContain('Grant microphone access');
  });

  it('surfaces a worker-side failure', () => {
    const { driver } = setup();
    driver.activate();
    driver.handleMessage({ type: 'LOOP_TRANSCRIBING', generation: 1 });
    driver.handleMessage({ type: 'LOOP_ERROR', generation: 1, code: 'TIMEOUT', message: 'slow' });
    expect(driver.getState()).toMatchObject({ kind: 'error', code: 'STT_TIMEOUT' });
  });
});

describe('post-submit (INT-2)', () => {
  const submitRun = (overrides: Record<string, unknown> = {}) => {
    const execute = vi.fn(async (actions: Action[]) => ({
      results: actions.map((action) => ({ action, ok: true, warnings: [], durationMs: 1 })),
      ok: true,
      aborted: false,
      totalMs: 3,
      trace: [],
    }));
    const setupResult = setup({ execute: execute as never });
    const driver = createLoopDriver({
      hud: {
        setStatus: (status) => setupResult.statuses.push(status),
        setMessage: (text, kind) => setupResult.messages.push({ text, ...(kind ? { kind } : {}) }),
        setActionsProgress: () => undefined,
        showHint: (text) => setupResult.hints.push(text),
      },
      badges: {
        sync: () => undefined,
        flash: (id, result) => setupResult.flashes.push({ id, ...(result ? { result } : {}) }),
      },
      distill: () => page,
      send: (message) => {
        setupResult.sent.push(message as Record<string, unknown>);
      },
      execute: execute as never,
      speak: async (text) => {
        setupResult.spoken.push(text);
      },
      labelOf: (id) => (id === 'vfe_submit' ? 'Place order' : 'Full name'),
      snapshot: () => ({
        pageState: page,
        url: 'https://shop.test/checkout',
        successText: ['Thank you! Order #4412'],
        navigated: false,
      }),
      captcha: () => null,
      submitObserveMs: 0,
      ...overrides,
    });
    // `setupResult` also carries a driver; the one with the INT-2 seams wins.
    return { ...setupResult, driver };
  };

  const runSubmit = async (driver: ReturnType<typeof createLoopDriver>): Promise<void> => {
    driver.activate();
    driver.handleMessage({ type: 'LOOP_TRANSCRIBING', generation: 1 });
    driver.handleMessage({ type: 'LOOP_TRANSCRIPT', generation: 1, transcript: 'place my order' });
    driver.handleMessage({
      type: 'LOOP_BRAIN_RESULT',
      generation: 1,
      response: {
        thoughtProcess: '',
        actions: [{ action: 'CLICK', targetId: 'vfe_submit' }],
      },
    });
    await vi.advanceTimersByTimeAsync(0);
  };

  it('observes the page after a submit click and announces success', async () => {
    const { driver, spoken } = submitRun();
    await runSubmit(driver);
    await vi.advanceTimersByTimeAsync(0);
    expect(driver.getState()).toEqual({ kind: 'idle' });
    expect(spoken.some((line) => line.includes('4412'))).toBe(true);
    expect(driver.getLastSubmitOutcome()).toMatchObject({ kind: 'SUCCESS' });
  });

  it('blocks submission when a CAPTCHA is present', async () => {
    const { driver, execute } = submitRun({ captcha: () => 'iframe[src*="recaptcha"]' });
    await runSubmit(driver);
    expect(execute).not.toHaveBeenCalled();
    expect(driver.getState()).toMatchObject({ kind: 'error', code: 'CAPTCHA_BLOCKED' });
  });

  it('speaks field errors and remembers the repair context', async () => {
    const fieldPage = {
      urlOrAppTitle: 'Checkout',
      elements: [
        {
          id: 'vfe_password',
          badgeIndex: 1,
          type: 'password' as const,
          label: 'Password',
          value: '<redacted>',
          required: true,
          disabled: false,
          focused: false,
          validationError: 'must be at least 8 characters',
        },
      ],
    };
    const { driver, spoken, sent } = submitRun({
      snapshot: () => ({
        pageState: fieldPage,
        url: 'https://shop.test/checkout',
        successText: [],
        navigated: false,
      }),
    });
    await runSubmit(driver);
    await vi.advanceTimersByTimeAsync(0);
    expect(driver.getState().kind).toBe('listening');
    expect(spoken.some((line) => line.includes('Password'))).toBe(true);
    expect(sent.some((message) => message.type === 'LOOP_CONTEXT')).toBe(true);
  });
});

describe('lifecycle', () => {
  it('destroy stops timers and ignores later events', async () => {
    const { driver, sent, hints } = setup();
    driver.activate();
    driver.destroy();
    const before = sent.length;
    driver.activate();
    await vi.advanceTimersByTimeAsync(SILENCE_TIMEOUT_MS * 2);
    expect(sent.length).toBe(before);
    expect(hints).toEqual([]);
  });
});
