import { z } from 'zod';

/**
 * Extension-internal contract (deliberately not part of @vfe/protocol).
 * Every payload is validated locally; nothing is trusted from a sender.
 */
export const AudioErrorCodeSchema = z.enum([
  'NOT_ALLOWED',
  'NO_DEVICE',
  'DEVICE_BUSY',
  'UNSUPPORTED',
  'VAD_INIT_FAILED',
  'OFFSCREEN_FAILED',
]);
export type AudioErrorCode = z.infer<typeof AudioErrorCodeSchema>;

export const AudioCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('AUDIO_START') }),
  z.object({ type: z.literal('AUDIO_STOP') }),
  z.object({ type: z.literal('AUDIO_MUTE') }),
  z.object({ type: z.literal('AUDIO_UNMUTE') }),
]);
export type AudioCommand = z.infer<typeof AudioCommandSchema>;

export const AudioEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('AUDIO_READY') }),
  z.object({
    type: z.literal('AUDIO_ERROR'),
    code: AudioErrorCodeSchema,
    message: z.string().max(500),
  }),
  z.object({ type: z.literal('VAD_SPEECH_START'), at: z.number() }),
  z.object({
    type: z.literal('VAD_SPEECH_END'),
    at: z.number(),
    durationMs: z.number(),
    audio: z.instanceof(ArrayBuffer),
  }),
  z.object({ type: z.literal('VAD_MISFIRE'), rmsDb: z.number() }),
  z.object({
    type: z.literal('LISTENING_STATE'),
    listening: z.boolean(),
    mutedForTts: z.boolean(),
  }),
]);
export type AudioEvent = z.infer<typeof AudioEventSchema>;
export type SpeechEndEvent = Extract<AudioEvent, { type: 'VAD_SPEECH_END' }>;

export const TtsMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('TTS_SPEAK'),
    text: z.string().min(1).max(2000),
    lang: z.string().max(20).optional(),
    rate: z.number().min(0.5).max(2).optional(),
  }),
  z.object({ type: z.literal('TTS_STOP') }),
]);
export type TtsMessage = z.infer<typeof TtsMessageSchema>;

export const TranscriptReadySchema = z.object({
  type: z.literal('TRANSCRIPT_READY'),
  transcript: z.string(),
  latencyMs: z.number(),
  truncated: z.boolean(),
});
export const TranscriptErrorSchema = z.object({
  type: z.literal('TRANSCRIPT_ERROR'),
  code: z.string(),
  message: z.string().max(500),
});
export const SttMetricsSchema = z.object({
  type: z.literal('STT_METRICS'),
  encodeMs: z.number(),
  uploadMs: z.number(),
  providerMs: z.number(),
  totalMs: z.number(),
  bytes: z.number(),
});
export const AssistantMessageSchema = z.discriminatedUnion('type', [
  TranscriptReadySchema,
  TranscriptErrorSchema,
  SttMetricsSchema,
]);
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;
export type TranscriptReadyMessage = z.infer<typeof TranscriptReadySchema>;
export type TranscriptErrorMessage = z.infer<typeof TranscriptErrorSchema>;
export type SttMetricsMessage = z.infer<typeof SttMetricsSchema>;

export interface RuntimeSender {
  id?: string;
  tab?: { id?: number };
  url?: string;
}

export interface ParseFailure {
  ok: false;
  error: string;
}

export type ParseResult<T> = { ok: true; value: T } | ParseFailure;

export function parseAudioCommand(raw: unknown): ParseResult<AudioCommand> {
  const parsed = AudioCommandSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: 'INVALID_AUDIO_COMMAND' };
}

export function parseTtsMessage(raw: unknown): ParseResult<TtsMessage> {
  const parsed = TtsMessageSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: 'INVALID_TTS_MESSAGE' };
}

export function parseAudioEvent(raw: unknown): ParseResult<AudioEvent> {
  const parsed = AudioEventSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: 'INVALID_AUDIO_EVENT' };
}

/** A sender is trusted only when it is this extension instance. */
export function isTrustedSender(sender: RuntimeSender | undefined, runtimeId: string): boolean {
  return Boolean(sender && runtimeId && sender.id === runtimeId);
}

/** Raw audio may only travel offscreen → service worker (D-2). Never to a tab. */
export function hasAudioPayload(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'audio' in raw &&
    (raw as { audio?: unknown }).audio !== undefined
  );
}

/** Content scripts must never receive the utterance buffer. */
export function contentMayReceive(event: AudioEvent): boolean {
  return !hasAudioPayload(event);
}
