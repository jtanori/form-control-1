# Architecture

> Status: MVP (Phase 0–3) · Protocol version `1.0.0` · Owner: Lead Architect

This document holds the architectural decisions that the backlog depends on. Each ADR is short on purpose: the _why_ matters more than the _how_ (the _how_ lives in the tickets).

---

## System overview

```text
┌──────────────────────────── BROWSER (Chrome MV3) ────────────────────────────┐
│                                                                              │
│  ┌─────────────┐   chrome.runtime    ┌──────────────────┐   network           │
│  │ OFFSCREEN   │◄──── messages ─────►│ SERVICE WORKER   │◄──────────┐        │
│  │ DOCUMENT    │                     │ • session/token  │           │        │
│  │ • MicVAD    │                     │ • conversation   │           │        │
│  │ • STT call  │                     │   history        │           │        │
│  │ • TTS       │                     │ • HTTP to edge   │           │        │
│  └─────────────┘                     └────────┬─────────┘           │        │
│                                               │                     │        │
│                                     chrome.tabs.sendMessage         │        │
│                                               ▼                     │        │
│  ┌──────────────────────── CONTENT SCRIPT (per tab) ─────────────┐  │        │
│  │ EYES  distillPage()  ── PageState (zod) ──┐                   │  │        │
│  │ HANDS executeActions(Action[]) ◄──────────┼── BrainResponse    │  │        │
│  │ HUD   shadow-DOM pill + number badges     │                   │  │        │
│  └───────────────────────────────────────────┴───────────────────┘  │        │
└─────────────────────────────────────────────────────────────────────┼────────┘
                                                                      │
                                          HTTPS (Bearer session token)│
                                                                      ▼
┌───────────────────────────── EDGE PROXY (C-3) ───────────────────────────────┐
│ CORS allowlist · auth · rate limit · request hygiene · key custody           │
└───────────┬──────────────────────────────────────────────┬───────────────────┘
            │                                              │
            ▼                                              ▼
   ┌─────────────────┐                          ┌──────────────────────┐
   │ BRAIN (C-1)     │                          │ STT provider         │
   │ Hono + zod      │                          │ Groq Whisper /       │
   │ Structured      │                          │ Deepgram Nova-2      │
   │ Outputs         │                          │                      │
   └─────────────────┘                          └──────────────────────┘
```

**Key invariant:** `@vfe/dom-engine` is pure DOM logic with no knowledge of the extension, HTTP, audio, or the LLM. It must remain usable by a future desktop shell (Electron/Tauri webview) or a mobile WebView unchanged.

---

## ADR-001 — pnpm workspace + Turborepo monorepo

**Decision.** Five packages (`protocol`, `brain`, `dom-engine`, `extension`, `testbed`) in one pnpm workspace driven by Turborepo, with a shared `tsconfig.base.json`.

**Why.** Five parallel tracks must not fight over build config or `package.json` at the root. Turborepo gives remote-less caching (fast CI), correct topological builds (`dependsOn: ["^build"]`), and per-package task isolation.

**Consequences.** Root scripts are the only supported entry points (`pnpm build|test|lint|typecheck`). Package versions are pinned; upgrades go through an ADR.

---

## ADR-002 — Protocol-first, zod v3, structured-outputs-safe

**Decision.** `@vfe/protocol` is written **first** and frozen; all tracks import types from it. Schemas are plain zod object schemas (no `transform`, `preprocess`, `coerce` on wire types) so they can be converted to JSON Schema for OpenAI Structured Outputs.

**Why.** The LLM's output must be _the_ `ActionSchema`. Deriving the model's response format from the same schema that the executor validates eliminates an entire class of "the model said something we can't execute" bugs.

**Consequences.** zod stays on v3 (v4 changes the OpenAI helper contract). Any transform-shaped normalisation happens in the Brain, never in the schema.

---

## ADR-003 — Universal contract, browser-first delivery

**Decision.** Phase 1 ships a Chrome extension; the protocol, the Brain and the DOM engine stay platform-agnostic so Desktop/Mobile clients can reuse them (`clientContext.client` is an enum, not a constant).

**Why.** Fastest path to a usable product without painting the architecture into a corner.

**Consequences.** No browser-only primitives in `@vfe/protocol` or `@vfe/brain`. DOM-specific concepts (`data-vfe-id`) live in `@vfe/dom-engine` only.

---

## ADR-004 — Audio capture in an offscreen document

**Decision.** Microphone access lives in a `chrome.offscreen` document (`USER_MEDIA` reason), not in the content script and never in the service worker (which has no `navigator.mediaDevices`).

**Why.** A content-script mic grant is bound to the _page's origin_ — a permission prompt on every site. The extension origin grants once, for every tab. The service worker cannot hold a stream at all.

**Consequences.** Offscreen document lifecycle must be managed (single-flight creation, idle close). Audio never leaves memory except as a WAV upload through the edge proxy.

---

## ADR-005 — No provider credentials in the extension

**Decision.** All provider keys (OpenAI/Anthropic/Groq/Deepgram) live server-side behind the edge proxy (C-3). The extension ships with **zero** secrets and authenticates with a short-lived session token.

**Why.** An unpacked MV3 extension is fully readable by anyone who installs it; any embedded key is public. CORS/`Origin` allowlisting and rate limiting also need a server-side chokepoint.

**Consequences.** C-3 exists in the MVP (the blueprint left it unspecified). CI grep-blocks key material in `packages/extension`. `MOCK_STT` / `MOCK_LLM` keep local development key-free.

---

## ADR-006 — Shadow DOM isolation, `mode: 'open'`

**Decision.** HUD and badges mount into fixed-position custom elements with their own shadow root, hand-written scoped CSS (no Tailwind in the content script), `z-index: 2147483647`, and `:host { all: initial }`. Shadow roots are **open**, not closed.

**Why.** Host pages regularly ship `* { all: unset !important }` or global button styles; the HUD must survive. Open mode keeps the injected UI testable by Playwright and inspectable by the team; isolation comes from scoping, not from secrecy.

**Consequences.** All untrusted text rendered via `textContent` (XSS rule enforced by lint/grep). HUD must remount if the host clears `document.body`.

---

## ADR-007 — Two-tier testing: jsdom for logic, Playwright for layout

**Decision.** Unit tests run in Vitest (jsdom) with a shared `mockLayout()` helper. Anything that depends on real layout, events with coordinates, shadow DOM, portals, or performance runs in Playwright against the testbed.

**Why.** jsdom returns `0×0` from `getBoundingClientRect()` and has no `PointerEvent` semantics, so a visibility/pointer test in jsdom is a false green. Conversely, Playwright is too slow for label-heuristic tables.

**Consequences.** Every ticket that touches layout specifies both tiers. CI runs headless Chromium only.

---

## ADR-008 — Brain output is validated twice, and targets are guarded

**Decision.** The model always answers through Structured Outputs (`zodResponseFormat`). The Brain then (a) parses with `BrainResponseSchema`, and (b) verifies every `targetId` exists in the request's `pageState`, repairing once then failing with `422 UNKNOWN_TARGET`.

**Why.** Schema validity does not imply semantic validity: a hallucinated `vfe_999` is schema-valid and unexecutable. Guarding server-side keeps the extension simple and makes the failure observable in evals.

**Consequences.** C-2 evals include a fabricated-target scenario that must fail closed.

---

## ADR-009 — Explicit state machine with a generation guard

**Decision.** The orchestration loop (INT-1) is a reducer over a discriminated union state, with a monotonic `generation` counter that invalidates in-flight async work on new activations and `Esc`.

**Why.** Voice UIs generate interleaved events (late VAD callbacks, slow STT, impatient re-activation). Ad-hoc booleans produce double pipelines and stuck HUDs; a generation guard makes "stale event" a first-class, testable outcome.

**Consequences.** Every content ↔ SW message carries `generation`; stale continuations are dropped and logged, never executed.

---

## ADR-010 — Protocol change policy

**Decision.** Within `1.x`, changes are additive only (new optional fields, new union members appended). Breaking changes bump the major version and require a migration note. Clients send `clientContext.protocolVersion`; the Brain rejects mismatched majors with `409`.

**Why.** Five tracks depending on one contract need a stability promise, otherwise the "parallel tracks" model collapses into a merge queue.

**Consequences.** `packages/protocol/fixtures/*.json` are golden samples; editing one requires updating all consumers in the same PR.

---

## Threat model (MVP)

| Threat                                                                                   | Mitigation                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection from page content (a page contains text "ignore previous instructions") | The model only sees serialised, structured field data (labels/placeholders truncated); `targetId` is validated server-side; the model cannot pick arbitrary selectors. Backlog: strip instruction-like text from labels (post-MVP). |
| Exfiltration of form data                                                                | Only the distilled `PageState` leaves the page, and password values are redacted in A-3. No full DOM dumps, no keystroke logging.                                                                                                   |
| Credential theft from the extension bundle                                               | ADR-005: no keys in the extension.                                                                                                                                                                                                  |
| Malicious site fingerprinting the extension                                              | `data-vfe-*` attributes are visible to the page by design (the DOM engine needs them); document it. Optional randomisation is a Phase-2 hardening item.                                                                             |
| Automatic actions on destructive buttons                                                 | The Brain may only `CLICK` a target that exists in the page state; submit-clicks are gated by user intent in the prompt and by INT-2's attempt cap.                                                                                 |
| Audio retention                                                                          | In-memory only; never persisted (D-1 privacy requirements).                                                                                                                                                                         |

---

## Open questions / Phase-2 candidates

1. Same-origin iframe support (`all_frames` + per-frame distillation) — ticket `A-4` candidate.
2. Streaming STT for sub-200 ms perceived latency.
3. Prompt-injection hardening: a sanitiser that strips imperative text from labels before sending.
4. Optional-permission model to replace `<all_urls>`.
5. Desktop shell reusing `@vfe/dom-engine` + `@vfe/protocol` (Electron/Tauri).
6. "Undo last command" in the HUD.
