import { parseAudioEvent, type AudioEvent } from './messaging';
import { loadSettings, saveSettings, type Settings } from './settings';

function element<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

const button = element<HTMLButtonElement>('enable');
const micStatus = element('micStatus');
const saveStatus = element('saveStatus');
const language = element<HTMLSelectElement>('language');
const voice = element<HTMLSelectElement>('voice');
const rate = element<HTMLInputElement>('rate');
const edgeUrl = element<HTMLInputElement>('edgeUrl');
const speakConfirmations = element<HTMLInputElement>('speakConfirmations');
const listenAfterSpeaking = element<HTMLInputElement>('listenAfterSpeaking');

function setStatus(
  node: HTMLElement | null,
  text: string,
  tone: 'idle' | 'ok' | 'error' = 'idle',
): void {
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

const LANGUAGES = [
  ['en', 'English'],
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['es-MX', 'Español (México)'],
  ['fr-FR', 'Français'],
  ['de-DE', 'Deutsch'],
];

function renderVoices(selected: string | null): void {
  if (!voice) return;
  const voices = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : [];
  voice.replaceChildren();
  const fallback = document.createElement('option');
  fallback.value = '';
  fallback.textContent = 'System default';
  voice.append(fallback);
  for (const item of voices) {
    const option = document.createElement('option');
    option.value = item.voiceURI;
    option.textContent = `${item.name} (${item.lang})${item.localService ? '' : ' — network'}`;
    voice.append(option);
  }
  voice.value = selected ?? '';
}

function render(settings: Settings): void {
  if (language) {
    const entries = LANGUAGES.some(([value]) => value === settings.sttLanguage)
      ? LANGUAGES
      : [...LANGUAGES, [settings.sttLanguage, settings.sttLanguage] as const];
    language.replaceChildren(
      ...entries.map(([value, label]) => {
        const option = document.createElement('option');
        option.value = value ?? 'en';
        option.textContent = label ?? value ?? 'en';
        return option;
      }),
    );
    language.value = settings.sttLanguage;
  }
  renderVoices(settings.ttsVoiceUri);
  if (rate) rate.value = String(settings.ttsRate);
  if (edgeUrl) edgeUrl.value = settings.edgeUrl;
  if (speakConfirmations) speakConfirmations.checked = settings.speakConfirmations;
  if (listenAfterSpeaking) listenAfterSpeaking.checked = settings.listenAfterSpeaking;
}

async function persist(patch: Partial<Settings>): Promise<void> {
  try {
    const next = await saveSettings(patch);
    render(next);
    setStatus(saveStatus, 'Saved.', 'ok');
  } catch {
    setStatus(saveStatus, 'Could not save settings.', 'error');
  }
}

function bindSettings(): void {
  language?.addEventListener('change', () => void persist({ sttLanguage: language.value }));
  voice?.addEventListener('change', () => void persist({ ttsVoiceUri: voice.value || null }));
  rate?.addEventListener('change', () => void persist({ ttsRate: Number(rate.value) }));
  edgeUrl?.addEventListener('change', () => void persist({ edgeUrl: edgeUrl.value }));
  speakConfirmations?.addEventListener(
    'change',
    () => void persist({ speakConfirmations: speakConfirmations.checked }),
  );
  listenAfterSpeaking?.addEventListener(
    'change',
    () => void persist({ listenAfterSpeaking: listenAfterSpeaking.checked }),
  );
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.addEventListener('voiceschanged', () => {
      void loadSettings().then((settings) => renderVoices(settings.ttsVoiceUri));
    });
  }
}

async function enableMicrophone(): Promise<void> {
  if (!button) return;
  button.disabled = true;
  setStatus(micStatus, 'Requesting microphone…');

  const ready = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve(false);
    }, 15_000);
    const listener = (message: unknown): void => {
      const parsed = parseAudioEvent(message);
      if (!parsed.ok) return;
      const event = parsed.value as AudioEvent;
      if (event.type === 'AUDIO_READY') {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        resolve(true);
      }
      if (event.type === 'AUDIO_ERROR') {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        setStatus(micStatus, event.message, 'error');
        resolve(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  });

  await chrome.runtime.sendMessage({ type: 'AUDIO_START' });
  const granted = await ready;
  await chrome.runtime.sendMessage({ type: 'AUDIO_STOP' });
  if (granted) {
    await chrome.storage.local.set({ micEnabled: true });
    setStatus(micStatus, 'Microphone ready — press Alt+V on any form.', 'ok');
  } else {
    await chrome.storage.local.set({ micEnabled: false });
    setStatus(micStatus, 'Microphone access was not granted.', 'error');
  }
  button.disabled = false;
}

button?.addEventListener('click', () => {
  void enableMicrophone();
});

bindSettings();

void loadSettings().then((settings) => {
  render(settings);
  void chrome.storage.local.get('micEnabled').then(({ micEnabled }) => {
    if (micEnabled) setStatus(micStatus, 'Microphone enabled — press Alt+V on any form.', 'ok');
    else setStatus(micStatus, 'Microphone is off.');
  });
});
