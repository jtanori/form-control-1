import { EdgeSession } from '../audio/session';
import { configureStt, transcribe } from '../audio/stt';
import { summariseActions } from '../loop/history';
import {
  parseLoopMessage,
  type AssistantMessage,
  type LoopToWorker,
  type TtsMessage,
} from '../messaging';
import { requestBrain } from '../net/brain';
import { loadSettings, type Settings } from '../settings';

import { registerCommands } from './commands';
import { LoopStore } from './loop-store';
import { OffscreenManager } from './offscreen-manager';
import { runCommand } from './pipeline';
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

const loopStore = new LoopStore(chrome.storage.session);

async function sendToTab(tabId: number, message: unknown): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // The tab navigated or closed mid-loop: never throw into the pipeline.
  }
}

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ?? null;
}

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
    const tabId = await activeTabId();
    if (tabId === null) return;
    const armed = await loopStore.get(tabId);
    // No armed loop in that tab: the utterance belongs to nobody.
    if (!armed) return;
    const generation = armed.generation;

    await sendToTab(tabId, { type: 'LOOP_TRANSCRIBING', generation });

    const { settings, session } = await initialise();
    const outcome = await runCommand(
      {
        transcribe: (audio) =>
          transcribe(audio, {
            language: settings.sttLanguage,
            onMetrics: (metrics) => {
              void broadcastAssistant({ type: 'STT_METRICS', ...metrics });
            },
          }),
        brain: (request, options) =>
          requestBrain(
            request,
            { session, edgeUrl: settings.edgeUrl },
            options.signal ? { signal: options.signal } : {},
          ),
      },
      { audio: event.audio, pageState: armed.pageState, history: armed.history },
    );

    if (!outcome.ok) {
      await sendToTab(tabId, {
        type: 'LOOP_ERROR',
        generation,
        code: outcome.code,
        message: outcome.message,
      });
      return;
    }

    await loopStore.appendTurn(tabId, 'user', outcome.transcript);
    await sendToTab(tabId, { type: 'LOOP_TRANSCRIPT', generation, transcript: outcome.transcript });
    await sendToTab(tabId, {
      type: 'LOOP_BRAIN_RESULT',
      generation,
      response: outcome.response.brainResponse,
    });
    await loopStore.appendTurn(
      tabId,
      'assistant',
      summariseActions(outcome.response.brainResponse),
    );
  },
  onOpenSettings: async () => {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
      return { ok: true };
    } catch {
      return { ok: false, error: 'OPEN_SETTINGS_FAILED' };
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

/** Loop messages from a tab: arm the generation, keep the page state fresh. */
async function handleLoopMessage(
  message: LoopToWorker,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean; error?: string }> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return { ok: false, error: 'NO_TAB' };
  switch (message.type) {
    case 'LOOP_ARMED':
      await loopStore.arm(tabId, message.generation, message.pageState);
      return { ok: true };
    case 'PAGE_STATE_UPDATED':
      await loopStore.updatePageState(tabId, message.generation, message.pageState);
      return { ok: true };
    case 'LOOP_CANCELLED':
      await loopStore.clear(tabId);
      return { ok: true };
    case 'EXECUTION_REPORT':
      await loopStore.appendTurn(
        tabId,
        'assistant',
        message.ok
          ? `applied ${message.total} action(s)`
          : `applied ${message.total - message.failedLabels.length} of ${message.total} action(s); failed: ${message.failedLabels.join(', ')}`,
      );
      return { ok: true };
    default:
      return { ok: false, error: 'UNKNOWN_MESSAGE' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const loop = parseLoopMessage(message);
  if (loop.ok && sender.id === chrome.runtime.id) {
    void handleLoopMessage(loop.value as LoopToWorker, sender).then(sendResponse);
    return true;
  }
  void router.handleMessage(message, sender).then(sendResponse);
  return true;
});

// A navigated tab starts a fresh page: drop the armed generation. The content
// script is declarative, so it re-injects itself and re-arms on next activation.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') void loopStore.clear(tabId);
});

registerCommands(chrome.commands, () => {
  void router.toggle();
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({ extensionVersion: EXTENSION_VERSION });
});
