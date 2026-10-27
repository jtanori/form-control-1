import type { StreamLike, VadHandlers } from './controller';

export const VAD_TUNING = {
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  redemptionMs: 600,
  preSpeechPadMs: 300,
  minSpeechMs: 300,
  maxUtteranceMs: 30_000,
  silenceAutoStopMs: 60_000,
  muteTailMs: 250,
  sampleRate: 16_000,
  submitUserSpeechOnPause: true,
} as const;

export const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: VAD_TUNING.sampleRate,
  },
};

export interface VadOptionsLike {
  model: 'v5';
  baseAssetPath: string;
  onnxWASMBasePath: string;
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  redemptionMs: number;
  preSpeechPadMs: number;
  minSpeechMs: number;
  submitUserSpeechOnPause: boolean;
  getStream: () => Promise<unknown>;
  pauseStream: (stream: unknown) => Promise<void>;
  resumeStream: (stream: unknown) => Promise<unknown>;
  onSpeechStart: () => void;
  onSpeechEnd: (audio: Float32Array) => void;
  onVADMisfire: () => void;
}

/** Silero v5 config; assets live under the extension's `vad/` directory. */
export function buildVadOptions(
  baseAssetPath: string,
  handlers: VadHandlers,
  stream?: StreamLike,
): VadOptionsLike {
  return {
    model: 'v5',
    baseAssetPath,
    onnxWASMBasePath: baseAssetPath,
    positiveSpeechThreshold: VAD_TUNING.positiveSpeechThreshold,
    negativeSpeechThreshold: VAD_TUNING.negativeSpeechThreshold,
    redemptionMs: VAD_TUNING.redemptionMs,
    preSpeechPadMs: VAD_TUNING.preSpeechPadMs,
    minSpeechMs: VAD_TUNING.minSpeechMs,
    submitUserSpeechOnPause: VAD_TUNING.submitUserSpeechOnPause,
    getStream: async () => stream,
    pauseStream: async (captured) => {
      const media = captured as { getAudioTracks?: () => Array<{ enabled: boolean }> } | undefined;
      for (const track of media?.getAudioTracks?.() ?? []) track.enabled = false;
    },
    resumeStream: async (captured) => {
      const media = captured as { getAudioTracks?: () => Array<{ enabled: boolean }> } | undefined;
      for (const track of media?.getAudioTracks?.() ?? []) track.enabled = true;
      return captured;
    },
    onSpeechStart: handlers.onSpeechStart,
    onSpeechEnd: handlers.onSpeechEnd,
    onVADMisfire: handlers.onVADMisfire,
  };
}
