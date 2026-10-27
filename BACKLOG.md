# Backlog — Voice Form Engine (Zero → MVP)

> **Generated file — do not edit.** Source of truth: `docs/backlog/tickets/*.md`. Regenerate with `node scripts/backlog.mjs build`; publish to GitHub with `node scripts/backlog.mjs sync --apply`.

**18 tickets** · 18 linked to GitHub issues · 166 estimated engineer-hours.

## At a glance

| Phase   | Track                                    | Ticket                                                                                                                  | Estimate | Priority | Depends on                               | Issue                                                      |
| ------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------- | -------- | ---------------------------------------- | ---------------------------------------------------------- |
| phase-0 | 🧱 Foundation                            | **[`P0-1`](tickets/P0-1.md)** Monorepo Initialization — pnpm workspaces, Turborepo, shared TS/Vitest/ESLint config      | 4h       | p0       | —                                        | [#1](https://github.com/jtanori/form-control-1/issues/1)   |
| phase-0 | 🧱 Foundation                            | **[`P0-2`](tickets/P0-2.md)** Universal Protocol & Zod Schemas — the frozen cross-platform contract                     | 6h       | p0       | `P0-1`                                   | [#2](https://github.com/jtanori/form-control-1/issues/2)   |
| phase-1 | 👁️ Track A — The Eyes (DOM Distiller)    | **[`A-1`](tickets/A-1.md)** Interactive Element Discovery & Visibility Filtering (deep DOM walker)                      | 8h       | p0       | `P0-2`                                   | [#3](https://github.com/jtanori/form-control-1/issues/3)   |
| phase-1 | 👁️ Track A — The Eyes (DOM Distiller)    | **[`A-2`](tickets/A-2.md)** Heuristic Label, Group & Validation-Error Resolution Engine                                 | 12h      | p0       | `A-1`                                    | [#4](https://github.com/jtanori/form-control-1/issues/4)   |
| phase-1 | 👁️ Track A — The Eyes (DOM Distiller)    | **[`A-3`](tickets/A-3.md)** Page State Serialization & Debounced Mutation Watcher (distillPage)                         | 8h       | p0       | `A-1`, `A-2`                             | [#5](https://github.com/jtanori/form-control-1/issues/5)   |
| phase-1 | 🤚 Track B — The Hands (Action Executor) | **[`B-1`](tickets/B-1.md)** Framework-Bypassing Text & Value Injector (FILL / CLEAR)                                    | 10h      | p0       | `P0-2`                                   | [#6](https://github.com/jtanori/form-control-1/issues/6)   |
| phase-1 | 🤚 Track B — The Hands (Action Executor) | **[`B-2`](tickets/B-2.md)** Controls Handler — SELECT, SET_CHECKED, CLICK, FOCUS, SCROLL, comboboxes                    | 10h      | p0       | `P0-2`                                   | [#7](https://github.com/jtanori/form-control-1/issues/7)   |
| phase-1 | 🤚 Track B — The Hands (Action Executor) | **[`B-3`](tickets/B-3.md)** Execution Queue & Multi-Step Action Runner (executeActions)                                 | 6h       | p0       | `B-1`, `B-2`                             | [#8](https://github.com/jtanori/form-control-1/issues/8)   |
| phase-1 | 🧠 Track C — The Brain (LLM Service)     | **[`C-1`](tickets/C-1.md)** LLM Service & System Prompt Engineering — POST /api/process-command with Structured Outputs | 10h      | p0       | `P0-2`                                   | [#9](https://github.com/jtanori/form-control-1/issues/9)   |
| phase-1 | 🧠 Track C — The Brain (LLM Service)     | **[`C-2`](tickets/C-2.md)** Prompt Evaluation & Edge-Case Test Suite (15 recorded scenarios, CI-gated)                  | 8h       | p0       | `C-1`                                    | [#10](https://github.com/jtanori/form-control-1/issues/10) |
| phase-1 | 🧠 Track C — The Brain (LLM Service)     | **[`C-3`](tickets/C-3.md)** Edge Proxy & Key Custody — CORS/Origin allowlist, token brokering, quota (added ticket)     | 6h       | p1       | `P0-2`                                   | [#11](https://github.com/jtanori/form-control-1/issues/11) |
| phase-1 | 👂 Track D — The Ears (Audio & STT)      | **[`D-1`](tickets/D-1.md)** Chrome MV3 Audio Capture & Voice Activity Detection (VAD)                                   | 10h      | p0       | `P0-1`                                   | [#12](https://github.com/jtanori/form-control-1/issues/12) |
| phase-1 | 👂 Track D — The Ears (Audio & STT)      | **[`D-2`](tickets/D-2.md)** Low-Latency STT & TTS Feedback Client (audio → transcript → speech)                         | 8h       | p0       | `D-1`, `C-3`                             | [#13](https://github.com/jtanori/form-control-1/issues/13) |
| phase-1 | 🖥️ Track E — The HUD (Visual Overlay)    | **[`E-1`](tickets/E-1.md)** Shadow-DOM Isolated Status Bar — the floating HUD pill                                      | 8h       | p0       | `P0-2`                                   | [#14](https://github.com/jtanori/form-control-1/issues/14) |
| phase-1 | 🖥️ Track E — The HUD (Visual Overlay)    | **[`E-2`](tickets/E-2.md)** Dynamic Number Badge Overlay — [1], [2], [3] locked to their inputs at 60fps                | 8h       | p0       | `E-1`                                    | [#15](https://github.com/jtanori/form-control-1/issues/15) |
| phase-2 | 🔌 Integration & Orchestration           | **[`INT-1`](tickets/INT-1.md)** Master Control Loop — content script + background orchestrator wiring all five pillars  | 16h      | p0       | `A-3`, `B-3`, `C-1`, `C-3`, `D-2`, `E-2` | [#16](https://github.com/jtanori/form-control-1/issues/16) |
| phase-2 | 🔌 Integration & Orchestration           | **[`INT-2`](tickets/INT-2.md)** Post-Submit Validation & Error Recovery Loop — self-healing forms                       | 8h       | p0       | `INT-1`                                  | [#17](https://github.com/jtanori/form-control-1/issues/17) |
| phase-3 | 🧪 QA & Testbed                          | **[`QA-1`](tickets/QA-1.md)** Form Torture Testbed — 5 hostile form patterns for E2E proof                              | 20h      | p0       | `P0-1`                                   | [#18](https://github.com/jtanori/form-control-1/issues/18) |

## Execution summary

```text
PHASE 0 (sequential, blocks everything)
  P0-1 → P0-2 ─────────────────────────────► protocol frozen

PHASE 1 (5 tracks in parallel, independent branches)
  Track A  A-1 → A-2 → A-3        DOM distiller
  Track B  B-1 ─┬→ B-3            action executor
               B-2 ┘
  Track C  C-1 → C-2              LLM brain
           C-3 (edge proxy, parallel)
  Track D  D-1 → D-2              audio & STT
  Track E  E-1 → E-2              HUD & badges
  QA       QA-1 (starts on day 1) testbed

PHASE 2 (sequential integration)
  INT-1 → INT-2

PHASE 3 (verification)
  QA-1 acceptance: 5 hostile forms, 100% voice
```

## Phase 0 — Foundation & Universal Contract

_Blocks every other track. Lock the monorepo and the protocol._

| Ticket                    | Title                                                                                | Type    | Est. | Owner          | Parallel |
| ------------------------- | ------------------------------------------------------------------------------------ | ------- | ---- | -------------- | -------- |
| [`P0-1`](tickets/P0-1.md) | Monorepo Initialization — pnpm workspaces, Turborepo, shared TS/Vitest/ESLint config | chore   | 4h   | Lead Architect | —        |
| [`P0-2`](tickets/P0-2.md) | Universal Protocol & Zod Schemas — the frozen cross-platform contract                | feature | 6h   | Lead Architect | —        |

## Phase 1 — Parallel Component Tracks

_Five independent tracks coding against the frozen protocol._

| Ticket                  | Title                                                                                       | Type    | Est. | Owner                       | Parallel |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------- | ---- | --------------------------- | -------- |
| [`A-1`](tickets/A-1.md) | Interactive Element Discovery & Visibility Filtering (deep DOM walker)                      | feature | 8h   | DOM Engineer                | ✅       |
| [`A-2`](tickets/A-2.md) | Heuristic Label, Group & Validation-Error Resolution Engine                                 | feature | 12h  | DOM Engineer                | ✅       |
| [`A-3`](tickets/A-3.md) | Page State Serialization & Debounced Mutation Watcher (distillPage)                         | feature | 8h   | DOM Engineer                | ✅       |
| [`B-1`](tickets/B-1.md) | Framework-Bypassing Text & Value Injector (FILL / CLEAR)                                    | feature | 10h  | DOM Engineer                | ✅       |
| [`B-2`](tickets/B-2.md) | Controls Handler — SELECT, SET_CHECKED, CLICK, FOCUS, SCROLL, comboboxes                    | feature | 10h  | DOM Engineer                | ✅       |
| [`B-3`](tickets/B-3.md) | Execution Queue & Multi-Step Action Runner (executeActions)                                 | feature | 6h   | DOM Engineer                | ✅       |
| [`C-1`](tickets/C-1.md) | LLM Service & System Prompt Engineering — POST /api/process-command with Structured Outputs | feature | 10h  | Backend/AI Engineer         | ✅       |
| [`C-2`](tickets/C-2.md) | Prompt Evaluation & Edge-Case Test Suite (15 recorded scenarios, CI-gated)                  | test    | 8h   | Backend/AI Engineer         | ✅       |
| [`C-3`](tickets/C-3.md) | Edge Proxy & Key Custody — CORS/Origin allowlist, token brokering, quota (added ticket)     | feature | 6h   | Backend/AI Engineer         | ✅       |
| [`D-1`](tickets/D-1.md) | Chrome MV3 Audio Capture & Voice Activity Detection (VAD)                                   | feature | 10h  | Extension Engineer          | ✅       |
| [`D-2`](tickets/D-2.md) | Low-Latency STT & TTS Feedback Client (audio → transcript → speech)                         | feature | 8h   | Extension Engineer          | ✅       |
| [`E-1`](tickets/E-1.md) | Shadow-DOM Isolated Status Bar — the floating HUD pill                                      | feature | 8h   | Frontend/Extension Engineer | ✅       |
| [`E-2`](tickets/E-2.md) | Dynamic Number Badge Overlay — [1], [2], [3] locked to their inputs at 60fps                | feature | 8h   | Frontend/Extension Engineer | ✅       |

## Phase 2 — System Integration & Orchestration

_Wire the pillars into one voice-to-form loop._

| Ticket                      | Title                                                                                  | Type    | Est. | Owner          | Parallel |
| --------------------------- | -------------------------------------------------------------------------------------- | ------- | ---- | -------------- | -------- |
| [`INT-1`](tickets/INT-1.md) | Master Control Loop — content script + background orchestrator wiring all five pillars | feature | 16h  | Lead Architect | —        |
| [`INT-2`](tickets/INT-2.md) | Post-Submit Validation & Error Recovery Loop — self-healing forms                      | feature | 8h   | Lead Architect | —        |

## Phase 3 — QA & Synthetic Torture Testbed

_Hostile forms that prove the engine is universal._

| Ticket                    | Title                                                        | Type    | Est. | Owner                | Parallel |
| ------------------------- | ------------------------------------------------------------ | ------- | ---- | -------------------- | -------- |
| [`QA-1`](tickets/QA-1.md) | Form Torture Testbed — 5 hostile form patterns for E2E proof | feature | 20h  | QA/Frontend Engineer | ✅       |

## Conventions

- Branch per ticket: `feat/<ticket-id>-<slug>` (e.g. `feat/b-1-value-injector`). PR title: `[B-1] Value injector`.
- Every ticket is **agent-ready**: exact algorithms, acceptance criteria, test plan, non-goals.
- Definition of Ready: dependencies merged, protocol contract unchanged, fixtures exist.
- Definition of Done: acceptance criteria checked + tests green + docs updated + issue closed by the PR (`Closes #N`).
- Cross-track changes to `@vfe/protocol` are **additive only** (see `docs/architecture.md` → ADR-010).
