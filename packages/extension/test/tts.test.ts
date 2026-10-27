import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_CHUNK_CHARS,
  TtsClient,
  pickVoice,
  splitForSpeech,
  type SynthLike,
  type UtteranceLike,
} from '../src/audio/tts';

function voice(
  lang: string,
  localService: boolean,
  name = `${lang}-${localService}`,
): SpeechSynthesisVoice {
  return { lang, localService, name, voiceURI: name, default: false } as SpeechSynthesisVoice;
}

class FakeSynth implements SynthLike {
  voices: SpeechSynthesisVoice[] = [voice('en-US', true)];
  spoken: string[] = [];
  cancelled = 0;
  speaking = false;
  autoEnd = true;
  current: UtteranceLike | null = null;

  speak = (utterance: UtteranceLike): void => {
    this.spoken.push(utterance.text);
    this.current = utterance;
    this.speaking = true;
    if (this.autoEnd) {
      queueMicrotask(() => {
        this.speaking = false;
        utterance.onend?.();
      });
    }
  };

  cancel = (): void => {
    this.cancelled += 1;
    this.speaking = false;
  };

  getVoices = (): SpeechSynthesisVoice[] => this.voices;

  endCurrent(): void {
    this.speaking = false;
    this.current?.onend?.();
  }
}

function makeClient(synth: FakeSynth) {
  const mute = vi.fn();
  const unmute = vi.fn();
  const createUtterance = (text: string): UtteranceLike => ({
    text,
    lang: '',
    rate: 1,
    pitch: 1,
    volume: 1,
    voice: null,
    onend: null,
    onerror: null,
  });
  const client = new TtsClient({ synth, createUtterance, mute, unmute });
  return { client, mute, unmute };
}

function sentence(char: string, length: number): string {
  return `${char.repeat(length - 1)}.`;
}

describe('splitForSpeech', () => {
  it('chunks long text on sentence boundaries', () => {
    const text = [sentence('a', 149), sentence('b', 149), sentence('c', 149)].join(' ');
    const chunks = splitForSpeech(text);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.length <= MAX_CHUNK_CHARS)).toBe(true);
  });

  it('packs short sentences together', () => {
    expect(splitForSpeech('Hi. How are you? Fine.')).toEqual(['Hi. How are you? Fine.']);
  });

  it('splits a single overlong sentence on words', () => {
    const text = `${'word '.repeat(80)}end.`;
    const chunks = splitForSpeech(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= MAX_CHUNK_CHARS)).toBe(true);
  });

  it('drops redacted markers', () => {
    expect(splitForSpeech('Your password is <redacted>')).toEqual(['Your password is']);
  });
});

describe('TtsClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('speaks every chunk and resolves after the last', async () => {
    const synth = new FakeSynth();
    const { client } = makeClient(synth);
    const text = [sentence('a', 149), sentence('b', 149), sentence('c', 149)].join(' ');
    const result = await client.speak(text);
    expect(result).toEqual({ spoken: true });
    expect(synth.spoken).toHaveLength(3);
  });

  it('mutes before speaking and unmutes 250 ms after the end', async () => {
    const synth = new FakeSynth();
    const { client, mute, unmute } = makeClient(synth);
    await client.speak('Please clarify.');
    expect(mute).toHaveBeenCalledTimes(1);
    expect(unmute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(249);
    expect(unmute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(unmute).toHaveBeenCalledTimes(1);
  });

  it('interrupts the previous utterance when a new one starts', async () => {
    const synth = new FakeSynth();
    synth.autoEnd = false;
    const { client } = makeClient(synth);
    const first = client.speak('A long first sentence.');
    await Promise.resolve();
    const second = client.speak('Second sentence.');
    await expect(first).resolves.toEqual({ spoken: false, reason: 'CANCELLED' });
    expect(synth.cancelled).toBeGreaterThan(0);
    synth.endCurrent();
    await expect(second).resolves.toEqual({ spoken: true });
  });

  it('resolves NO_VOICE without speaking when the voice list is empty', async () => {
    const synth = new FakeSynth();
    synth.voices = [];
    const { client, mute } = makeClient(synth);
    const result = await client.speak('Hello.');
    expect(result).toEqual({ spoken: false, reason: 'NO_VOICE' });
    expect(synth.spoken).toHaveLength(0);
    expect(mute).not.toHaveBeenCalled();
  });

  it('strips <redacted> before speaking', async () => {
    const synth = new FakeSynth();
    const { client } = makeClient(synth);
    await client.speak('Filled your password: <redacted>');
    expect(synth.spoken.join(' ')).not.toContain('redacted>');
    expect(synth.spoken.join(' ')).toContain('Filled your password');
  });

  it('stopSpeaking cancels and unmutes immediately', async () => {
    const synth = new FakeSynth();
    synth.autoEnd = false;
    const { client, unmute } = makeClient(synth);
    const speaking = client.speak('Something long to say.');
    await Promise.resolve();
    client.stopSpeaking();
    await expect(speaking).resolves.toMatchObject({ spoken: false });
    expect(unmute).toHaveBeenCalled();
    expect(client.isSpeaking()).toBe(false);
  });

  it('prefers a local voice matching the requested locale', () => {
    const voices = [voice('en-GB', false), voice('en-US', true), voice('fr-FR', true)];
    expect(pickVoice(voices, 'en-US')?.name).toBe('en-US-true');
    expect(pickVoice(voices, 'fr')?.name).toBe('fr-FR-true');
    expect(pickVoice([], 'en')).toBeNull();
  });

  it('sets language, rate and voice on every utterance', async () => {
    const synth = new FakeSynth();
    const seen: UtteranceLike[] = [];
    const client = new TtsClient({
      synth,
      createUtterance: (text) => {
        const utterance: UtteranceLike = {
          text,
          lang: '',
          rate: 1,
          pitch: 1,
          volume: 1,
          voice: null,
          onend: null,
          onerror: null,
        };
        seen.push(utterance);
        return utterance;
      },
    });
    await client.speak('Hello there.', { lang: 'en-GB', rate: 1.3 });
    expect(seen[0]).toMatchObject({ lang: 'en-GB', rate: 1.3 });
    expect(seen[0]?.voice?.lang.startsWith('en')).toBe(true);
  });
});
