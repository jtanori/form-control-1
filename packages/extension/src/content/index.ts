import { AssistantMessageSchema, parseAudioEvent } from '../messaging';

import { mountHud, type HudEvent } from './hud/mount';

let listening = false;

const hud = mountHud({
  onEvent: (event: HudEvent) => {
    switch (event.type) {
      case 'hud:toggle':
        void chrome.runtime.sendMessage({ type: listening ? 'AUDIO_STOP' : 'AUDIO_START' });
        break;
      case 'hud:stop':
        void chrome.runtime.sendMessage({ type: 'AUDIO_STOP' });
        break;
      case 'hud:retry':
      case 'hud:relisten':
        void chrome.runtime.sendMessage({ type: 'AUDIO_START' });
        break;
      case 'hud:openSettings':
        void chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' });
        break;
    }
  },
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id !== chrome.runtime.id) return;

  const event = parseAudioEvent(message);
  if (event.ok) {
    switch (event.value.type) {
      case 'LISTENING_STATE':
        listening = event.value.listening;
        hud.setStatus(event.value.listening ? 'listening' : 'idle');
        break;
      case 'VAD_SPEECH_START':
        hud.setStatus('listening');
        break;
      case 'VAD_SPEECH_END':
        hud.setStatus('thinking');
        break;
      case 'AUDIO_ERROR':
        hud.setStatus('error');
        hud.setMessage(event.value.message, 'error');
        if (event.value.code === 'NOT_ALLOWED') hud.setMicPermission('denied');
        break;
      default:
        break;
    }
    return;
  }

  const assistant = AssistantMessageSchema.safeParse(message);
  if (!assistant.success) return;
  switch (assistant.data.type) {
    case 'TRANSCRIPT_READY':
      hud.setTranscript(assistant.data.transcript);
      hud.setStatus('thinking');
      break;
    case 'TRANSCRIPT_ERROR':
      hud.setStatus('error');
      hud.setMessage(assistant.data.message, 'error');
      break;
    case 'STT_METRICS':
      // Debug metrics arrive here; INT-1 renders them in the HUD debug panel.
      break;
  }
});

const HINT_DOMAIN_KEY = 'vfeHintDomains';
const SESSION_COUNT_KEY = 'vfeSessionCount';
const HINT_AFTER_SESSIONS = 3;

/**
 * Onboarding nudge: only once the user has seen the pill a few times, and only
 * once per domain, so a frequently visited site never nags twice.
 */
async function maybeShowOnboardingHint(): Promise<void> {
  if (globalThis.top !== globalThis.self) return;
  try {
    const stored = await chrome.storage.local.get([HINT_DOMAIN_KEY, SESSION_COUNT_KEY]);
    const domains = Array.isArray(stored[HINT_DOMAIN_KEY])
      ? (stored[HINT_DOMAIN_KEY] as string[])
      : [];
    const sessions =
      typeof stored[SESSION_COUNT_KEY] === 'number' ? (stored[SESSION_COUNT_KEY] as number) : 0;
    const domain = globalThis.location?.hostname ?? '';
    await chrome.storage.local.set({ [SESSION_COUNT_KEY]: sessions + 1 });
    if (!domain || sessions < HINT_AFTER_SESSIONS || domains.includes(domain)) return;
    await chrome.storage.local.set({ [HINT_DOMAIN_KEY]: [...domains, domain].slice(-50) });
    hud.showHint('Press Alt+V to talk', 4000);
  } catch {
    // Storage can be unavailable in private mode; the hint is optional.
  }
}

void maybeShowOnboardingHint();
