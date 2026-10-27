import { resampleTo16k } from '../audio/resample';
import { encodeWavPcm16, rmsDb, TARGET_SAMPLE_RATE } from '../audio/wav';
import type { AudioErrorCode, AudioEvent } from '../messaging';

import { VAD_TUNING } from './vad-config';

export interface TrackLike {
  stop: () => void;
  readyState: string;
}

export interface StreamLike {
  getTracks: () => TrackLike[];
}

export interface VadHandlers {
  onSpeechStart: () => void;
  onSpeechEnd: (audio: Float32Array) => void;
  onVADMisfire: () => void;
}

export interface VadLike {
  start: () => Promise<void>;
  pause: () => void;
  resume?: () => Promise<void>;
  destroy: () => void;
}

export interface CollectorLike {
  push: (frame: Float32Array) => void;
  mark: () => number;
  since: (mark: number) => Float32Array;
  clear: () => void;
  dispose?: () => void;
}

export interface ControllerDeps {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<StreamLike>;
  createVad: (handlers: VadHandlers, stream: StreamLike) => Promise<VadLike>;
  emit: (event: AudioEvent) => void;
  attachCollector?: (stream: StreamLike) => CollectorLike | null;
  sampleRate?: () => number;
  now?: () => number;
}

function errorCode(error: unknown): AudioErrorCode {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'NOT_ALLOWED';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'NO_DEVICE';
    case 'NotReadableError':
    case 'AbortError':
      return 'DEVICE_BUSY';
    default:
      return 'UNSUPPORTED';
  }
}

/**
 * Owns one listening session: stream, VAD, timers, mute state and the bounded
 * utterance. Audio lives only in this object's memory and is never persisted.
 */
export class AudioController {
  private stream: StreamLike | null = null;
  private vad: VadLike | null = null;
  private collector: CollectorLike | null = null;
  private listening = false;
  private muted = false;
  private speechStartedAt: number | null = null;
  private speechMark = 0;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private unmuteTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: ControllerDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private emit(event: AudioEvent): void {
    this.deps.emit(event);
  }

  private listenState(): void {
    this.emit({ type: 'LISTENING_STATE', listening: this.listening, mutedForTts: this.muted });
  }

  private clearTimers(): void {
    if (this.maxTimer) clearTimeout(this.maxTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.unmuteTimer) clearTimeout(this.unmuteTimer);
    this.maxTimer = null;
    this.silenceTimer = null;
    this.unmuteTimer = null;
  }

  private scheduleSilenceStop(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      void this.stop();
    }, VAD_TUNING.silenceAutoStopMs);
  }

  async start(): Promise<void> {
    if (this.listening) return;
    try {
      this.stream = await this.deps.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: VAD_TUNING.sampleRate,
        },
      });
      this.collector = this.deps.attachCollector?.(this.stream) ?? null;
      this.vad = await this.deps.createVad(
        {
          onSpeechStart: () => this.handleSpeechStart(),
          onSpeechEnd: (audio) => void this.handleSpeechEnd(audio),
          onVADMisfire: () => this.handleMisfire(),
        },
        this.stream,
      );
      await this.vad.start();
      this.listening = true;
      this.muted = false;
      this.emit({ type: 'AUDIO_READY' });
      this.listenState();
      this.scheduleSilenceStop();
    } catch (error) {
      this.releaseStream();
      this.emit({
        type: 'AUDIO_ERROR',
        code: errorCode(error),
        message: error instanceof Error ? error.message : 'Audio capture failed',
      });
      this.listening = false;
      this.listenState();
    }
  }

  private releaseStream(): void {
    if (this.collector) {
      this.collector.dispose?.();
      this.collector.clear();
      this.collector = null;
    }
    for (const track of this.stream?.getTracks() ?? []) {
      if (track.readyState !== 'ended') track.stop();
    }
    this.stream = null;
  }

  async stop(): Promise<void> {
    this.clearTimers();
    try {
      this.vad?.pause();
      (this.vad as { destroy?: () => void } | null)?.destroy?.();
    } catch {
      // A destroyed VAD cannot be paused twice; stop must still release the mic.
    }
    this.vad = null;
    this.releaseStream();
    this.speechStartedAt = null;
    const wasListening = this.listening;
    this.listening = false;
    this.muted = false;
    if (wasListening) this.listenState();
  }

  mute(): void {
    if (!this.listening || this.muted) return;
    this.muted = true;
    this.clearTimers();
    this.vad?.pause();
    this.listenState();
  }

  unmute(): void {
    if (!this.listening || !this.muted) return;
    if (this.unmuteTimer) clearTimeout(this.unmuteTimer);
    // 250 ms tail so the last TTS phoneme cannot re-trigger the VAD.
    this.unmuteTimer = setTimeout(() => {
      this.unmuteTimer = null;
      this.muted = false;
      void this.vad?.resume?.();
      this.listenState();
      this.scheduleSilenceStop();
    }, VAD_TUNING.muteTailMs);
  }

  private handleSpeechStart(): void {
    if (this.muted || !this.listening) return;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    this.speechStartedAt = this.now();
    this.speechMark = this.collector?.mark() ?? 0;
    this.emit({ type: 'VAD_SPEECH_START', at: this.speechStartedAt });
    this.maxTimer = setTimeout(() => {
      void this.forceSpeechEnd();
    }, VAD_TUNING.maxUtteranceMs);
  }

  private async handleSpeechEnd(audio: Float32Array): Promise<void> {
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.maxTimer = null;
    this.speechStartedAt = null;
    const durationMs = Math.round((audio.length / TARGET_SAMPLE_RATE) * 1000);
    if (durationMs < VAD_TUNING.minSpeechMs) {
      this.emit({ type: 'VAD_MISFIRE', rmsDb: rmsDb(audio) });
      this.scheduleSilenceStop();
      return;
    }
    const wav = encodeWavPcm16(audio);
    this.emit({ type: 'VAD_SPEECH_END', at: this.now(), durationMs, audio: wav });
    this.scheduleSilenceStop();
  }

  private handleMisfire(): void {
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.maxTimer = null;
    const samples = this.collector?.since(this.speechMark) ?? new Float32Array(0);
    this.emit({ type: 'VAD_MISFIRE', rmsDb: rmsDb(samples) });
    this.speechStartedAt = null;
    this.scheduleSilenceStop();
  }

  /** VAD cannot flush on demand, so a 30 s cap uses the parallel PCM collector. */
  private async forceSpeechEnd(): Promise<void> {
    if (!this.listening || this.speechStartedAt === null) return;
    const captured = this.collector?.since(this.speechMark) ?? new Float32Array(0);
    const inputRate = this.deps.sampleRate?.() ?? TARGET_SAMPLE_RATE;
    const resampled = await resampleTo16k(captured, inputRate);
    const capped = resampled.subarray(0, (TARGET_SAMPLE_RATE * VAD_TUNING.maxUtteranceMs) / 1000);
    this.emit({
      type: 'VAD_SPEECH_END',
      at: this.now(),
      durationMs: VAD_TUNING.maxUtteranceMs,
      audio: encodeWavPcm16(capped),
    });
    this.speechStartedAt = null;
    await this.stop();
  }

  get isListening(): boolean {
    return this.listening;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Test/offscreen hook: push PCM frames into the rolling collector. */
  pushAudio(frame: Float32Array): void {
    this.collector?.push(frame);
  }

  /** E2E hook: expose track state without leaking audio. */
  debugState(): { listening: boolean; muted: boolean; tracks: string[] } {
    return {
      listening: this.listening,
      muted: this.muted,
      tracks: (this.stream?.getTracks() ?? []).map((track) => track.readyState),
    };
  }
}
