import type { ExecuteOptions, ExecutionReport } from '@vfe/dom-engine';
import type { Action, PageState } from '@vfe/protocol';

import type { HudController } from '../content/hud/controller';
import { parseLoopMessage, type LoopToTab } from '../messaging';

import { describeLoopError, loopCodeFromStt } from './errors';
import {
  initialLoop,
  reduce,
  statusFor,
  type LoopEffect,
  type LoopEvent,
  type LoopState,
} from './machine';
import { isSubmitLikeText, observeSubmit, type SubmitOutcome, type SubmitSnapshot } from './submit';

export interface LoopHud {
  setStatus: HudController['setStatus'];
  setMessage: HudController['setMessage'];
  setActionsProgress: HudController['setActionsProgress'];
  showHint: HudController['showHint'];
}

export interface LoopBadges {
  sync: (pageState: PageState) => void;
  flash: (vfeId: string, result?: 'ok' | 'error') => void;
}

export interface LoopDeps {
  hud: LoopHud;
  badges?: LoopBadges;
  distill: () => PageState;
  send: (message: unknown) => Promise<unknown> | void;
  execute: (actions: Action[], options: ExecuteOptions) => Promise<ExecutionReport>;
  speak?: (text: string) => Promise<unknown> | void;
  stopSpeaking?: () => void;
  labelOf?: (targetId: string) => string | undefined;
  now?: () => number;
  silenceTimeoutMs?: number;
  /** INT-2 observation seams (the page DOM in production). */
  snapshot?: () => SubmitSnapshot;
  focus?: (targetId: string) => void;
  captcha?: () => string | null;
  submitObserveMs?: number;
  /** Injectable so tests do not depend on real timers. */
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface LoopDriver {
  activate: () => void;
  stop: () => void;
  /** Feed a content-safe message; returns true when the driver consumed it. */
  handleMessage: (message: unknown) => boolean;
  handleAudioError: (code: string, message?: string) => void;
  getState: () => LoopState;
  getGeneration: () => number;
  getLastSubmitOutcome: () => SubmitOutcome | null;
  destroy: () => void;
}

export const SILENCE_TIMEOUT_MS = 15_000;

/**
 * Bridges the pure reducer to the DOM, the HUD, the badges, the audio service
 * worker and the Hands. Every asynchronous continuation is tagged with the
 * generation that produced it and dropped when that generation is stale.
 */
export function createLoopDriver(deps: LoopDeps): LoopDriver {
  const now = deps.now ?? Date.now;
  const silenceMs = deps.silenceTimeoutMs ?? SILENCE_TIMEOUT_MS;
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));

  let state: LoopState = initialLoop().state;
  let generation = 0;
  let destroyed = false;
  let actionsAbort: AbortController | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let submitAttempts = 0;
  let lastSubmitOutcome: SubmitOutcome | null = null;

  const clearSilence = (): void => {
    if (silenceTimer !== null) {
      clearTimer(silenceTimer);
      silenceTimer = null;
    }
  };

  const armSilence = (): void => {
    clearSilence();
    const at = generation;
    silenceTimer = setTimer(() => {
      silenceTimer = null;
      if (at !== generation) return;
      dispatch({ type: 'SILENCE_TIMEOUT' });
    }, silenceMs);
  };

  const broadcast = (message: unknown): void => {
    try {
      void deps.send(message);
    } catch {
      // A closed tab must never throw into the loop.
    }
  };

  const applyEffects = (effects: LoopEffect[], effectGeneration: number): void => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'listen':
          broadcast({ type: 'AUDIO_START' });
          broadcast({
            type: 'LOOP_ARMED',
            generation: effectGeneration,
            pageState: deps.distill(),
          });
          armSilence();
          break;
        case 'stopListening':
          clearSilence();
          broadcast({ type: 'AUDIO_STOP' });
          break;
        case 'stopSpeech':
          deps.stopSpeaking?.();
          break;
        case 'abortActions':
          actionsAbort?.abort();
          actionsAbort = null;
          break;
        case 'speak':
          void deps.speak?.(effect.text);
          break;
        case 'hint':
          deps.hud.showHint(effect.text, effect.ms);
          break;
        case 'focus':
          deps.focus?.(effect.targetId);
          break;
        case 'flashError':
          deps.badges?.flash(effect.targetId, 'error');
          break;
        case 'remember':
          broadcast({ type: 'LOOP_CONTEXT', generation: effectGeneration, text: effect.text });
          break;
        case 'clearHistory':
          submitAttempts = 0;
          break;
        case 'execute':
          void runActions(effect.actions, effect.total, effectGeneration);
          break;
      }
    }
  };

  const render = (): void => {
    deps.hud.setStatus(statusFor(state));
    if (state.kind === 'error') {
      deps.hud.setMessage(state.message, 'error');
    } else if (state.kind === 'idle') {
      deps.hud.setMessage('');
    }
  };

  const dispatch = (event: LoopEvent): void => {
    if (destroyed) return;
    const result = reduce(state, event, { generation, now: now() });
    state = result.state;
    generation = result.generation;
    render();
    applyEffects(result.effects, generation);
  };

  const looksLikeSubmit = (actions: Action[]): boolean =>
    actions.some((action) => {
      if (action.action !== 'CLICK') return false;
      const label = deps.labelOf?.(action.targetId) ?? '';
      return isSubmitLikeText(label) || isSubmitLikeText(action.targetId);
    });

  const runActions = async (
    actions: Action[],
    total: number,
    effectGeneration: number,
  ): Promise<void> => {
    // INT-2 guard rail: never press submit on a form with an unsolved CAPTCHA.
    const submitted = looksLikeSubmit(actions);
    if (submitted) {
      const captcha = deps.captcha?.() ?? null;
      if (captcha) {
        dispatch({ type: 'SUBMIT_BLOCKED', reason: 'CAPTCHA' });
        return;
      }
    }

    const controller = new AbortController();
    actionsAbort = controller;
    const labels: Record<string, string> = {};
    let report: ExecutionReport;
    try {
      report = await deps.execute(actions, {
        signal: controller.signal,
        onActionStart: (action, index, count) => {
          if (effectGeneration !== generation) return;
          if (action.action !== 'SCROLL' && action.action !== 'ASK_CLARIFICATION') {
            deps.badges?.flash(action.targetId);
            const label = deps.labelOf?.(action.targetId);
            if (label) labels[action.targetId] = label;
          }
          deps.hud.setActionsProgress(index + 1, count);
          dispatch({ type: 'ACTION_PROGRESS', index: index + 1, total: count });
        },
        onActionEnd: (result) => {
          if (effectGeneration !== generation) return;
          const action = result.action;
          if (action.action !== 'SCROLL' && action.action !== 'ASK_CLARIFICATION') {
            deps.badges?.flash(action.targetId, result.ok ? 'ok' : 'error');
          }
        },
      });
    } catch {
      if (effectGeneration !== generation) return;
      dispatch({ type: 'FAILED', code: 'UNKNOWN', message: 'Execution crashed' });
      return;
    } finally {
      if (actionsAbort === controller) actionsAbort = null;
    }

    if (effectGeneration !== generation) return;

    const failedLabels = report.results
      .filter((result) => !result.ok)
      .map((result) => {
        const action = result.action;
        if (action.action === 'SCROLL' || action.action === 'ASK_CLARIFICATION') return 'that';
        return labels[action.targetId] ?? deps.labelOf?.(action.targetId) ?? 'that field';
      });

    broadcast({
      type: 'EXECUTION_REPORT',
      generation: effectGeneration,
      ok: report.ok,
      total,
      failedLabels,
    });

    const wasSubmit = submitted && report.ok;
    dispatch({
      type: 'EXECUTION_DONE',
      ok: report.ok,
      failedLabels,
      total,
      ...(wasSubmit ? { submitted: true, attempted: submitAttempts } : {}),
    });

    if (wasSubmit && state.kind === 'post_submit') {
      submitAttempts += 1;
      await observeAndReact(effectGeneration);
    }
  };

  /** INT-2 §1–§2: wait for a decisive signal, then speak and re-listen. */
  const observeAndReact = async (effectGeneration: number): Promise<void> => {
    if (!deps.snapshot) {
      dispatch({ type: 'SUBMIT_OUTCOME', outcome: { kind: 'UNKNOWN_SILENT' } });
      return;
    }
    let outcome: SubmitOutcome;
    try {
      outcome = await observeSubmit({
        prev: deps.distill(),
        snapshot: deps.snapshot,
        sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
        ...(deps.submitObserveMs === undefined ? {} : { maxWaitMs: deps.submitObserveMs }),
      });
    } catch {
      outcome = { kind: 'UNKNOWN_SILENT' };
    }
    if (effectGeneration !== generation) return;
    lastSubmitOutcome = outcome;
    dispatch({ type: 'SUBMIT_OUTCOME', outcome });
  };

  const handleMessage = (message: unknown): boolean => {
    if (destroyed) return false;

    if (typeof message === 'object' && message !== null && 'type' in message) {
      const type = (message as { type?: unknown }).type;
      if (type === 'AUDIO_ERROR') {
        const code = (message as { code?: unknown }).code;
        const text = (message as { message?: unknown }).message;
        dispatch({
          type: 'AUDIO_ERROR',
          code: typeof code === 'string' ? code : 'UNKNOWN',
          ...(typeof text === 'string' ? { message: text } : {}),
        });
        return true;
      }
      if (type === 'VAD_SPEECH_END') {
        // The audio payload never reaches a tab; the SW relays this instead.
        dispatch({ type: 'SPEECH_END' });
        return true;
      }
    }

    const parsed = parseLoopMessage(message);
    if (!parsed.ok) return false;
    const loop = parsed.value as LoopToTab & { generation: number };
    if (loop.generation !== generation) return true;

    switch (loop.type) {
      case 'LOOP_TRANSCRIBING':
        dispatch({ type: 'SPEECH_END' });
        return true;
      case 'LOOP_TRANSCRIPT':
        dispatch({ type: 'TRANSCRIPT', transcript: loop.transcript });
        return true;
      case 'LOOP_BRAIN_RESULT':
        dispatch({ type: 'BRAIN_RESPONSE', response: loop.response });
        return true;
      case 'LOOP_ERROR':
        dispatch({ type: 'FAILED', code: loopCodeFromStt(loop.code), message: loop.message });
        return true;
      default:
        return false;
    }
  };

  return {
    activate: () => dispatch({ type: 'ACTIVATE' }),
    stop: () => dispatch({ type: 'ESC' }),
    handleMessage,
    handleAudioError: (code, message) =>
      dispatch({ type: 'AUDIO_ERROR', code, ...(message ? { message } : {}) }),
    getState: () => state,
    getGeneration: () => generation,
    getLastSubmitOutcome: () => lastSubmitOutcome,
    destroy: () => {
      destroyed = true;
      clearSilence();
      actionsAbort?.abort();
      actionsAbort = null;
    },
  };
}

/** HUD copy for a loop error state, used by callers that render outside the HUD. */
export function errorCopy(state: LoopState): string {
  return state.kind === 'error' ? describeLoopError(state.code).message : '';
}
