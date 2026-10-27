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
