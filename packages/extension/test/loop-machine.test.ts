import type { Action, BrainResponse } from '@vfe/protocol';
import { describe, expect, it } from 'vitest';

import {
  initialLoop,
  reduce,
  statusFor,
  type LoopContext,
  type LoopEvent,
  type LoopState,
} from '../src/loop/machine';

const NOW = 1_700_000_000_000;

function ctx(generation = 0): LoopContext {
  return { generation, now: NOW };
}

function apply(
  state: LoopState,
  events: LoopEvent[],
  context: () => LoopContext = () => ctx(),
): { state: LoopState; effects: string[]; generation: number } {
  let current = context();
  let next = state;
  const effects: string[] = [];
  for (const event of events) {
    const result = reduce(next, event, current);
    next = result.state;
    current = { ...current, generation: result.generation };
    effects.push(...result.effects.map((effect) => effect.type));
  }
  return { state: next, effects, generation: current.generation };
}

const idle: LoopState = initialLoop().state;

function listening(): LoopState {
  return apply(idle, [{ type: 'ACTIVATE' }]).state;
}

function thinking(): LoopState {
  return apply(listening(), [
    { type: 'SPEECH_END' },
    { type: 'TRANSCRIPT', transcript: 'fill my name' },
  ]).state;
}

function fill(label = 'Full name'): Action {
  return { action: 'FILL', targetId: `vfe_${label}`, value: 'Ada' };
}

function response(actions: Action[], spokenFeedback?: string): BrainResponse {
  return {
    thoughtProcess: 'test',
    ...(spokenFeedback ? { spokenFeedback } : {}),
    actions,
  };
}

describe('happy path', () => {
  it('walks idle → listening → transcribing → thinking → executing → idle', () => {
    const a = apply(idle, [{ type: 'ACTIVATE' }]);
    expect(a.state).toEqual({ kind: 'listening', startedAt: NOW });
    expect(a.effects).toEqual(['listen']);
    expect(a.generation).toBe(1);

    const b = apply(a.state, [{ type: 'SPEECH_END' }], () => ({ generation: 1, now: NOW }));
    expect(b.state.kind).toBe('transcribing');

    const c = apply(b.state, [{ type: 'TRANSCRIPT', transcript: 'fill my name' }], () => ({
      generation: 1,
      now: NOW,
    }));
    expect(c.state).toEqual({ kind: 'thinking', transcript: 'fill my name' });
    expect(statusFor(c.state)).toBe('thinking');

    const d = apply(c.state, [{ type: 'BRAIN_RESPONSE', response: response([fill()]) }], () => ({
      generation: 1,
      now: NOW,
    }));
    expect(d.state).toMatchObject({ kind: 'executing', index: 0, total: 1 });
    expect(d.effects).toEqual(['execute']);

    const e = apply(
      d.state,
      [{ type: 'EXECUTION_DONE', ok: true, failedLabels: [], total: 1 }],
      () => ({
        generation: 1,
        now: NOW,
      }),
    );
    expect(e.state).toEqual({ kind: 'idle' });
    expect(e.effects).toEqual(['speak']);
  });

  it('stops listening when activated again while listening', () => {
    const { state, effects, generation } = apply(listening(), [{ type: 'ACTIVATE' }], () => ({
      generation: 1,
      now: NOW,
    }));
    expect(state).toEqual({ kind: 'idle' });
    expect(effects).toEqual(['stopListening']);
    expect(generation).toBe(2);
  });
});

describe('stale events', () => {
  it('ignores VAD_SPEECH_END during execution', () => {
    const executing = apply(
      thinking(),
      [{ type: 'BRAIN_RESPONSE', response: response([fill()]) }],
      () => ({
        generation: 1,
        now: NOW,
      }),
    ).state;
    const result = reduce(executing, { type: 'SPEECH_END' }, { generation: 1, now: NOW });
    expect(result.state).toBe(executing);
    expect(result.effects).toEqual([]);
    expect(result.dropped).toBe('stale-event');
  });

  it('ignores progress and completion outside execution', () => {
    expect(reduce(thinking(), { type: 'ACTION_PROGRESS', index: 1, total: 2 }, ctx()).dropped).toBe(
      'stale-event',
    );
    expect(
      reduce(idle, { type: 'EXECUTION_DONE', ok: true, failedLabels: [], total: 1 }, ctx()).dropped,
    ).toBe('stale-event');
    expect(reduce(idle, { type: 'SILENCE_TIMEOUT' }, ctx()).dropped).toBe('stale-event');
  });

  it('ignores a transcript that arrives before speech ends', () => {
    expect(reduce(listening(), { type: 'TRANSCRIPT', transcript: 'x' }, ctx()).dropped).toBe(
      'stale-event',
    );
  });

  it('ignores a brain response outside thinking', () => {
    expect(
      reduce(listening(), { type: 'BRAIN_RESPONSE', response: response([fill()]) }, ctx()).dropped,
    ).toBe('stale-event');
  });
});

describe('cancellation', () => {
  it('Esc returns to idle from every state and stops everything', () => {
    const states: LoopState[] = [
      listening(),
      { kind: 'transcribing', startedAt: NOW },
      thinking(),
      { kind: 'executing', transcript: 't', index: 1, total: 3 },
      { kind: 'clarifying', transcript: 't', question: 'Which address?', askedAt: NOW },
      { kind: 'error', code: 'BRAIN_FAILED', message: 'x', recoverable: true },
    ];
    for (const state of states) {
      const result = reduce(state, { type: 'ESC' }, { generation: 3, now: NOW });
      expect(result.state, state.kind).toEqual({ kind: 'idle' });
      expect(result.effects.map((effect) => effect.type)).toEqual([
        'stopListening',
        'stopSpeech',
        'abortActions',
      ]);
      expect(result.generation).toBe(4);
    }
  });

  it('Esc while idle is a no-op', () => {
    const result = reduce(idle, { type: 'ESC' }, ctx(5));
    expect(result.state).toEqual({ kind: 'idle' });
    expect(result.effects).toEqual([]);
    expect(result.generation).toBe(5);
  });

  it('a second activation while thinking cancels the first generation', () => {
    const first = apply(idle, [{ type: 'ACTIVATE' }]);
    const inFlight = apply(first.state, [{ type: 'SPEECH_END' }], () => ({
      generation: first.generation,
      now: NOW,
    })).state;
    const restarted = reduce(
      inFlight,
      { type: 'ACTIVATE' },
      { generation: first.generation, now: NOW },
    );
    expect(restarted.state.kind).toBe('listening');
    expect(restarted.effects.map((effect) => effect.type)).toEqual([
      'stopListening',
      'stopSpeech',
      'abortActions',
      'listen',
      'hint',
    ]);
    expect(restarted.generation).toBe(first.generation + 1);
  });
});

describe('clarification', () => {
  it('asks, then re-listens with the question kept', () => {
    const asking = apply(
      thinking(),
      [
        {
          type: 'BRAIN_RESPONSE',
          response: response(
            [{ action: 'ASK_CLARIFICATION', questionToUser: 'Billing or shipping?' }],
            'Billing or shipping?',
          ),
        },
      ],
      () => ({ generation: 1, now: NOW }),
    );
    expect(asking.state).toMatchObject({
      kind: 'clarifying',
      question: 'Billing or shipping?',
    });
    expect(asking.effects).toEqual(['stopListening', 'speak']);

    const relisten = apply(asking.state, [{ type: 'ACTIVATE' }], () => ({
      generation: 1,
      now: NOW,
    }));
    expect(relisten.state.kind).toBe('listening');
    expect(relisten.effects).toEqual(['listen', 'hint']);
  });
});

describe('failures', () => {
  it('partial execution is recoverable and names the field', () => {
    const executing = apply(
      thinking(),
      [{ type: 'BRAIN_RESPONSE', response: response([fill(), fill('Email')]) }],
      () => ({
        generation: 1,
        now: NOW,
      }),
    ).state;
    const failed = reduce(
      executing,
      {
        type: 'EXECUTION_DONE',
        ok: false,
        failedLabels: ['Email address'],
        total: 2,
      },
      { generation: 1, now: NOW },
    );
    expect(failed.state).toMatchObject({
      kind: 'error',
      code: 'EXECUTION_PARTIAL',
      recoverable: true,
    });
    const spoken = failed.effects.find((effect) => effect.type === 'speak');
    expect(spoken && 'text' in spoken ? spoken.text : '').toContain('Email address');
  });

  it('maps a denied microphone to MIC_DENIED', () => {
    const result = reduce(listening(), { type: 'AUDIO_ERROR', code: 'NOT_ALLOWED' }, ctx(1));
    expect(result.state).toMatchObject({ kind: 'error', code: 'MIC_DENIED' });
    expect(result.effects.map((effect) => effect.type)).toEqual(['stopListening']);
  });

  it('surfaces brain timeouts as retryable errors', () => {
    const result = reduce(thinking(), { type: 'FAILED', code: 'BRAIN_TIMEOUT' }, ctx(1));
    expect(result.state).toMatchObject({ kind: 'error', code: 'BRAIN_TIMEOUT', recoverable: true });
  });

  it('treats an abort as a clean stop, not an error', () => {
    const result = reduce(thinking(), { type: 'FAILED', code: 'ABORTED' }, ctx(1));
    expect(result.state).toEqual({ kind: 'idle' });
  });

  it('retry re-arms listening from a recoverable error', () => {
    const error = reduce(thinking(), { type: 'FAILED', code: 'STT_FAILED' }, ctx(1)).state;
    const retried = reduce(error, { type: 'RETRY' }, { generation: 2, now: NOW });
    expect(retried.state.kind).toBe('listening');
    expect(retried.effects.map((effect) => effect.type)).toEqual(['listen']);
  });
});

describe('silence and navigation', () => {
  it('auto-stops after silence with a hint', () => {
    const result = reduce(listening(), { type: 'SILENCE_TIMEOUT' }, ctx(1));
    expect(result.state).toEqual({ kind: 'idle' });
    const hint = result.effects.find((effect) => effect.type === 'hint');
    expect(hint && 'text' in hint ? hint.text : '').toContain('Alt+V');
  });

  it('reports a navigation instead of hanging', () => {
    const result = reduce(
      { kind: 'executing', transcript: 't', index: 1, total: 2 },
      { type: 'NAVIGATED' },
      ctx(1),
    );
    expect(result.state).toMatchObject({ kind: 'error', code: 'PAGE_NAVIGATED' });
  });
});

describe('no auto-submit', () => {
  it('never invents a click when the brain returns no actions', () => {
    const result = reduce(
      thinking(),
      { type: 'BRAIN_RESPONSE', response: response([], 'I need to know your name first.') },
      ctx(1),
    );
    expect(result.state).toEqual({ kind: 'idle' });
    expect(result.effects).toEqual([{ type: 'speak', text: 'I need to know your name first.' }]);
  });
});

describe('hud mapping', () => {
  it('maps every state to an agent status', () => {
    expect(statusFor({ kind: 'idle' })).toBe('idle');
    expect(statusFor({ kind: 'listening', startedAt: 0 })).toBe('listening');
    expect(statusFor({ kind: 'transcribing', startedAt: 0 })).toBe('thinking');
    expect(statusFor({ kind: 'thinking', transcript: '' })).toBe('thinking');
    expect(statusFor({ kind: 'executing', transcript: '', index: 0, total: 1 })).toBe('executing');
    expect(statusFor({ kind: 'clarifying', transcript: '', question: 'q', askedAt: 0 })).toBe(
      'clarifying',
    );
    expect(statusFor({ kind: 'error', code: 'UNKNOWN', message: 'x', recoverable: true })).toBe(
      'error',
    );
  });
});
