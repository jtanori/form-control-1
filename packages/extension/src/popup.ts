import { parseAudioEvent, type AudioEvent } from './messaging';

const button = document.getElementById('enable') as HTMLButtonElement | null;
const status = document.getElementById('status');

function setStatus(text: string, tone: 'idle' | 'ok' | 'error' = 'idle'): void {
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;
}

/**
 * The permission prompt must appear in a UI the user expects. We start the
 * offscreen stream, wait for AUDIO_READY, persist the preference and stop.
 */
async function enableMicrophone(): Promise<void> {
  if (!button) return;
  button.disabled = true;
  setStatus('Requesting microphone…');

  const done = new Promise<boolean>((resolve) => {
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
        setStatus(event.message, 'error');
        resolve(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  });

  await chrome.runtime.sendMessage({ type: 'AUDIO_START' });
  const ready = await done;
  await chrome.runtime.sendMessage({ type: 'AUDIO_STOP' });
  if (ready) {
    await chrome.storage.local.set({ micEnabled: true });
    setStatus('Microphone ready — press Alt+V on any form.', 'ok');
  } else {
    await chrome.storage.local.set({ micEnabled: false });
    setStatus('Microphone access was not granted.', 'error');
  }
  button.disabled = false;
}

button?.addEventListener('click', () => {
  void enableMicrophone();
});

void chrome.storage.local.get('micEnabled').then(({ micEnabled }) => {
  if (micEnabled) setStatus('Microphone enabled — press Alt+V on any form.', 'ok');
  else setStatus('Microphone is off.');
});
