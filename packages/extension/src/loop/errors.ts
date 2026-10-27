/** Every way the loop can fail, with the copy the HUD shows for it. */
export type LoopErrorCode =
  | 'MIC_DENIED'
  | 'NO_SPEECH'
  | 'STT_FAILED'
  | 'STT_TIMEOUT'
  | 'BRAIN_FAILED'
  | 'BRAIN_TIMEOUT'
  | 'INVALID_BRAIN_RESPONSE'
  | 'EXECUTION_PARTIAL'
  | 'ELEMENT_MISSING'
  | 'PAGE_NAVIGATED'
  | 'SUBMIT_UNCONFIRMED'
  | 'CAPTCHA_BLOCKED'
  | 'SUBMIT_ATTEMPTS_EXHAUSTED'
  | 'ABORTED'
  | 'UNKNOWN';

export interface LoopErrorInfo {
  code: LoopErrorCode;
  title: string;
  message: string;
  recoverable: boolean;
  /** Only `STT_TIMEOUT` is retried automatically (INT-1 rule 8). */
  autoRetry: boolean;
}

const TABLE: Record<LoopErrorCode, Omit<LoopErrorInfo, 'code'>> = {
  MIC_DENIED: {
    title: 'Microphone blocked',
    message: 'Grant microphone access, then press Alt+V',
    recoverable: true,
    autoRetry: false,
  },
  NO_SPEECH: {
    title: 'No speech',
    message: "I didn't hear anything — press Alt+V to try again",
    recoverable: true,
    autoRetry: false,
  },
  STT_FAILED: {
    title: 'Transcription failed',
    message: "I couldn't transcribe that. Please try again.",
    recoverable: true,
    autoRetry: false,
  },
  STT_TIMEOUT: {
    title: 'Transcription timed out',
    message: 'That took too long — trying once more.',
    recoverable: true,
    autoRetry: true,
  },
  BRAIN_FAILED: {
    title: 'Assistant unavailable',
    message: "I couldn't reach the assistant. Try again in a moment.",
    recoverable: true,
    autoRetry: false,
  },
  BRAIN_TIMEOUT: {
    title: 'Assistant timed out',
    message: "The assistant didn't answer in time. Try again.",
    recoverable: true,
    autoRetry: false,
  },
  INVALID_BRAIN_RESPONSE: {
    title: 'Unexpected answer',
    message: "The assistant sent something I couldn't use. Try again.",
    recoverable: true,
    autoRetry: false,
  },
  EXECUTION_PARTIAL: {
    title: 'Partly done',
    message: 'Some fields could not be filled.',
    recoverable: true,
    autoRetry: false,
  },
  ELEMENT_MISSING: {
    title: 'Field not found',
    message: 'A field moved or disappeared before I could use it.',
    recoverable: true,
    autoRetry: false,
  },
  PAGE_NAVIGATED: {
    title: 'Page changed',
    message: 'The page navigated. Press Alt+V to continue here.',
    recoverable: true,
    autoRetry: false,
  },
  SUBMIT_UNCONFIRMED: {
    title: 'Not sure it went through',
    message: "I clicked submit but I'm not sure it went through. Check the page.",
    recoverable: true,
    autoRetry: false,
  },
  CAPTCHA_BLOCKED: {
    title: 'CAPTCHA on this form',
    message: "There's a CAPTCHA on this form — you'll need to solve that part.",
    recoverable: false,
    autoRetry: false,
  },
  SUBMIT_ATTEMPTS_EXHAUSTED: {
    title: 'Three tries',
    message: "I've tried three times; this form may need a human.",
    recoverable: false,
    autoRetry: false,
  },
  ABORTED: {
    title: 'Stopped',
    message: 'Stopped.',
    recoverable: true,
    autoRetry: false,
  },
  UNKNOWN: {
    title: 'Something went wrong',
    message: 'Please try again.',
    recoverable: true,
    autoRetry: false,
  },
};

export function describeLoopError(code: LoopErrorCode): LoopErrorInfo {
  return { code, ...TABLE[code] };
}

/** Map a D-2 STT failure code onto the loop taxonomy. */
export function loopCodeFromStt(code: string | undefined): LoopErrorCode {
  switch (code) {
    case 'TIMEOUT':
      return 'STT_TIMEOUT';
    case 'UNAUTHORIZED':
    case 'RATE_LIMITED':
    case 'PROVIDER_ERROR':
    case 'NETWORK':
    case 'EMPTY_AUDIO':
    case 'TOO_LONG':
      return 'STT_FAILED';
    case 'ABORTED':
      return 'ABORTED';
    default:
      return 'UNKNOWN';
  }
}

/** Map an offscreen audio error onto the loop taxonomy. */
export function loopCodeFromAudio(code: string): LoopErrorCode {
  if (code === 'NOT_ALLOWED' || code === 'NO_DEVICE' || code === 'DEVICE_BUSY') return 'MIC_DENIED';
  if (code === 'OFFSCREEN_FAILED') return 'UNKNOWN';
  return 'MIC_DENIED';
}

/** Map a brain-client failure onto the loop taxonomy. */
export function loopCodeFromBrain(code: string): LoopErrorCode {
  switch (code) {
    case 'TIMEOUT':
      return 'BRAIN_TIMEOUT';
    case 'INVALID_RESPONSE':
      return 'INVALID_BRAIN_RESPONSE';
    case 'ABORTED':
      return 'ABORTED';
    default:
      return 'BRAIN_FAILED';
  }
}

/** Spoken summary of a partial execution — names the fields, never the values. */
export function partialSpeech(labels: string[]): string {
  if (labels.length === 0) return "I couldn't finish that.";
  if (labels.length === 1) return `I couldn't fill ${labels[0]}.`;
  if (labels.length === 2) return `I couldn't fill ${labels[0]} or ${labels[1]}.`;
  return `I couldn't fill ${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}.`;
}

/** Spoken confirmation when every action succeeded. */
export function successSpeech(count: number): string {
  if (count <= 0) return '';
  if (count === 1) return 'Done.';
  return `Done — ${count} fields updated.`;
}
