import { fileURLToPath } from 'node:url';

import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

const RUN = process.env.RUN_EXTENSION_E2E === '1';
const extensionPath = fileURLToPath(new URL('../../dist', import.meta.url));
const fixture = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/audio/${name}`, import.meta.url));

interface Harness {
  context: BrowserContext;
  offscreen: Page;
  trigger: (command: string) => Promise<void>;
  events: () => Promise<Array<{ type: string; durationMs?: number }>>;
}

async function launch(audioFixture: string): Promise<Harness> {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${audioFixture}`,
    ],
  });
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const offscreen = await context.newPage();
  await offscreen.goto(`chrome-extension://${extensionId}/offscreen.html`);
  await offscreen.evaluate(() => {
    const target = globalThis as unknown as { __events: unknown[] };
    target.__events = [];
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((message: unknown, ...rest: unknown[]) => {
      target.__events.push(message);
      return (original as (...args: unknown[]) => unknown)(message, ...rest);
    }) as typeof chrome.runtime.sendMessage;
  });
  return {
    context,
    offscreen,
    trigger: async (command) => {
      await worker.evaluate((type) => chrome.runtime.sendMessage({ type }), command);
    },
    events: () =>
      offscreen.evaluate(
        () =>
          (globalThis as unknown as { __events: Array<{ type: string; durationMs?: number }> })
            .__events,
      ),
  };
}

test.describe('MV3 audio pipeline', () => {
  test.skip(!RUN, 'Set RUN_EXTENSION_E2E=1 to run extension audio tests');

  test('speech-end-fired', async () => {
    const harness = await launch(fixture('speech-1.8s.wav'));
    try {
      await harness.trigger('AUDIO_START');
      await expect
        .poll(
          async () =>
            (await harness.events()).filter((event) => event.type === 'VAD_SPEECH_END').length,
          {
            timeout: 20_000,
          },
        )
        .toBe(1);
      const end = (await harness.events()).find((event) => event.type === 'VAD_SPEECH_END');
      expect(end?.durationMs).toBeGreaterThan(1200);
      expect(end?.durationMs).toBeLessThan(2200);
    } finally {
      await harness.context.close();
    }
  });

  test('redemption-600 keeps a 400 ms gap in one utterance', async () => {
    const harness = await launch(fixture('two-utterances-2.4s.wav'));
    try {
      await harness.trigger('AUDIO_START');
      await expect
        .poll(
          async () =>
            (await harness.events()).filter((event) => event.type === 'VAD_SPEECH_END').length,
          {
            timeout: 20_000,
          },
        )
        .toBe(1);
    } finally {
      await harness.context.close();
    }
  });

  test('misfire ignores a 100 ms burst', async () => {
    const harness = await launch(fixture('burst-0.1s.wav'));
    try {
      await harness.trigger('AUDIO_START');
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const events = await harness.events();
      expect(events.filter((event) => event.type === 'VAD_SPEECH_END')).toHaveLength(0);
    } finally {
      await harness.context.close();
    }
  });

  test('noise-ignored produces no transcripts', async () => {
    const harness = await launch(fixture('silence-1s.wav'));
    try {
      await harness.trigger('AUDIO_START');
      await new Promise((resolve) => setTimeout(resolve, 4000));
      expect(
        (await harness.events()).filter((event) => event.type === 'VAD_SPEECH_END'),
      ).toHaveLength(0);
    } finally {
      await harness.context.close();
    }
  });

  test('stop-releases-mic', async () => {
    const harness = await launch(fixture('speech-1.8s.wav'));
    try {
      await harness.trigger('AUDIO_START');
      await harness.trigger('AUDIO_STOP');
      const state = await harness.offscreen.evaluate(() => {
        const audio = (
          globalThis as unknown as { __vfeAudio?: { controller: { debugState: () => unknown } } }
        ).__vfeAudio;
        return audio?.controller.debugState();
      });
      expect(state).toMatchObject({ listening: false });
      const tracks = (state as { tracks?: string[] }).tracks ?? [];
      expect(tracks.every((readyState) => readyState === 'ended')).toBe(true);
    } finally {
      await harness.context.close();
    }
  });
});
