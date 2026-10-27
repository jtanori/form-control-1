import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseSettings,
  saveSettings,
  type SettingsStorage,
} from '../src/settings';

function storage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const store: SettingsStorage & { data: Record<string, unknown> } = {
    data,
    get: async (key) => (typeof key === 'string' && key in data ? { [key]: data[key] } : {}),
    set: async (items) => {
      Object.assign(data, items);
    },
  };
  return store;
}

describe('settings', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await loadSettings(storage())).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults for a corrupted object', async () => {
    const store = storage({ vfeSettings: { ttsRate: 'fast', edgeUrl: 42 } });
    expect(await loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it('merges and persists a patch', async () => {
    const store = storage();
    const next = await saveSettings({ ttsRate: 1.4, sttLanguage: 'es-MX' }, store);
    expect(next.ttsRate).toBe(1.4);
    expect(next.sttLanguage).toBe('es-MX');
    expect(await loadSettings(store)).toMatchObject({ ttsRate: 1.4, sttLanguage: 'es-MX' });
  });

  it('keeps defaults for unrelated fields', () => {
    expect(parseSettings({ ttsRate: 0.9 })).toMatchObject({
      ttsRate: 0.9,
      speakConfirmations: true,
      listenAfterSpeaking: true,
      edgeUrl: 'http://localhost:8788',
    });
  });
});
