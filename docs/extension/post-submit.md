# Post-submit validation & recovery (INT-2)

A form that rejects the user is the normal case, not the edge case. This layer
closes the loop: after a submit-ish click it works out what actually happened,
says it in plain language, and puts the cursor where the user can fix it — then
keeps listening so the fix can be spoken.

```text
packages/extension/src/loop/
├── submit.ts    # outcome detection, observation window, spoken copy, CAPTCHA probes
├── machine.ts   # post_submit state, SUBMIT_OUTCOME / SUBMIT_BLOCKED transitions
└── driver.ts    # captures the pre-submit snapshot, observes, focuses, remembers
```

## Detection

Trigger: the executed batch contained a `CLICK` whose label (or id) matches
`/submit|continue|next|sign ?in|log ?in|pay|place order|save|send/i`.

`classifySubmitOutcome(prev, snapshot)` is a pure diff, checked in this order:

| Priority | Signal                                                                                            | Outcome                                            |
| -------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1        | document replaced (`pagehide`/navigation)                                                         | `NAVIGATED`                                        |
| 2        | `urlOrAppTitle` changed                                                                           | `NAVIGATED_SPA`                                    |
| 3        | a field gained a **new** `validationError`                                                        | `FIELD_ERRORS`                                     |
| 4        | new `globalErrors` entries                                                                        | `GLOBAL_ERRORS`                                    |
| 5        | alert/banner/heading matching thank/success/confirmed/order/received/submitted/signed in/complete | `SUCCESS` (+ order number when one is unambiguous) |
| 6        | new controls appeared                                                                             | `FORM_CHANGED` (verification-code steps)           |
| 7        | the form disappeared                                                                              | `SUCCESS`                                          |
| 8        | nothing at all                                                                                    | `UNKNOWN_SILENT`                                   |

`observeSubmit()` samples the page every 100 ms for up to 2000 ms and returns on
the first decisive signal, so a validation message that paints at 900 ms is
still caught, and a silent page costs at most two seconds.

## Reactions

| Outcome                              | State                        | Voice                                                | Follow-up                                                                                      |
| ------------------------------------ | ---------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `SUCCESS`                            | idle                         | "Submitted. Order number looks like 4412."           | history cleared                                                                                |
| `FIELD_ERRORS`                       | listening                    | up to 2 errors + "and N more", ≤140 chars            | `focus` + red badge flash on the first invalid field, repair context remembered, auto-relisten |
| `GLOBAL_ERRORS` (actionable)         | error                        | the message                                          | repair context remembered, auto-relisten                                                       |
| `GLOBAL_ERRORS` (server/maintenance) | error                        | the message                                          | **no** auto-relisten                                                                           |
| `FORM_CHANGED`                       | listening                    | "The form needs one more thing: …"                   | auto-relisten                                                                                  |
| `NAVIGATED` / `NAVIGATED_SPA`        | idle                         | nothing                                              | INT-1 re-initialises on the new page                                                           |
| `UNKNOWN_SILENT`                     | error (`SUBMIT_UNCONFIRMED`) | "I clicked submit but I'm not sure it went through." | hint "Check the page"                                                                          |

## Guard rails

- **CAPTCHA**: `detectCaptcha(document)` probes `iframe[src*=recaptcha]`,
  `iframe[src*=hcaptcha]`, `[data-sitekey]`, `#g-recaptcha` and
  `[class*=captcha]` _before_ the batch runs. A hit dispatches `SUBMIT_BLOCKED`
  and no click is ever dispatched.
- **Three attempts**: the driver counts submits per page and resets on success
  (`clearHistory`) and on navigation; the fourth attempt is refused with
  "I've tried three times; this form may need a human."
- **Never silently retry**: every repair path re-enters `listening`; nothing
  submits again without a new utterance.

## Spoken copy rules

`sanitiseSpeech()` enforces them in one place:

- one sentence, ≤ 140 characters;
- URLs become "the link on screen", markup and emoji are stripped, `*!` noise
  removed;
- field labels are read, never ids or selectors, and truncated at 48 chars;
- field **values** never enter speech or history — `FIELD_ERRORS` carries only
  `{ id, label, message }` from the distilled state (passwords are already
  `<redacted>` by A-3).

## Repair loop

`FIELD_ERRORS` and actionable `GLOBAL_ERRORS` emit a `remember` effect; the
content script forwards it as `LOOP_CONTEXT` and the service worker appends it
as an assistant turn:

```text
assistant: The form could not submit. Password: must be at least 8 characters.
```

The next utterance ("use a longer password") reaches the brain with a page state
that already carries `validationError` strings, so the model repairs precisely
without extra prompting.

## Tests

| File                       | Covers                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/submit.test.ts`      | every outcome (navigation, SPA route, field errors, previously-existing errors ignored, global errors, success + order number, form growth, silent no-op), observation timing (fast, slow at 900 ms, timeout), spoken copy (2 + "and N more", ≤140 chars, no secrets, URL/emoji stripping), labelled submit detection, order-number extraction, actionable vs server errors, CAPTCHA selectors |
| `test/post-submit.test.ts` | `executing → post_submit`, attempt cap, each `SUBMIT_OUTCOME` transition and its effects, CAPTCHA block                                                                                                                                                                                                                                                                                        |
| `test/loop-driver.test.ts` | end-to-end driver paths: observe → success, CAPTCHA blocks execution, field errors re-listen with `LOOP_CONTEXT`                                                                                                                                                                                                                                                                               |

## Deliberate gaps

- The Playwright repair round trip needs the testbed dev server plus a mocked
  edge; the reducer, detector and driver are covered by unit tests instead.
- Reading errors from images/OCR and solving CAPTCHAs are explicit non-goals.
