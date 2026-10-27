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

- `background.ts` — MV3 service worker, message router, offscreen lifecycle
- `content.ts` — content script (HUD, badges, DOM bridge)
- `offscreen.ts` — microphone capture + VAD in an offscreen document
- `public/manifest.json` — permissions, commands (`Alt+V`), content scripts
