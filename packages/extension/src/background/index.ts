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

const router = createMessageRouter({
  runtimeId: chrome.runtime.id,
  manager,
  sendToOffscreen: (command) => chrome.runtime.sendMessage(command),
  broadcast,
  // D-2 takes over here: the utterance goes to STT, never to a tab.
  onSpeechEnd: async () => undefined,
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
