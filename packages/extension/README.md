# @vfe/extension

Chrome MV3 extension: the HUD, badge overlay, audio capture and the bridge to
the edge proxy.

**This extension ships with zero credentials by design.** It knows only
`VFE_EDGE_URL` and a short-lived, HMAC-signed session token stored in
`chrome.storage.local`. STT and LLM provider keys live exclusively in the edge
proxy and brain service (see `docs/brain/edge-proxy.md`). CI greps this package
for `sk-`, `GROQ_API_KEY`, `DEEPGRAM` and `OPENAI_API_KEY` and fails the build if
any appear.

## Build

```bash
pnpm --filter @vfe/extension build   # dist/ is a loadable unpacked extension
```

Contents:

- `src/background/` — MV3 service worker, message router, offscreen lifecycle,
  `Alt+V` command
- `src/content/` — content script (HUD, badges, DOM bridge); never calls
  `getUserMedia` and never sees raw audio
- `src/offscreen/` — microphone capture + Silero VAD in an offscreen document
- `src/audio/` — pure WAV encoder, resampler and PCM collector
- `src/messaging.ts` — zod-validated internal `AudioEvent`/`AudioCommand`
- `public/manifest.json` — permissions, commands (`Alt+V`), popup

## Permissions and privacy

The microphone is captured in the **offscreen document** (extension origin), so
one permission covers every site; per-origin content-script capture would prompt
on every website. Audio stays in memory, is capped at 30 seconds, and is only
routed to the service worker (STT), never to a tab. `host_permissions:
<all_urls>` is an MVP concession for automatic injection and will move to
optional permissions in Phase 2.

Speech-to-text and text-to-speech clients live in `src/audio/stt.ts` and
`src/audio/tts.ts`. They talk only to the C-3 edge proxy (session token, no
provider keys), retry within bounds, and speak from the offscreen document so TTS
keeps working while the tab is backgrounded.

The status pill is a shadow-DOM component mounted on `<html>`: host page CSS
cannot reach into it and its own styles cannot leak out. It renders six states,
the live transcript, execution progress and errors, and it is the only place the
user sees what the assistant is doing.

See [`docs/extension/hud.md`](../../docs/extension/hud.md) for the HUD,
[`docs/extension/audio-pipeline.md`](../../docs/extension/audio-pipeline.md) for
capture, [`docs/extension/stt-tts.md`](../../docs/extension/stt-tts.md) for
STT/TTS, the latency budget and Chrome workarounds.
