import { describe, expect, it, vi } from 'vitest';

import { OffscreenManager, type OffscreenApi } from '../src/background/offscreen-manager';
import { createMessageRouter } from '../src/background/router';
import type { AudioEvent, SpeechEndEvent } from '../src/messaging';

const RUNTIME_ID = 'extension-runtime-id';

function setup() {
  let open = false;
  const api: OffscreenApi = {
    hasDocument: vi.fn(async () => open),
    createDocument: vi.fn(async () => {
      open = true;
    }),
    closeDocument: vi.fn(async () => {
      open = false;
    }),
  };
  const manager = new OffscreenManager(api, { idleMs: 60_000 });
  const sendToOffscreen = vi.fn(async () => undefined);
  const broadcast = vi.fn(async (_event: AudioEvent) => undefined);
  const onSpeechEnd = vi.fn(async (_event: SpeechEndEvent) => undefined);
  const onTtsMessage = vi.fn(async () => ({ ok: true }));
  const router = createMessageRouter({
    runtimeId: RUNTIME_ID,
    manager,
    sendToOffscreen,
    broadcast,
    onSpeechEnd,
    onTtsMessage,
  });
  return { api, manager, sendToOffscreen, broadcast, onSpeechEnd, onTtsMessage, router };
}

function wav(): ArrayBuffer {
  return new ArrayBuffer(44);
}

describe('message router', () => {
  it('rejects an untrusted sender', async () => {
    const { router } = setup();
    const result = await router.handleMessage({ type: 'AUDIO_START' }, { id: 'someone-else' });
    expect(result).toEqual({ ok: false, error: 'UNTRUSTED_SENDER' });
  });

  it('rejects unknown message types', async () => {
    const { router } = setup();
    const result = await router.handleMessage({ type: 'WAT' }, { id: RUNTIME_ID });
    expect(result).toEqual({ ok: false, error: 'UNKNOWN_MESSAGE' });
  });

  it('creates the offscreen document and starts listening', async () => {
    const { router, api, sendToOffscreen, broadcast } = setup();
    const result = await router.handleMessage({ type: 'AUDIO_START' }, { id: RUNTIME_ID });
    expect(result.ok).toBe(true);
    expect(api.createDocument).toHaveBeenCalledTimes(1);
    expect(sendToOffscreen).toHaveBeenCalledWith({ type: 'AUDIO_START' });
    expect(broadcast).toHaveBeenCalledWith({
      type: 'LISTENING_STATE',
      listening: true,
      mutedForTts: false,
    });
    expect(router.isListening()).toBe(true);
  });

  it('toggles listening and schedules the idle close on stop', async () => {
    const { router, sendToOffscreen, manager } = setup();
    await router.toggle();
    expect(router.isListening()).toBe(true);
    await router.toggle();
    expect(router.isListening()).toBe(false);
    expect(sendToOffscreen).toHaveBeenLastCalledWith({ type: 'AUDIO_STOP' });
    expect(manager.idleScheduled).toBe(true);
    await manager.close();
  });

  it('forwards mute and unmute while tracking TTS state', async () => {
    const { router, sendToOffscreen, broadcast } = setup();
    await router.handleMessage({ type: 'AUDIO_START' }, { id: RUNTIME_ID });
    await router.handleMessage({ type: 'AUDIO_MUTE' }, { id: RUNTIME_ID });
    expect(router.isMuted()).toBe(true);
    expect(sendToOffscreen).toHaveBeenLastCalledWith({ type: 'AUDIO_MUTE' });
    await router.handleMessage({ type: 'AUDIO_UNMUTE' }, { id: RUNTIME_ID });
    expect(router.isMuted()).toBe(false);
    expect(broadcast).toHaveBeenLastCalledWith({
      type: 'LISTENING_STATE',
      listening: true,
      mutedForTts: false,
    });
  });

  it('sends speech-end audio to D-2 only, never to a tab', async () => {
    const { router, broadcast, onSpeechEnd } = setup();
    const event = { type: 'VAD_SPEECH_END', at: 1, durationMs: 900, audio: wav() } as const;
    expect((await router.handleMessage(event, { id: RUNTIME_ID })).ok).toBe(true);
    expect(onSpeechEnd).toHaveBeenCalledWith(event);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('rejects an audio payload arriving from a content script', async () => {
    const { router, onSpeechEnd } = setup();
    const event = { type: 'VAD_SPEECH_END', at: 1, durationMs: 900, audio: wav() } as const;
    const result = await router.handleMessage(event, { id: RUNTIME_ID, tab: { id: 42 } });
    expect(result).toEqual({ ok: false, error: 'AUDIO_IN_CONTENT_PATH' });
    expect(onSpeechEnd).not.toHaveBeenCalled();
  });

  it('broadcasts non-audio events to the tab', async () => {
    const { router, broadcast } = setup();
    const event = { type: 'VAD_SPEECH_START', at: 5 } as const;
    await router.handleMessage(event, { id: RUNTIME_ID });
    expect(broadcast).toHaveBeenCalledWith(event);
  });

  it('forwards TTS messages to the offscreen host', async () => {
    const { router, onTtsMessage } = setup();
    const result = await router.handleMessage(
      { type: 'TTS_SPEAK', text: 'Please clarify.' },
      { id: RUNTIME_ID },
    );
    expect(result.ok).toBe(true);
    expect(onTtsMessage).toHaveBeenCalledWith({ type: 'TTS_SPEAK', text: 'Please clarify.' });
  });

  it('clears listening state after an audio error', async () => {
    const { router } = setup();
    await router.handleMessage({ type: 'AUDIO_START' }, { id: RUNTIME_ID });
    expect(router.isListening()).toBe(true);
    await router.handleMessage(
      { type: 'AUDIO_ERROR', code: 'NOT_ALLOWED', message: 'denied' },
      { id: RUNTIME_ID },
    );
    expect(router.isListening()).toBe(false);
  });
});
