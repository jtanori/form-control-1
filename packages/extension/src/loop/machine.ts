import type { AgentStatus, Action, BrainResponse } from '@vfe/protocol';

import {
  describeLoopError,
  loopCodeFromAudio,
  partialSpeech,
  successSpeech,
  type LoopErrorCode,
} from './errors';

export type LoopState =
  | { kind: 'idle' }
  | { kind: 'listening'; startedAt: number }
  | { kind: 'transcribing'; startedAt: number }
  | { kind: 'thinking'; transcript: string }
  | { kind: 'executing'; transcript: string; index: number; total: number }
  | { kind: 'clarifying'; transcript: string; question: string; askedAt: number }
  | { kind: 'error'; code: LoopErrorCode; message: string; recoverable: boolean };

export type LoopEvent =
  | { type: 'ACTIVATE' }
  | { type: 'SPEECH_END' }
  | { type: 'TRANSCRIPT'; transcript: string }
  | { type: 'BRAIN_RESPONSE'; response: BrainResponse }
  | { type: 'ACTION_PROGRESS'; index: number; total: number }
  | {
      type: 'EXECUTION_DONE';
      ok: boolean;
      /** Labels of the fields that failed (never their values). */
      failedLabels: string[];
      total: number;
    }
  | { type: 'ESC' }
  | { type: 'AUDIO_ERROR'; code: string; message?: string }
  | { type: 'FAILED'; code: LoopErrorCode; message?: string }
  | { type: 'SILENCE_TIMEOUT' }
  | { type: 'NAVIGATED' }
  | { type: 'RETRY' };

export type LoopEffect =
  | { type: 'listen' }
  | { type: 'stopListening' }
  | { type: 'stopSpeech' }
  | { type: 'abortActions' }
  | { type: 'speak'; text: string }
  | { type: 'execute'; actions: Action[]; total: number }
  | { type: 'hint'; text: string; ms: number };

export interface LoopContext {
  generation: number;
  now: number;
}

export type LoopDropReason = 'stale-event' | 'ignored';

export interface LoopResult {
  state: LoopState;
  effects: LoopEffect[];
  generation: number;
  /** Set when an event arrived in a state that cannot accept it. */
  dropped?: LoopDropReason;
}

export const HUD_STATUS: Record<LoopState['kind'], AgentStatus> = {
  idle: 'idle',
  listening: 'listening',
  transcribing: 'thinking',
  thinking: 'thinking',
  executing: 'executing',
  clarifying: 'clarifying',
  error: 'error',
};

export function statusFor(state: LoopState): AgentStatus {
  return HUD_STATUS[state.kind];
}

const IDLE: LoopState = { kind: 'idle' };

const STALE: ReadonlySet<LoopState['kind']> = new Set<LoopState['kind']>(['idle', 'error']);

function errorState(code: LoopErrorCode, message?: string): LoopState {
  const info = describeLoopError(code);
  return {
    kind: 'error',
    code,
    message: message ?? info.message,
    recoverable: info.recoverable,
  };
}

function clarificationOf(response: BrainResponse): string | null {
  for (const action of response.actions) {
    if (action.action === 'ASK_CLARIFICATION') return action.questionToUser;
  }
  return null;
}

function stopEffects(): LoopEffect[] {
  return [{ type: 'stopListening' }, { type: 'stopSpeech' }, { type: 'abortActions' }];
}

/**
 * The single source of truth for the voice loop. Pure: no DOM, no chrome, no
 * timers. `generation` is bumped on every activation and on every cancel, so a
 * continuation carrying an older generation can be dropped by the caller.
 */
export function reduce(state: LoopState, event: LoopEvent, ctx: LoopContext): LoopResult {
  const now = ctx.now;
  const keep = (effects: LoopEffect[] = [], generation = ctx.generation): LoopResult => ({
    state,
    effects,
    generation,
  });
  const move = (
    next: LoopState,
    effects: LoopEffect[] = [],
    generation = ctx.generation,
  ): LoopResult => ({ state: next, effects, generation });
  const drop = (reason: LoopDropReason): LoopResult => ({
    state,
    effects: [],
    generation: ctx.generation,
    dropped: reason,
  });

  switch (event.type) {
    case 'ACTIVATE': {
      const generation = ctx.generation + 1;
      switch (state.kind) {
        case 'idle':
          return move({ kind: 'listening', startedAt: now }, [{ type: 'listen' }], generation);
        case 'listening':
          // A click while listening stops listening instead of starting again.
          return move(IDLE, [{ type: 'stopListening' }], generation);
        case 'error':
          if (!state.recoverable) return move(IDLE, [], generation);
          return move({ kind: 'listening', startedAt: now }, [{ type: 'listen' }], generation);
        case 'clarifying':
          // Re-listen with the question still in the conversation history.
          return move(
            { kind: 'listening', startedAt: now },
            [
              { type: 'listen' },
              { type: 'hint', text: 'Go ahead — answer the question', ms: 2500 },
            ],
            generation,
          );
        default:
          // transcribing | thinking | executing: cancel the in-flight pipeline.
          return move(
            { kind: 'listening', startedAt: now },
            [...stopEffects(), { type: 'listen' }, { type: 'hint', text: 'Restarted', ms: 1500 }],
            generation,
          );
      }
    }

    case 'SPEECH_END': {
      if (state.kind !== 'listening') return drop('stale-event');
      return move({ kind: 'transcribing', startedAt: now });
    }

    case 'TRANSCRIPT': {
      if (state.kind !== 'transcribing') return drop('stale-event');
      return move({ kind: 'thinking', transcript: event.transcript });
    }

    case 'BRAIN_RESPONSE': {
      if (state.kind !== 'thinking') return drop('stale-event');
      const { response } = event;
      const question = clarificationOf(response);
      if (question) {
        return move({ kind: 'clarifying', transcript: state.transcript, question, askedAt: now }, [
          { type: 'stopListening' },
          ...(response.spokenFeedback
            ? [{ type: 'speak' as const, text: response.spokenFeedback }]
            : []),
        ]);
      }
      const actions = response.actions.filter((action) => action.action !== 'ASK_CLARIFICATION');
      if (actions.length === 0) {
        // Nothing to do: never invent a click, just settle back to idle.
        return move(
          IDLE,
          response.spokenFeedback ? [{ type: 'speak', text: response.spokenFeedback }] : [],
        );
      }
      return move(
        { kind: 'executing', transcript: state.transcript, index: 0, total: actions.length },
        [{ type: 'execute', actions, total: actions.length }],
      );
    }

    case 'ACTION_PROGRESS': {
      if (state.kind !== 'executing') return drop('stale-event');
      if (event.index === state.index && event.total === state.total) return keep();
      return move({ ...state, index: event.index, total: event.total });
    }

    case 'EXECUTION_DONE': {
      if (state.kind !== 'executing') return drop('stale-event');
      if (event.ok) {
        const text = successSpeech(event.total);
        return move(IDLE, text ? [{ type: 'speak', text }] : []);
      }
      const speech = partialSpeech(event.failedLabels);
      return move(errorState('EXECUTION_PARTIAL', speech), [{ type: 'speak', text: speech }]);
    }

    case 'ESC': {
      if (state.kind === 'idle') return keep();
      return move(IDLE, stopEffects(), ctx.generation + 1);
    }

    case 'AUDIO_ERROR': {
      // Audio codes are technical ("NotAllowedError"); the HUD gets actionable
      // copy from the taxonomy instead of the raw device message.
      const code = loopCodeFromAudio(event.code);
      return move(errorState(code), [{ type: 'stopListening' }], ctx.generation + 1);
    }

    case 'FAILED': {
      if (event.code === 'ABORTED') {
        return move(IDLE, stopEffects(), ctx.generation + 1);
      }
      const info = describeLoopError(event.code);
      return move(
        errorState(event.code, event.message ?? info.message),
        [{ type: 'stopListening' }, { type: 'stopSpeech' }],
        ctx.generation + 1,
      );
    }

    case 'SILENCE_TIMEOUT': {
      if (state.kind !== 'listening') return drop('stale-event');
      return move(
        IDLE,
        [
          { type: 'stopListening' },
          { type: 'hint', text: "I didn't hear anything — press Alt+V", ms: 4000 },
        ],
        ctx.generation + 1,
      );
    }

    case 'NAVIGATED': {
      if (state.kind === 'idle') return keep();
      return move(
        errorState('PAGE_NAVIGATED'),
        [...stopEffects(), { type: 'stopListening' }],
        ctx.generation + 1,
      );
    }

    case 'RETRY': {
      if (state.kind !== 'error') return drop('ignored');
      const generation = ctx.generation + 1;
      if (!state.recoverable) return move(IDLE, [], generation);
      return move({ kind: 'listening', startedAt: now }, [{ type: 'listen' }], generation);
    }

    default:
      return STALE.has(state.kind) ? drop('ignored') : drop('stale-event');
  }
}

/** Initial state + context for a fresh content script. */
export function initialLoop(): { state: LoopState; generation: number } {
  return { state: IDLE, generation: 0 };
}
