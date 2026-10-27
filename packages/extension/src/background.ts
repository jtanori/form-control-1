import { EXTENSION_VERSION } from './index';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({ extensionVersion: EXTENSION_VERSION });
});
