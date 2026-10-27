import { EdgeSession } from '../audio/session';
import { SttError, configureStt, transcribe } from '../audio/stt';
import type { AssistantMessage, TtsMessage } from '../messaging';
import { loadSettings, type Settings } from '../settings';

import { registerCommands } from './commands';
import { OffscreenManager } from './offscreen-manager';
import { createMessageRouter } from './router';

const EXTENSION_VERSION = '0.1.0';

const manager = new OffscreenManager({
  hasDocument: () => chrome.offscreen.hasDocument(),
  createDocument: (options) =>
    chrome.offscreen.createDocument({
      url: options.url,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: options.justification,
    }),
  closeDocument: () => chrome.offscreen.closeDocument(),
});

async function broadcast(event: unknown): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) return;
  try {
    await chrome.tabs.sendMessage(tab.id, event);
  } catch {
    // No content script in this tab (chrome:// pages, the web store, …).
  }
}

interface Initialised {
  settings: Settings;
  session: EdgeSession;
}

let initialised: Promise<Initialised> | null = null;

function initialise(): Promise<Initialised> {
  initialised ??= (async () => {
    const settings = await loadSettings();
    const session = new EdgeSession({
      edgeUrl: settings.edgeUrl,
      extensionId: chrome.runtime.id,
      storage: chrome.storage.local,
    });
    configureStt(session, settings.edgeUrl);
    return { settings, session };
  })();
  return initialised;
}

async function broadcastAssistant(message: AssistantMessage): Promise<void> {
  await broadcast(message);
}

const router = createMessageRouter({
  runtimeId: chrome.runtime.id,
  manager,
  sendToOffscreen: (command) => chrome.runtime.sendMessage(command),
  broadcast,
  onSpeechEnd: async (event) => {
    const { settings } = await initialise();
    try {
      const result = await transcribe(event.audio, {
        language: settings.sttLanguage,
        onMetrics: (metrics) => {
          void broadcastAssistant({ type: 'STT_METRICS', ...metrics });
        },
      });
      await broadcastAssistant({
        type: 'TRANSCRIPT_READY',
        transcript: result.transcript,
        latencyMs: result.latencyMs,
        truncated: result.truncated,
      });
    } catch (error) {
      await broadcastAssistant({
        type: 'TRANSCRIPT_ERROR',
        code: error instanceof SttError ? error.code : 'PROVIDER_ERROR',
        message: error instanceof Error ? error.message : 'Transcription failed',
      });
    }
  },
  onTtsMessage: async (message: TtsMessage) => {
    try {
      await manager.ensure();
      await chrome.runtime.sendMessage(message);
      return { ok: true };
    } catch {
      return { ok: false, error: 'OFFSCREEN_FAILED' };
    }
  },
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void router.handleMessage(message, sender).then(sendResponse);
  return true;
});

registerCommands(chrome.commands, () => {
  void router.toggle();
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({ extensionVersion: EXTENSION_VERSION });
});
