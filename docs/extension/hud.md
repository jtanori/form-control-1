# The HUD

A single floating pill that tells the user what the assistant is doing. It lives
in **every** page the assistant can act on, so it must survive hostile CSS,
never disturb the host page, and stay usable with a keyboard or a screen reader.

Source: `packages/extension/src/content/hud/`.

```text
mount.ts        mountHud / destroyHud — host element, remount guard, listeners
controller.ts   HudController — status machine, events, accessible copy
templates.ts    per-state DOM builders; all copy lives in COPY
styles.ts       one exported CSS string, scoped inside the shadow root
collision.ts    pure position heuristics (no DOM reads at call sites)
icons.ts        inline SVG (`<svg>` built with `createElementNS`)
```

The content script entry (`src/content/index.ts`) owns the message glue: it maps
`LISTENING_STATE`, `VAD_SPEECH_START`, `VAD_SPEECH_END`, `AUDIO_ERROR`,
`TRANSCRIPT_READY`, `TRANSCRIPT_ERROR` and `STT_METRICS` onto the controller and
forwards HUD intents back to the service worker. The HUD itself never talks to
the brain, the DOM engine or the network — it renders status and emits events.

## Isolation strategy

| Risk                               | Mitigation                                                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host `* { all: unset !important }` | Every style lives in a `<style>` inside an **open shadow root**; host page selectors cannot cross the boundary. `:host { all: initial }` resets inherited values. |
| HUD CSS leaking onto the page      | There are no global selectors and no `@import`; the only host-level styles are the eight inline properties set in `mount.ts`.                                     |
| Z-index wars                       | Host element uses `z-index: 2147483647`, `position: fixed`, and `pointer-events: none`; only the pill re-enables pointer events.                                  |
| Page wipes `<body>`                | The host is appended to `<html>`, not `<body>`, and a `MutationObserver` re-attaches it — capped at **3 remounts per minute** so a hostile loop cannot spin.      |
| Double injection                   | `mountHud()` is idempotent (returns the live controller), and the `vfe-hud` custom element is registered defensively.                                             |
| Fullscreen                         | Documented limitation: the HUD is invisible inside `element.requestFullscreen()` and inside cross-origin iframes.                                                 |

`mode: 'open'` is deliberate. Isolation comes from scoping, not from secrecy, and
an open root keeps the Playwright isolation suite and assistive technology
working. The trade-off is recorded here because it is a decision, not an
oversight.

## States

| State        | Pill                                           | Copy                   | Extra                                                                                         |
| ------------ | ---------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| `idle`       | 44 px circle, mic glyph                        | `Ready`                | `Alt+V` hint on hover/focus                                                                   |
| `listening`  | expands to 320 px, 5-bar waveform              | `Listening…`           | live transcript preview (`aria-hidden`)                                                       |
| `thinking`   | CSS spinner (static dots under reduced motion) | `Mapping actions…`     | —                                                                                             |
| `executing`  | thin progress bar                              | `Filling 2 of 3…`      | driven by `setActionsProgress`                                                                |
| `clarifying` | accent border                                  | `Clarification needed` | the brain's question as the message                                                           |
| `error`      | red border                                     | `Something went wrong` | retry affordance; `Microphone blocked` + `Grant microphone access` when permission was denied |

`prefers-color-scheme` swaps the glass tokens (dark `rgba(20,20,24,.88)` /
light `rgba(255,255,255,.95)`); text stays above 4.5:1 in both schemes.
`prefers-reduced-motion` disables the waveform and spinner animations. The
waveform animates `transform`/`opacity` only, so it stays on the compositor.

There is no drag-to-reposition and no settings panel inside the pill (the popup
owns settings); both are explicit non-goals.

Screenshots: the six states are rendered by
`pnpm --filter @vfe/extension test:e2e:hud` in headless Chromium. Capturing PNGs
is left to the release job — the isolation suite asserts geometry and computed
styles, which is what regressions actually break.

## Interaction

| Gesture                                               | Emitted event      | Notes                                                     |
| ----------------------------------------------------- | ------------------ | --------------------------------------------------------- |
| `Alt+V` (background command → tab) / click while idle | `hud:toggle`       | content script turns it into `AUDIO_START` / `AUDIO_STOP` |
| Click or `Esc` while listening                        | `hud:stop`         | `Esc` is bound on `document` while mounted                |
| Click while clarifying                                | `hud:relisten`     | INT-1 keeps the question in transcript context            |
| Click while in error                                  | `hud:retry`        | `hud:openSettings` instead when the microphone was denied |
| Click on "grant access"                               | `hud:openSettings` | background opens `popup.html` in a tab                    |

`OPEN_SETTINGS` is validated by `SettingsMessageSchema` and only accepted from
this extension's own runtime id.

## Accessibility

- The pill **is** a `<button type="button">` with a state-specific
  `aria-label` (`Voice form assistant: listening. Press Escape to stop.`).
- Focus ring: `:focus-visible` outline in the accent colour plus offset, so it is
  visible on any background.
- A visually hidden `role="status"` region announces state changes politely and
  switches to `aria-live="assertive"` for errors.
- The live transcript is `aria-hidden="true"` so screen readers do not
  double-announce text that TTS is already speaking.

## Position

Bottom-centre (`24px`), then:

1. a fixed bar wider than 60 vw within 40 px of the bottom that intersects the
   pill lifts it to `96px`;
2. a focused control under the pill adds another `64px`.

Both rules are pure functions in `collision.ts` (`bottomOffset`) and recomputed
at most every 500 ms on scroll/resize. The scan is capped at 1500 elements.

## Tests

| Layer        | File                       | Covers                                                                                                                                                                         |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| unit (jsdom) | `test/hud.test.ts`         | idempotent mount, six states, progress, live transcript, XSS-as-text, a11y attributes, toggle/stop/retry/relisten, `Esc`, hints, destroy residue, remount cap, collision maths |
| source guard | `test/hud-source.test.ts`  | no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write` under `src/content`                                                                                           |
| budget       | `test/hud-budget.test.ts`  | minified + gzipped HUD bundle < 20 KB                                                                                                                                          |
| browser      | `test/browser/hud.spec.ts` | host-reset immunity, no style leakage, above a `2147483646` overlay, scroll stability, reduced motion, keyboard stop                                                           |

`innerHTML` is also banned by ESLint (`no-restricted-syntax`) and by a CI grep,
because a single review miss here is an XSS in a page the user does not control.
