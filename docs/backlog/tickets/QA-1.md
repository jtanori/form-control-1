---
github_issue: 18
id: QA-1
title: 'Form Torture Testbed — 5 hostile form patterns for E2E proof'
phase: 3
track: qa
type: feature
priority: p0
estimate: XL
estimate_hours: 20
owner_role: QA/Frontend Engineer
labels: [phase:3-qa, track:qa, type:feature, area:testbed, area:e2e, priority:p0, agent-ready]
milestone: phase-3
blocked_by: [P0-1]
blocks: []
parallel_safe: true
---

## Summary

A single-page React + Vite app that hosts five deliberately difficult form patterns plus a stress harness — the proving ground for A–E and the fixture source for Playwright tests and Brain evals. It must be buildable on **day 1** (only depends on P0-1) so it can grow in parallel with the engine.

Each form must record and expose its state so automated tests can assert what the engine actually did (no screenshot diffing, no pixel guessing).

## Routes

| Route                    | Form                                                                                           | Why it's hard                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `/`                      | Index with links + a "how to run E2E" panel                                                    | Developer entry point                                                                        |
| `/react-controlled`      | Strict controlled inputs, email validation, password + confirmation, submit dumps JSON         | React's value tracker defeats naive value setting (B-1)                                      |
| `/ambiguous-twins`       | Side-by-side "Billing Address" and "Shipping Address" with identical labels (Street/City/Zip)  | Forces `ASK_CLARIFICATION` (C-1 rule 6) and correct `groupLabel` (A-2)                       |
| `/unlabelled`            | Zero `<label>` tags: placeholder-only, visual proximity text, `name`-only inputs               | Label waterfall steps 5–6 (A-2)                                                              |
| `/custom-ui`             | Radix UI Select, Radix Checkbox, Radix Dialog, react-day-picker date input, a MUI Autocomplete | `pointerdown` listeners, portals, `role=combobox` with options rendered only when open (B-2) |
| `/wizard`                | 3-step form; step 1 unmounts on "Next", step 2 mounts fresh; back button works                 | SPA node replacement, id re-adoption (A-3), watcher (A-3)                                    |
| `/validation`            | Server-simulated errors (async, 400 ms), global banner, password rules, CAPTCHA toggle         | INT-2 all six outcomes                                                                       |
| `/stress`                | 500 inputs in a virtualised-ish grid, 3 shadow-DOM hosts, 1 open + 1 closed shadow root        | A-1 performance budget, E-2 60fps, maxElements cap                                           |
| `/hostile-css`           | `* { all: unset !important }`, aggressive `z-index`, fixed bottom bar, RTL section             | E-1/E-2 isolation                                                                            |
| `/redirect-after-submit` | Real navigation after submit (full page load) to `/thank-you`                                  | INT-1 navigation handling                                                                    |

## Required technical features

### 1. State exposure (the testing contract)

Every form exposes its live state to automation **without** touching internals:

```html
<pre id="state-dump" hidden>{ "firstName": "Alice", "email": "a@b.co", "submitted": true }</pre>
```

- `data-testid="state-dump"` + a `window.__TESTBED__ = { getState(), getSubmits(), reset() }` hook.
- Every submit appends to `window.__TESTBED__.submits` — the E2E suite asserts exactly how many submits happened and with what payload.
- Each form has `data-testid="form-<name>"` and stable `name` attributes on every input so Playwright fallbacks are possible.

### 2. Deterministic behaviour

- No external network calls, no analytics, no fonts from CDN, no random values except seeded ones.
- Async validation is `setTimeout`-driven with a configurable delay (`?validationDelay=400` query param, default 400).
- Server-simulated errors driven by the submitted payload (e.g. email containing `+reject` → 422 with a field error) so tests are self-contained.
- `?noise=1` enables a MutationObserver churn loop (a 60fps ticking clock in the header) to prove the watcher's debounce doesn't melt.

### 3. Real UI libraries (not imitations)

- **Radix UI** (`@radix-ui/react-select`, `react-checkbox`, `react-dialog`) — the pointerdown-sensitive family.
- **MUI** (`@mui/material` Autocomplete) — the portal + typeahead family.
- **react-day-picker** for a date popover (extra credit; the `type=date` native input covers the base case).
- Tailwind for layout only (testbed is not style-testing).

### 4. Accessibility fixtures for A-2

Include, in at least two places: `aria-labelledby` chains, `aria-describedby` + `aria-invalid` errors, fieldset/legend radiogroups, an `aria-label` that intentionally conflicts with visible text (to prove precedence), and a hidden honeypot input (`style="display:none"`, plus one `position:absolute;left:-9999px`).

### 5. E2E hooks

- `pnpm --filter @vfe/testbed dev` serves on `:5173` with `--host 0.0.0.0` (needed for the sandbox preview) and allows the Arena preview origin.
- `pnpm --filter @vfe/testbed serve` serves the production build for Playwright (stable, no HMR).
- A `/healthz` static endpoint (or a dummy route) for test readiness.
- A README table mapping each route → which ticket it validates.

## Test plan for the testbed itself

| Test                | Assertion                                                                   |
| ------------------- | --------------------------------------------------------------------------- |
| `routes-render`     | Vitest + Testing Library renders every route without errors                 |
| `state-dump-live`   | Typing into the controlled form updates `#state-dump`                       |
| `submit-recording`  | Submitting pushes exactly one entry into `window.__TESTBED__.submits`       |
| `focus-order`       | Tab order is sensible on every form (a11y sanity)                           |
| `no-console-errors` | Rendering + one interaction per route produces zero console errors/warnings |
| `deterministic`     | Two runs of the wizard with the same inputs yield identical state dumps     |

## Acceptance criteria

- [ ] All 10 routes exist, are reachable, and have no console errors.
- [ ] The 5 mandatory forms from the blueprint exist with the specified difficulty characteristics: React controlled, ambiguous twins, unlabelled, custom UI library, multi-step wizard.
- [ ] Radix select/dialog and MUI Autocomplete are **genuinely** used (imported from the libraries, not hand-rolled).
- [ ] Every form exposes `data-testid="state-dump"` and `window.__TESTBED__`.
- [ ] Submit events are recorded with payloads for assertion.
- [ ] Async validation delay is configurable and defaults to 400 ms.
- [ ] `/stress` renders 500 inputs + 3 shadow hosts and stays interactive.
- [ ] `/hostile-css` breaks naive injected UIs (this is the point) without breaking the page itself.
- [ ] `pnpm --filter @vfe/testbed build` succeeds and `serve` runs the production build.
- [ ] The integrated extension (`INT-2`) can complete **all 5 mandatory forms start to finish using 100% voice commands** without touching mouse or keyboard — this is the project's headline acceptance test.
- [ ] The README documents, per route, the ticket it validates and the exact voice command script to complete it (used by the E2E suite and by manual QA).

## Non-goals

- Beautiful design (functional clarity > aesthetics).
- Backend persistence — everything is in-memory; `?redirect-after-submit` uses a real navigation to a static route.
- Payment/3-D Secure flows, file uploads, multi-page auth.
- Browser support beyond Chromium (the extension is Chromium-only for MVP).

## Definition of done

- Deployed nowhere (local only) but startable with one command.
- Voice scripts for all 5 forms written in the README, e.g. `/react-controlled`: _"My name is Alice Wonder, email alice at wonderland dot com, password is wonderland123, confirm it, then click Create account."_
- Fixture HTML snapshots exported to `packages/dom-engine/test/fixtures/` where the engine tests need static copies (keep the testbed as the source of truth; snapshot via a small script).
- PR title: `[QA-1] Form torture testbed`.

## References

- Blueprint §PHASE 3 / QA-1
- Consumed by A-1/B-1/B-2/E-1/E-2 Playwright suites, C-2 evals (fixtures), INT-1/INT-2 E2E.
