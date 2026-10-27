# STT & TTS client (D-2)

Everything here runs with **zero provider credentials**. The extension holds
`VFE_EDGE_URL` (settings, default `http://localhost:8788`) and a short-lived
HMAC session token from C-3 — nothing else.

## Speech-to-text

```ts
const result = await transcribe(wav, { language: settings.sttLanguage });
// { transcript, confidence?, provider, latencyMs, truncated }
```

Transport: `POST {edge}/v1/stt` as multipart (`audio`, `language`, `client`),
`Authorization: Bearer <session>`. The edge owns the Groq/Deepgram key.

### Latency budget

| Stage                                 |       Budget | Measured by           |
| ------------------------------------- | -----------: | --------------------- |
| WAV encode (D-1)                      |       < 5 ms | `encodeMs`            |
| Upload 2 s of 16 kHz mono PCM (64 KB) |     < 120 ms | `uploadMs`            |
| Provider transcription (≤ 10 s audio) |     < 250 ms | `providerMs`          |
| Parse + post-process                  |       < 5 ms | included in `totalMs` |
| **Speech end → transcript (p50)**     | **< 400 ms** | `totalMs`             |

`transcribe()` emits an `STT_METRICS` message (`encodeMs`, `uploadMs`,
`providerMs`, `totalMs`, `bytes`) to the service worker for the HUD debug panel.
It never contains transcript text.

### Retries and concurrency

- **One in-flight request.** A new utterance aborts the previous request
  (`ABORTED`) instead of queueing a backlog.
- Retries: at most one, only for `429` (honouring `Retry-After`), `5xx` and
  network errors, with a 300 ms backoff. Validation errors never retry.
- Timeout: 6 s default (`TIMEOUT`); external `AbortSignal` → `ABORTED`.
- Session: cached in `chrome.storage.local` until 60 s before expiry; a single
  401 triggers one refresh-and-retry.

### Post-processing (deterministic, no semantics)

1. Trim and collapse whitespace.
2. Empty, `[BLANK_AUDIO]`, `(silence)`, "thank you" and "you" → `EMPTY_AUDIO`.
3. Repeated ≥20-char clauses repeated three or more times collapse to one.
4. `…` suffix or > 400 chars sets `truncated: true` so INT-1 can ask a follow-up.
5. No auto-capitalisation or grammar fixing — `"john at gmail dot com"` is
   passed to the Brain untouched, because only the Brain may interpret it.

### Error codes

`UNAUTHORIZED`, `RATE_LIMITED`, `TOO_LONG`, `PROVIDER_ERROR`, `TIMEOUT`,
`NETWORK`, `EMPTY_AUDIO`, `ABORTED` — each with `retryable`. The SW turns them
into `TRANSCRIPT_ERROR { code, message }` for the HUD.

## Text-to-speech

`speak(text, options)` runs **in the offscreen document** because Chrome pauses
`window.speechSynthesis` in background tabs but not in extension pages. The
service worker forwards `TTS_SPEAK` / `TTS_STOP`; the offscreen module owns the
`SpeechSynthesis` instance.

### Chrome workarounds

1. **15 s truncation:** speech is split on sentence boundaries into ≤ 200-char
   chunks, spoken sequentially; the promise resolves after the last chunk.
2. **Background tab pause:** TTS lives in the offscreen document, not the
   content script.
3. **Late `voiceschanged`:** the voice list is read at speak time and selection
   is retried then; `localService` voices matching the locale win.
4. **Echo:** `AUDIO_MUTE` pauses the VAD before the first chunk; `AUDIO_UNMUTE`
   fires 250 ms after the last chunk (that is D-1's redemption tail).
5. **No voice installed:** resolves `{ spoken: false, reason: 'NO_VOICE' }` so
   the HUD can print the text instead of failing the loop.
6. **Redaction:** any literal `<redacted>` is stripped before speaking.

`speak()` always cancels the current utterance first, so two confirmations can
never overlap. `stopSpeaking()` cancels and unmutes immediately.

## Settings

Stored in `chrome.storage.sync` under `vfeSettings`, validated with zod:

| Setting               | Default                 |
| --------------------- | ----------------------- |
| `edgeUrl`             | `http://localhost:8788` |
| `sttLanguage`         | `en`                    |
| `ttsVoiceUri`         | `null` (system voice)   |
| `ttsRate`             | `1.02`                  |
| `speakConfirmations`  | `true`                  |
| `listenAfterSpeaking` | `true`                  |

A corrupted object falls back to defaults rather than breaking the popup.

## Testing

`pnpm --filter @vfe/extension test` covers the 13 D-2 cases: happy path, auth
refresh, 429 retry, no-retry 400, timeout, supersede, noise filter,
hallucination strip, chunking, mute/unmute timing, cancellation, no voice and
redaction — with a fake `SpeechSynthesis` and mocked fetch, all offline.
