import type { ConversationTurn, PageState, ProcessCommandResponse } from '@vfe/protocol';

import type { SttResult } from '../audio/stt';
import { loopCodeFromBrain, loopCodeFromStt, type LoopErrorCode } from '../loop/errors';
import { BrainError, requestBrain, type BrainRequest } from '../net/brain';

export type CommandOutcome =
  | { ok: true; transcript: string; response: ProcessCommandResponse }
  | { ok: false; code: LoopErrorCode; message: string };

export interface CommandPipelineDeps {
  transcribe: (audio: ArrayBuffer, options: { signal?: AbortSignal }) => Promise<SttResult>;
  /** Defaults to the real `POST /v1/brain` client; injected in tests. */
  brain?: (
    request: BrainRequest,
    options: { signal?: AbortSignal },
  ) => Promise<ProcessCommandResponse>;
  now?: () => number;
}

export interface CommandInput {
  audio: ArrayBuffer;
  pageState: PageState | null;
  history: ConversationTurn[];
  signal?: AbortSignal;
}

function isSttError(error: unknown): error is { code: string; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

function isBrainError(error: unknown): error is BrainError {
  return error instanceof BrainError;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown failure';
}

/**
 * Speech → text → intent. Deliberately not a class: the service worker can be
 * torn down at any await, so everything it needs is passed in and nothing is
 * remembered between calls.
 */
export async function runCommand(
  deps: CommandPipelineDeps,
  input: CommandInput,
): Promise<CommandOutcome> {
  let transcript: string;
  try {
    const result = await deps.transcribe(input.audio, input.signal ? { signal: input.signal } : {});
    transcript = result.transcript;
  } catch (error) {
    if (isSttError(error)) {
      return { ok: false, code: loopCodeFromStt(error.code), message: error.message };
    }
    return { ok: false, code: 'STT_FAILED', message: describe(error) };
  }

  if (!transcript.trim()) {
    return { ok: false, code: 'NO_SPEECH', message: "I didn't catch that — please say it again." };
  }

  if (!input.pageState) {
    return { ok: false, code: 'UNKNOWN', message: 'No page state was captured for this tab' };
  }

  if (!deps.brain) {
    return { ok: false, code: 'BRAIN_FAILED', message: 'The brain client is not configured' };
  }

  const request: BrainRequest = {
    transcript,
    pageState: input.pageState,
    conversationHistory: input.history,
  };

  try {
    const response = await deps.brain(request, input.signal ? { signal: input.signal } : {});
    return { ok: true, transcript, response };
  } catch (error) {
    if (isBrainError(error)) {
      return { ok: false, code: loopCodeFromBrain(error.code), message: error.message };
    }
    return { ok: false, code: 'BRAIN_FAILED', message: describe(error) };
  }
}

export { requestBrain };
