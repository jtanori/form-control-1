# Execution semantics (B-3)

`executeActions(actions, options)` is the only entry point INT-1 uses to touch
the page. Its ten rules, in plain language:

1. **Resolve late.** `targetId`s are resolved when the action runs, never up
   front — an SPA can re-render between two fills.
2. **Clarification wins.** `ASK_CLARIFICATION` is never dispatched to a
   handler. Actions before it run, then the queue stops and reports
   `CLARIFICATION_REQUESTED`.
3. **Submit clicks end the queue.** A click on a submit-like control
   (`type=submit` or text matching submit/continue/next/pay/sign in/log in/save)
   is followed by `POSSIBLE_NAVIGATION` and no further action runs: the page is
   about to navigate.
4. **Retry only transients.** `ELEMENT_NOT_FOUND` and `TIMEOUT` retry once
   (default) after 150 ms with a fresh resolution. `VALUE_MISMATCH`,
   `VALUE_INVALID`, `OPTION_NOT_FOUND` and `ELEMENT_DISABLED` need a different
   value from the Brain, so they never retry.
5. **Timeouts never cancel DOM work.** A timed-out handler keeps working in the
   background; the queue records `TIMEOUT` and moves on.
6. **Strictly sequential.** Actions are awaited one at a time. Parallel fills on
   a controlled form corrupt framework state.
7. **No module state.** Re-running the same batch is safe and redoes the work
   (INT-2 relies on this).
8. **Never throws for DOM failures.** Every action yields an `ActionResult`.
   Only a non-array input throws a `TypeError`, synchronously.
9. **Cancellation is explicit.** An `AbortSignal` check happens before each
   action; remaining actions are reported as `ABORTED` so the HUD can say
   "cancelled" instead of freezing.
10. **Quiet logging.** The report exposes a value-free `trace`
    (`index`, `action`, `ok`, `code`, `durationMs`). Passwords and form values
    never appear in logs.

Between actions the queue waits `stepDelayMs` (100 ms default) so the user can
watch the form fill itself; `SCROLL` is exempt and `settleMs` can be raised on
slow-validating sites.

Two concurrent `executeActions` calls are serialised through a module-level
promise chain, so DOM writes from different batches can never interleave.
