import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PcmCollector } from '../src/audio/pcm';
import type { AudioEvent } from '../src/messaging';
import {
  AudioController,
  type StreamLike,
  type VadHandlers,
  type VadLike,
} from '../src/offscreen/controller';

function harness() {
  const handlers: Partial<VadHandlers> = {};
  const track = {
    readyState: 'live',
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
  };
  const stream: StreamLike = { getTracks: () => [track] };
  const vad: VadLike = {
    start: vi.fn(async () => undefined),
    pause: vi.fn(),
    resume: vi.fn(async () => undefined),
    destroy: vi.fn(),
  };
  const collector = new PcmCollector(16_000 * 35);
  const events: AudioEvent[] = [];
  const getUserMedia = vi.fn(async () => stream);
  const createVad = vi.fn(async (vadHandlers: VadHandlers, _stream: StreamLike) => {
    Object.assign(handlers, vadHandlers);
    return vad;
  });
  const controller = new AudioController({
    getUserMedia,
    createVad,
    emit: (event) => events.push(event),
    attachCollector: () => collector,
    sampleRate: () => 16_000,
  });
  return { controller, handlers, track, vad, collector, events, getUserMedia, createVad };
}

function tone(samples: number, amplitude = 0.5): Float32Array {
  const output = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) {
    output[index] = Math.sin((2 * Math.PI * 220 * index) / 16_000) * amplitude;
  }
  return output;
}

describe('AudioController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('requests 16 kHz mono capture with the browser cleanup filters', async () => {
    const { controller, getUserMedia, events } = harness();
    await controller.start();
    const constraints = getUserMedia.mock.calls[0]?.[0] as MediaStreamConstraints;
    expect(constraints.audio).toMatchObject({
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 16_000,
    });
    expect(events).toContainEqual({ type: 'AUDIO_READY' });
    expect(events).toContainEqual({ type: 'LISTENING_STATE', listening: true, mutedForTts: false });
  });

  it('emits a WAV utterance with the measured duration', async () => {
    const { controller, handlers, events } = harness();
    await controller.start();
    handlers.onSpeechStart?.();
    expect(events).toContainEqual({ type: 'VAD_SPEECH_START', at: expect.any(Number) });
    handlers.onSpeechEnd?.(tone(16_000));
    const end = events.find((event) => event.type === 'VAD_SPEECH_END');
    expect(end).toBeDefined();
    if (end?.type === 'VAD_SPEECH_END') {
      expect(end.durationMs).toBe(1000);
      expect(end.audio.byteLength).toBe(44 + 32_000);
    }
  });

  it('treats a sub-300 ms burst as a misfire', async () => {
    const { controller, handlers, events } = harness();
    await controller.start();
    handlers.onSpeechStart?.();
    handlers.onSpeechEnd?.(tone(1600));
    expect(events.some((event) => event.type === 'VAD_MISFIRE')).toBe(true);
    expect(events.some((event) => event.type === 'VAD_SPEECH_END')).toBe(false);
  });

  it('cuts a long utterance at 30 seconds and stops listening', async () => {
    const { controller, handlers, collector, events, track } = harness();
    await controller.start();
    handlers.onSpeechStart?.();
    for (let index = 0; index < 10; index += 1) collector.push(tone(48_000));
    await vi.advanceTimersByTimeAsync(30_000);
    const end = events.find((event) => event.type === 'VAD_SPEECH_END');
    expect(end).toBeDefined();
    if (end?.type === 'VAD_SPEECH_END') {
      expect(end.durationMs).toBe(30_000);
      expect(end.audio.byteLength).toBe(44 + 16_000 * 2 * 30);
    }
    expect(events).toContainEqual({
      type: 'LISTENING_STATE',
      listening: false,
      mutedForTts: false,
    });
    expect(track.readyState).toBe('ended');
  });

  it('releases the microphone track on stop', async () => {
    const { controller, track, vad, events } = harness();
    await controller.start();
    await controller.stop();
    expect(track.stop).toHaveBeenCalled();
    expect(track.readyState).toBe('ended');
    expect(vad.destroy).toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'LISTENING_STATE',
      listening: false,
      mutedForTts: false,
    });
  });

  it('pauses detection while TTS speaks and resumes after a 250 ms tail', async () => {
    const { controller, handlers, vad, events } = harness();
    await controller.start();
    controller.mute();
    expect(vad.pause).toHaveBeenCalled();
    expect(events).toContainEqual({ type: 'LISTENING_STATE', listening: true, mutedForTts: true });

    handlers.onSpeechStart?.();
    expect(events.some((event) => event.type === 'VAD_SPEECH_START')).toBe(false);

    controller.unmute();
    await vi.advanceTimersByTimeAsync(249);
    expect(vad.resume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(vad.resume).toHaveBeenCalled();
    expect(events).toContainEqual({ type: 'LISTENING_STATE', listening: true, mutedForTts: false });
  });

  it('auto-stops after 60 s of continuous listening without speech', async () => {
    const { controller, track, events } = harness();
    await controller.start();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(controller.isListening).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.isListening).toBe(false);
    expect(track.readyState).toBe('ended');
    expect(events).toContainEqual({
      type: 'LISTENING_STATE',
      listening: false,
      mutedForTts: false,
    });
  });

  it('maps a denied microphone permission to NOT_ALLOWED', async () => {
    const { controller, getUserMedia, events } = harness();
    const denied = new Error('Permission denied');
    denied.name = 'NotAllowedError';
    getUserMedia.mockRejectedValueOnce(denied);
    await controller.start();
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'AUDIO_ERROR', code: 'NOT_ALLOWED' }),
    );
    expect(controller.isListening).toBe(false);
  });
});
