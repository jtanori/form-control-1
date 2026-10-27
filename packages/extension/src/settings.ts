import { z } from 'zod';

export const DEFAULT_EDGE_URL = 'http://localhost:8788';

export const SettingsSchema = z.object({
  edgeUrl: z.string().url().default(DEFAULT_EDGE_URL),
  sttLanguage: z.string().min(2).max(10).default('en'),
  ttsVoiceUri: z.string().nullable().default(null),
  ttsRate: z.number().min(0.5).max(2).default(1.02),
  speakConfirmations: z.boolean().default(true),
  listenAfterSpeaking: z.boolean().default(true),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

export interface SettingsStorage {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

const SETTINGS_KEY = 'vfeSettings';

/** Parse defensively: a corrupt object must never break the extension. */
export function parseSettings(raw: unknown): Settings {
  const parsed = SettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
}

export async function loadSettings(storage?: SettingsStorage): Promise<Settings> {
  const store = storage ?? chrome.storage.sync;
  try {
    const result = await store.get(SETTINGS_KEY);
    return parseSettings(result[SETTINGS_KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(
  patch: Partial<Settings>,
  storage?: SettingsStorage,
): Promise<Settings> {
  const store = storage ?? chrome.storage.sync;
  const current = await loadSettings(store);
  const next = parseSettings({ ...current, ...patch });
  await store.set({ [SETTINGS_KEY]: next });
  return next;
}
