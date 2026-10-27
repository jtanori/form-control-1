# Changelog

All notable changes to this project are documented here. The format loosely
follows Keep a Changelog; the project is pre-1.0 and ships from `main`.

## Unreleased

### Added

- **Monorepo foundation (P0-1):** pnpm workspaces + Turborepo, shared
  TypeScript/Vitest/ESLint/Prettier configuration, `mockLayout()` test helper,
  CI (lint, format, typecheck, build, unit + browser tests).
- **Frozen protocol 1.0.0 (P0-2):** `@vfe/protocol` with zod schemas and
  inferred types for page state, actions, brain responses, request/response
  envelopes, agent status and action results; golden fixtures; typed
  `ProtocolError` parsing helpers.
- **The Eyes (A-1):** shadow-DOM-aware discovery of interactive elements with
  visibility filtering, `data-vfe-*` annotations, modal scoping, hidden-control
  label proxies and a 250-element cap.
- **Labels, groups and errors (A-2):** accessible-name waterfall with
  provenance, fieldset/legend and heading-based group resolution, visible-only
  validation messages and required-state detection.
- **Page snapshot & watcher (A-3):** `distillPage()` serialises a protocol
  `PageState` (password redaction, options, boolean values) and
  `watchPage()` debounces mutations with id re-adoption.
- **The Hands (B-1/B-2):** framework-bypassing fill/clear with native setters
  and composed events, value normalisation, option matching waterfall, ARIA
  combobox handling, idempotent checkboxes, pointer-sequence clicks, focus and
  scrolling.
- **Action queue (B-3):** `executeActions()` with late resolution, transient-only
  retries, per-action timeouts, abort support, clarification short-circuit and a
  submit-navigation guard.
- **Brain service (C-1):** `POST /api/process-command` on Hono with OpenAI
  Structured Outputs (Groq/Anthropic adapters), versioned system prompt, one
  repair retry, unknown-target guard, LRU + idempotency caches, structured
  logs, `MOCK_LLM=1` zero-key mode and a 51-test suite.
- **Brain eval suite (C-2):** 20 recorded scenarios covering every documented
  edge case, a label-based assertion engine (multiset, ordering, spoken surface,
  fabricated-target and password-leak guards), mock/live/record CLI modes, cost
  guard, committed baseline, nightly workflow and Markdown/JSON reports.
- **Edge proxy & key custody (C-3):** a second Hono entrypoint on `:8788` that
  brokers all provider access: extension-id session tokens (HMAC, 24 h),
  origin allowlist/CORS, fail-closed configuration, per-token rate and
  concurrency limits, 5 MB/512 KB body caps, schema and protocol validation
  before forwarding, header scrubbing, typed upstream errors, `MOCK_STT=1`
  and zero provider keys in the extension.
- **MV3 audio capture (D-1):** offscreen document hosting Silero v5 VAD,
  single-flight document lifecycle, popup permission flow, `Alt+V`, a pure
  16 kHz PCM16 WAV encoder, linear resampler, 30 s utterance cap with a
  parallel PCM collector, 60 s silence auto-stop, 250 ms TTS mute tail, and a
  message router that rejects audio from content scripts.
- **STT & TTS client (D-2):** session-token STT through the edge proxy with
  bounded retries, timeout/abort-supersede semantics, deterministic noise and
  hallucination filtering, privacy-safe metrics; chunked offscreen
  `speechSynthesis` with locale-aware voice selection, 250 ms VAD mute tail,
  cancellation and `<redacted>` stripping; zod-validated sync settings and a
  popup settings UI.
- **Shadow-DOM HUD (E-1):** an isolated bottom-centre status pill rendered in an
  open shadow root on `<html>` — six states, live transcript preview, execution
  progress, keyboard and screen-reader support, reduced-motion and
  light/dark handling, fixed-bar and focused-input collision avoidance, a capped
  remount guard and a 3.9 KB gzip budget. Content scripts are lint- and
  CI-forbidden from assigning HTML strings.
- **Numbered badge overlay (E-2):** a shadow-DOM overlay that numbers every
  discovered control with a single node per `vfeId`; id-diffed `sync()` with a
  zero-write idle path, read/write-split positioning on one shared rAF, 250-badge
  cap, flash states driven by action results, viewport clamping, scroll/resize/
  accordion following and a Playwright glue-and-frame-rate suite.
