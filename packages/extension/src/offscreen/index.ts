import { MicVAD } from '@ricky0123/vad-web';

import { PcmCollector } from '../audio/pcm';
import { parseAudioCommand, type AudioEvent } from '../messaging';

import {
  AudioController,
  type CollectorLike,
  type StreamLike,
  type VadHandlers,
  type VadLike,
} from './controller';
import { buildVadOptions } from './vad-config';

/**
 * Offscreen document: the only extension context that can hold the microphone.
 * One permission (the extension's origin) covers every site.
 */

function emit(event: AudioEvent): void {
  void chrome.runtime.sendMessage(event).catch(() => undefined);
}

function attachCollector(stream: StreamLike): CollectorLike & { sampleRate: number } {
  const context = new AudioContext();
  const collector = new PcmCollector(context.sampleRate * 35);
  const source = context.createMediaStreamSource(stream as unknown as MediaStream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    collector.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);
  return Object.assign(collector, {
    sampleRate: context.sampleRate,
    dispose: () => {
      processor.onaudioprocess = null;
      try {
        source.disconnect();
        processor.disconnect();
        mute.disconnect();
      } catch {
        // Nodes may already be gone when the document is closing.
      }
      void context.close().catch(() => undefined);
    },
  });
}

let collectorRate = 16_000;

const controller = new AudioController({
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  attachCollector: (stream) => {
    const collector = attachCollector(stream);
    collectorRate = collector.sampleRate;
    return collector;
  },
  sampleRate: () => collectorRate,
  createVad: async (handlers: VadHandlers, stream: StreamLike): Promise<VadLike> => {
    const options = buildVadOptions(chrome.runtime.getURL('vad/'), handlers, stream);
    const vad = await MicVAD.new(options as unknown as Parameters<typeof MicVAD.new>[0]);
    return {
      start: () => vad.start(),
      pause: () => vad.pause(),
      resume: () => vad.resume(),
      destroy: () => vad.destroy(),
    };
  },
  emit,
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  const parsed = parseAudioCommand(message);
  if (!parsed.ok) return;
  switch (parsed.value.type) {
    case 'AUDIO_START':
      void controller.start();
      break;
    case 'AUDIO_STOP':
      void controller.stop();
      break;
    case 'AUDIO_MUTE':
      controller.mute();
      break;
    case 'AUDIO_UNMUTE':
      controller.unmute();
      break;
  }
});

// Extension-internal E2E hook; this page is never injected into a web page.
(globalThis as unknown as { __vfeAudio?: unknown }).__vfeAudio = { controller };

emit({ type: 'AUDIO_READY' });
