import { distillPage, executeActions, watchPage } from '@vfe/dom-engine';

import { createLoopDriver } from '../loop/driver';
import { AssistantMessageSchema, parseAudioEvent } from '../messaging';

import { mountBadges } from './badges/mount';
import { mountHud, type HudEvent } from './hud/mount';

const hud = mountHud({
  onEvent: (event: HudEvent) => {
    switch (event.type) {
      case 'hud:toggle':
        loop.activate();
        break;
      case 'hud:stop':
        loop.stop();
        break;
      case 'hud:retry':
      case 'hud:relisten':
        loop.activate();
        break;
      case 'hud:openSettings':
        void chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' });
        break;
    }
  },
});

const badges = mountBadges();

/** One message channel to the service worker; a dead tab must never throw. */
function send(message: unknown): Promise<unknown> | void {
  try {
    return chrome.runtime.sendMessage(message);
  } catch {
    return undefined;
  }
}

const loop = createLoopDriver({
  hud,
  badges,
  distill: () => distillPage({ maxElements: 250 }),
  send,
  execute: (actions, options) => executeActions(actions, options),
  speak: (text) => send({ type: 'TTS_SPEAK', text }),
  stopSpeaking: () => {
    void send({ type: 'TTS_STOP' });
  },
  labelOf: (targetId) => {
    const el = document.querySelector(`[data-vfe-id="${targetId}"]`);
    return (
      el?.getAttribute('aria-label') ??
      el?.closest('label')?.textContent?.trim() ??
      el?.getAttribute('name') ??
      undefined
    );
  },
});

/** Badges follow the page; the driver keeps the worker's copy fresh. */
function startBadgeSync(): void {
  badges.sync(distillPage());
  watchPage((change) => {
    const generation = loop.getGeneration();
    badges.sync(change.pageState);
    if (generation > 0) {
      void send({ type: 'PAGE_STATE_UPDATED', generation, pageState: change.pageState });
    }
  }).start();
}

const idleCallback =
  (globalThis as unknown as { requestIdleCallback?: (callback: () => void) => void })
    .requestIdleCallback ?? ((callback: () => void) => setTimeout(callback, 200));

idleCallback(startBadgeSync);

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id !== chrome.runtime.id) return;

  // The driver owns status and errors for the loop messages.
  if (loop.handleMessage(message)) return;

  const audio = parseAudioEvent(message);
  if (audio.ok && audio.value.type === 'AUDIO_ERROR') {
    loop.handleAudioError(audio.value.code, audio.value.message);
    return;
  }

  const assistant = AssistantMessageSchema.safeParse(message);
  if (assistant.success && assistant.data.type === 'TRANSCRIPT_ERROR') {
    hud.setMessage(assistant.data.message, 'error');
  }
});

// A page that unloads mid-loop must not leave a zombie generation behind.
globalThis.addEventListener('pagehide', () => {
  void send({ type: 'LOOP_CANCELLED', generation: loop.getGeneration() });
  loop.destroy();
});
