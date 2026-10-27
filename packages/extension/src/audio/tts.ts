export interface SpeakOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  /** Pause the VAD while speaking and resume after a 250 ms tail. */
  muteVad?: boolean;
  voice?: SpeechSynthesisVoice | null;
  signal?: AbortSignal;
}

export type SpeakFailure = 'NO_VOICE' | 'CANCELLED' | 'EMPTY' | 'ERROR';

export interface SpeakResult {
  spoken: boolean;
  reason?: SpeakFailure;
}

export interface UtteranceLike {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  voice: SpeechSynthesisVoice | null;
  onend: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
}

export interface SynthLike {
  speak: (utterance: UtteranceLike) => void;
  cancel: () => void;
  getVoices: () => SpeechSynthesisVoice[];
  speaking?: boolean;
}

export interface TtsDeps {
  synth: SynthLike;
  createUtterance?: (text: string) => UtteranceLike;
  mute?: () => Promise<void> | void;
  unmute?: () => Promise<void> | void;
}

export const MUTE_TAIL_MS = 250;
export const MAX_CHUNK_CHARS = 200;
export const MAX_SPEECH_RATE = 4;

/** Chrome cuts long utterances at ~15 s, so speak in sentence-sized chunks. */
export function splitForSpeech(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const clean = text
    .replace(/<redacted>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  const push = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed.length <= maxChars) {
      chunks.push(trimmed);
      return;
    }
    // Break on word boundaries; hard-split pathological tokens.
    let buffer = '';
    for (const word of trimmed.split(/\s+/)) {
      if (word.length > maxChars) {
        if (buffer) chunks.push(buffer);
        buffer = '';
        for (let index = 0; index < word.length; index += maxChars) {
          chunks.push(word.slice(index, index + maxChars));
        }
        continue;
      }
      const candidate = buffer ? `${buffer} ${word}` : word;
      if (candidate.length > maxChars) {
        chunks.push(buffer);
        buffer = word;
      } else {
        buffer = candidate;
      }
    }
    if (buffer) chunks.push(buffer);
  };

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) push(current);
      current = '';
      if (sentence.length <= maxChars) current = sentence;
      else push(sentence);
    }
  }
  if (current) push(current);
  return chunks;
}

export function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const target = lang.toLowerCase();
  const prefix = target.split('-')[0] ?? target;
  const local = voices.filter((voice) => voice.localService);
  return (
    local.find((voice) => voice.lang.toLowerCase().startsWith(target)) ??
    local.find((voice) => voice.lang.toLowerCase().startsWith(prefix)) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(target)) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix)) ??
    voices[0] ??
    null
  );
}

function defaultUtterance(text: string): UtteranceLike {
  const utterance = new SpeechSynthesisUtterance(text);
  return utterance as unknown as UtteranceLike;
}

/**
 * Speech synthesis host. It lives in the offscreen document because Chrome
 * pauses `window.speechSynthesis` in background tabs but not in extension pages.
 */
export class TtsClient {
  private pending: ((result: 'ended' | 'cancelled' | 'error') => void) | null = null;
  private generation = 0;
  private unmuteTimer: ReturnType<typeof setTimeout> | null = null;
  private muted = false;

  constructor(private readonly deps: TtsDeps) {}

  private get synth(): SynthLike {
    return this.deps.synth;
  }

  listVoices(): SpeechSynthesisVoice[] {
    try {
      return this.synth.getVoices();
    } catch {
      return [];
    }
  }

  isSpeaking(): boolean {
    return this.pending !== null || this.synth.speaking === true;
  }

  private cancelCurrent(): void {
    this.generation += 1;
    if (this.pending) {
      this.pending('cancelled');
      this.pending = null;
    }
    try {
      this.synth.cancel();
    } catch {
      // Some platforms throw when nothing is speaking.
    }
  }

  private scheduleUnmute(): void {
    if (!this.muted) return;
    if (this.unmuteTimer) clearTimeout(this.unmuteTimer);
    this.unmuteTimer = setTimeout(() => {
      this.unmuteTimer = null;
      this.muted = false;
      void this.deps.unmute?.();
    }, MUTE_TAIL_MS);
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<SpeakResult> {
    const chunks = splitForSpeech(text);
    if (chunks.length === 0) return { spoken: false, reason: 'EMPTY' };

    const voices = this.listVoices();
    if (voices.length === 0) return { spoken: false, reason: 'NO_VOICE' };

    this.cancelCurrent();
    const generation = this.generation;
    const lang = options.lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
    const voice = options.voice ?? pickVoice(voices, lang);

    if (options.muteVad !== false) {
      this.muted = true;
      if (this.unmuteTimer) {
        clearTimeout(this.unmuteTimer);
        this.unmuteTimer = null;
      }
      await this.deps.mute?.();
    }

    let cancelled = false;
    let ended = 0;
    try {
      for (const chunk of chunks) {
        if (generation !== this.generation) {
          cancelled = true;
          break;
        }
        const result = await this.speakChunk(chunk, { ...options, lang, voice });
        if (result === 'cancelled') {
          cancelled = true;
          break;
        }
        if (result === 'ended') ended += 1;
        if (options.signal?.aborted) {
          cancelled = true;
          break;
        }
      }
    } finally {
      if (options.muteVad !== false) this.scheduleUnmute();
    }

    if (cancelled) return { spoken: false, reason: 'CANCELLED' };
    if (ended === 0) return { spoken: false, reason: 'ERROR' };
    return { spoken: true };
  }

  private speakChunk(
    text: string,
    options: SpeakOptions & { lang: string; voice: SpeechSynthesisVoice | null },
  ): Promise<'ended' | 'cancelled' | 'error'> {
    return new Promise((resolve) => {
      const utterance = (this.deps.createUtterance ?? defaultUtterance)(text);
      utterance.lang = options.lang;
      utterance.rate = Math.min(options.rate ?? 1.02, MAX_SPEECH_RATE);
      utterance.pitch = options.pitch ?? 1;
      utterance.volume = options.volume ?? 1;
      utterance.voice = options.voice ?? null;

      const finish = (result: 'ended' | 'cancelled' | 'error'): void => {
        if (this.pending !== resolve) return;
        this.pending = null;
        resolve(result);
      };
      this.pending = resolve;
      utterance.onend = () => finish('ended');
      utterance.onerror = () => finish('error');
      try {
        this.synth.speak(utterance);
      } catch {
        finish('error');
      }
    });
  }

  stopSpeaking(): void {
    this.cancelCurrent();
    if (this.unmuteTimer) {
      clearTimeout(this.unmuteTimer);
      this.unmuteTimer = null;
    }
    if (this.muted) {
      this.muted = false;
      void this.deps.unmute?.();
    }
  }
}

let singleton: TtsClient | null = null;
let handlers: { mute?: () => Promise<void> | void; unmute?: () => Promise<void> | void } = {};
let synthOverride: SynthLike | null = null;

/** Offscreen wiring: mute the VAD directly instead of round-tripping messages. */
export function configureTts(options: {
  mute?: () => Promise<void> | void;
  unmute?: () => Promise<void> | void;
  synth?: SynthLike;
  createUtterance?: (text: string) => UtteranceLike;
}): void {
  handlers = { mute: options.mute, unmute: options.unmute };
  if (options.createUtterance) utteranceFactory = options.createUtterance;
  if (options.synth) synthOverride = options.synth;
  singleton = null;
}

let utteranceFactory: (text: string) => UtteranceLike = defaultUtterance;

function defaultClient(): TtsClient {
  if (singleton) return singleton;
  const synth = synthOverride ?? (globalThis.speechSynthesis as unknown as SynthLike | undefined);
  if (!synth) throw new Error('speechSynthesis is unavailable');
  singleton = new TtsClient({
    synth,
    createUtterance: utteranceFactory,
    mute: handlers.mute,
    unmute: handlers.unmute,
  });
  return singleton;
}

export function speak(text: string, options: SpeakOptions = {}): Promise<SpeakResult> {
  try {
    return defaultClient().speak(text, options);
  } catch {
    return Promise.resolve({ spoken: false, reason: 'NO_VOICE' });
  }
}

export function stopSpeaking(): void {
  try {
    defaultClient().stopSpeaking();
  } catch {
    // Nothing to stop.
  }
}

export function isSpeaking(): boolean {
  try {
    return defaultClient().isSpeaking();
  } catch {
    return false;
  }
}

export function listVoices(): SpeechSynthesisVoice[] {
  try {
    return defaultClient().listVoices();
  } catch {
    return [];
  }
}
