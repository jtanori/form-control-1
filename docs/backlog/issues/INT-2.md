<!-- AUTO-GENERATED from docs/backlog/tickets/INT-2.md. Do not edit this issue by hand. -->
<!-- Edit the ticket file, then run: node scripts/backlog.mjs sync --apply -->

> **Ticket `INT-2`** · Phase 2 — System Integration & Orchestration · 🔌 Integration & Orchestration · priority `p0` · estimate `8h (L)`

|                   |                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Phase**         | Integration (sequential)                                                                                             |
| **Track**         | 🔌 Integration & Orchestration                                                                                       |
| **Owner role**    | Lead Architect                                                                                                       |
| **Estimate**      | 8 h (L)                                                                                                              |
| **Parallel-safe** | ⚠️ no — coordinate merges                                                                                            |
| **Source**        | [`docs/backlog/tickets/INT-2.md`](https://github.com/jtanori/form-control-1/blob/main/docs/backlog/tickets/INT-2.md) |

<!-- vfe:metadata v1 INT-2 -->

### Metadata (labels & milestone)

**Milestone:** `Phase 2 — System Integration & Orchestration`  
**Priority:** `p0` · **Type:** `feature` · **Estimate:** `8h (L)` · **Owner:** Lead Architect

| Label                 | Meaning                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `phase:2-integration` | Phase 2 — System integration & orchestration                                                 |
| `track:integration`   | Cross-track integration & orchestration                                                      |
| `type:feature`        | New user-facing capability                                                                   |
| `area:extension`      | @vfe/extension — Chrome MV3 client                                                           |
| `area:integration`    | Wiring across packages                                                                       |
| `priority:p0`         | Blocks the MVP release                                                                       |
| `agent-ready`         | Fully specified: algorithms, acceptance criteria, test plan — safe to hand to a coding agent |
| `backlog`             | Part of the MVP backlog (auto-applied by scripts/backlog.mjs)                                |

```json
{
  "ticket": "INT-2",
  "title": "Post-Submit Validation & Error Recovery Loop — self-healing forms",
  "phase": "phase-2",
  "milestone": "Phase 2 — System Integration & Orchestration",
  "labels": [
    "phase:2-integration",
    "track:integration",
    "type:feature",
    "area:extension",
    "area:integration",
    "priority:p0",
    "agent-ready",
    "backlog"
  ],
  "priority": "p0",
  "type": "feature",
  "track": "integration",
  "ownerRole": "Lead Architect",
  "estimateHours": 8,
  "estimate": "L",
  "parallelSafe": false,
  "blockedBy": ["INT-1"],
  "blocks": ["QA-1"],
  "githubIssue": 17
}
```

### Dependencies

**Blocked by:**

- [ ] #16 — Master Control Loop — content script + background orchestrator wiring all five pillars

**Unblocks:**

- #18 — Form Torture Testbed — 5 hostile form patterns for E2E proof

---

## Summary

Forms reject. Passwords are too short, emails lack a domain, ZIP codes don't match the state, CAPTCHAs appear, and the "success" page is sometimes a silent no-op. This ticket makes the loop **closed**: after a submit click, detect what happened, speak the real reason in plain language, and put the cursor where the user needs it — then keep the conversation going so the user can fix it by voice.

This is the difference between a demo and something a person would actually use.

## Behaviour specification

Trigger: `B-3` executed an action whose target is submit-ish (`type=submit`, label matching `/submit|continue|next|sign ?in|log ?in|pay|place order|save|send/i`) **or** the Brain's `spokenFeedback`/transcript indicated submission.

### 1. Detect what happened (500 ms + adaptive wait)

```ts
async function observeSubmitOutcome(prev: PageState, tabId: number): Promise<SubmitOutcome> {
  // wait for either: navigation, DOM change, or timeout
  await Promise.race([waitForNavigation(tabId, 4000), waitForMutationSettled(800), sleep(500)]);
  const next = distillPage({ maxElements: 250 });
  ...
}
```

Signals, in priority order:

| Signal                       | Detection                                                                                        | Outcome                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Full navigation              | `pagehide`/`beforeunload` fired, or `chrome.tabs.onUpdated` `status: 'complete'`                 | `NAVIGATED` (INT-1 re-initialises; stop here)         |
| SPA route change             | `history.pushState`/`replaceState` patched, or `popstate`, or `location.pathname` changed        | `NAVIGATED_SPA` → re-distill, `NAVIGATED`             |
| New field-level errors       | diff `prev` vs `next`: any element whose `validationError` went `undefined → string`, or changed | `FIELD_ERRORS`                                        |
| New global errors            | `next.globalErrors` contains strings not in `prev.globalErrors`                                  | `GLOBAL_ERRORS`                                       |
| New fields/elements appeared | `added.length > 0` and the form is still present                                                 | `FORM_CHANGED` (e.g. "enter the code we emailed you") |
| Success markers              | `[role=alert]`/heading/banner matching `/thank                                                   | success                                               | confirmed | order (number | #)  | received | submitted | signed in/i`; form removed/disappeared | `SUCCESS` |
| Nothing observable           | no changes and no errors                                                                         | `UNKNOWN_SILENT`                                      |

`SubmitOutcome` is a discriminated union carrying the data each case needs.

### 2. React to each outcome

| Outcome                       | HUD                                          | Voice (TTS)                                                                                           | Follow-up                                                                                                       |
| ----------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `SUCCESS`                     | ✅ green check, "Submitted" for 3 s → idle   | "Submitted. Order number looks like 4412." (only if a number is detectable)                           | clear conversation history, re-distill                                                                          |
| `FIELD_ERRORS`                | error state + list of up to 3 field messages | "The form couldn't submit: Password must be at least 8 characters." (join up to 2, then "and 1 more") | `FOCUS` the first invalid field (B-2) + badge flash red; **auto-relisten** so the user can say "make it longer" |
| `GLOBAL_ERRORS`               | error state with the global message          | speak the first global error verbatim                                                                 | do **not** auto-relisten if the error is non-actionable (e.g. "server error", "try later")                      |
| `FORM_CHANGED`                | thinking → badges resync                     | "The form needs one more thing: <label of the first new field>."                                      | auto-relisten                                                                                                   |
| `NAVIGATED` / `NAVIGATED_SPA` | idle (INT-1 owns re-init)                    | nothing (avoid talking over a new page)                                                               | reset generation; INT-1 re-badges                                                                               |
| `UNKNOWN_SILENT`              | warning state                                | "I clicked submit but I'm not sure it went through." + `showHint` "Check the page"                    | offer Retry / ask the user                                                                                      |

### 3. Error → repair loop (the closed loop)

After speaking field errors and focusing the first invalid field, the loop returns to `LISTENING` with this context retained in `conversationHistory`:

```ts
{ role: 'assistant', text: 'The form could not submit. Password: must be at least 8 characters.', at: now }
```

The next user utterance ("use a longer password") goes to the Brain with a `pageState` that **already contains** `validationError` strings (A-2 reads them), so the model can repair precisely. This is why A-2's error resolution matters so much — no extra prompting needed, the state carries the truth.

Guard rails:

- **Max 3 submit attempts per page** (counter in the SW, reset on navigation). After 3, stop submitting and tell the user: "I've tried three times; this form may need a human."
- Never retry a submit automatically without listening again (silent retry loops are a CAPTCHA/rate-limit hazard).
- Detect CAPTCHAs (`[class*=captcha]`, `iframe[src*=recaptcha|hcaptcha]`, `[data-sitekey]`, `#g-recaptcha`) **before** submitting: if present and unsolved, block submission and say "There's a CAPTCHA on this form — you'll need to solve that part."
- Detect password manager overlays / "confirm you are human" interstitials → `GLOBAL_ERRORS` path with non-actionable copy.

### 4. Spoken copy rules

- One sentence, ≤ 140 chars, no field ids, no HTML, no quotes around labels unless needed.
- Read the **field label + message**, not the selector: "Email: enter a valid email address."
- Never read a password value; if the error is about a password, say "Password: must be at least 8 characters."
- If more than 2 errors, read 2 and say "and N more" — then the HUD lists all of them.
- Localise punctuation for TTS: strip `*`, `!`, emoji, and URLs (`https://…` → "the link on screen").

### 5. Focus & visual guidance

- `FOCUS` the first invalid field (in document order of `next.elements` with a `validationError`), which scrolls it into view (`B-2`).
- Badge for that field flashes **red** (E-2 `flash(id, 'error')`) for 1.5 s.
- HUD `error` state lists up to 3 errors with their labels (truncated at 48 chars).

## State additions to INT-1's reducer

```ts
type LoopState = ... | {
  kind: 'post_submit';
  outcome: SubmitOutcome;
  attempted: number;            // 1..3
  prev: PageState;
};
```

Transitions:

- `executing → post_submit` when a submit-ish `CLICK` succeeded.
- `post_submit → listening` (field errors, form changed) with history injected.
- `post_submit → idle` (success, navigation).
- `post_submit → error` (unknown silent, captcha, 3 attempts exhausted).

## Test plan

### Unit (jsdom + scripted DOM mutations)

| Test                     | Assertion                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `success-banner`         | `<div role="alert">Thank you! Order #4412</div>` appears → `SUCCESS`, spoken text contains `4412`, history cleared |
| `field-error-diff`       | input gains `.invalid-feedback` text → `FIELD_ERRORS`, focus goes to that input, badge flashes error               |
| `multiple-errors`        | 3 errors → speaks 2 + "and 1 more"                                                                                 |
| `global-error`           | page-level alert "Server error" → `GLOBAL_ERRORS`, no auto-relisten                                                |
| `form-grew`              | new `<input>` appears (email code) → `FORM_CHANGED`, speaks the new label, auto-relisten                           |
| `silent-noop`            | nothing changes → `UNKNOWN_SILENT` with the "not sure it went through" copy                                        |
| `captcha-block`          | reCAPTCHA iframe present → submission blocked, no `CLICK` dispatched                                               |
| `attempt-cap`            | 3 failed submits → state `error`, 4th submit not attempted                                                         |
| `password-not-spoken`    | password field error → spoken text has no secret and no field value                                                |
| `url-stripping`          | error containing `https://x.y/z` → spoken as "the link on screen"                                                  |
| `navigation-during-wait` | `pagehide` fires → `NAVIGATED`, no further DOM reads                                                               |
| `slow-validation`        | errors appear after 900 ms → still detected (adaptive wait)                                                        |

### Integration (Playwright + mocked C-3)

| Test                     | Assertion                                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repair-round-trip`      | testbed "password too short" → error spoken → mock transcript "use a longer password" → Brain returns a `FILL` with a 12-char password → submit succeeds → `SUCCESS` |
| `wizard-advance`         | submit "Next" on a 3-step wizard → `NAVIGATED_SPA` → step 2 badges appear automatically                                                                              |
| `success-then-next-form` | multi-form page → success on form 1, user moves to form 2 with a new voice command                                                                                   |

## Acceptance criteria

- [ ] Submitting an invalid form triggers automatic voice feedback explaining which field failed validation (with the field's label).
- [ ] The first invalid field is focused and its badge flashes red.
- [ ] Success is detected and announced, and conversation history is cleared.
- [ ] A user can repair the error by voice without touching the keyboard (proved by the `repair-round-trip` integration test).
- [ ] Silent no-ops and server errors are reported honestly, not as success.
- [ ] Navigation (full page or SPA) is detected within 500 ms and never leaves the HUD stuck.
- [ ] CAPTCHA presence blocks auto-submission.
- [ ] Max 3 submit attempts enforced per page.
- [ ] No secret ever appears in spoken or HUD text (grep-based test on all TTS strings).
- [ ] Spoken error text is ≤ 140 chars and strips URLs/emoji/markup.

## Non-goals

- Solving CAPTCHAs (explicitly blocked).
- Retry logic for server-side 5xx beyond surfacing the error.
- Undo of submitted data.
- Reading errors from images/OCR.

## Definition of done

- All 6 `SubmitOutcome` variants are visible in a debug panel (dev builds only) for manual QA.
- `docs/extension/post-submit.md` documents the detection signals, the repair loop, and the guard rails.
- Recorded demo of a failed submit → spoken error → voice repair → success.
- PR title: `[INT-2] Post-submit validation & recovery`.

## References

- Blueprint §PHASE 2 / INT-2
- A-2 supplies `validationError`; B-2 `FOCUS`/`CLICK`; D-2 `speak`; E-1/E-2 states; INT-1 reducer.

---

### Live status

- [ ] Design reviewed by another track owner
- [ ] Implementation complete
- [ ] Unit tests green + coverage gate met
- [ ] Browser/E2E tests green (where applicable)
- [ ] Docs updated
- [ ] Acceptance criteria all checked

_Generated by `scripts/backlog.mjs`. Source of truth: `docs/backlog/tickets/INT-2.md`._
