<!-- AUTO-GENERATED from docs/backlog/tickets/INT-1.md. Do not edit this issue by hand. -->
<!-- Edit the ticket file, then run: node scripts/backlog.mjs sync --apply -->

> **Ticket `INT-1`** · Phase 2 — System Integration & Orchestration · 🔌 Integration & Orchestration · priority `p0` · estimate `16h (XL)`

| | |
| --- | --- |
| **Phase** | Integration (sequential) |
| **Track** | 🔌 Integration & Orchestration |
| **Owner role** | Lead Architect |
| **Estimate** | 16 h (XL) |
| **Parallel-safe** | ⚠️ no — coordinate merges |
| **Source** | [`docs/backlog/tickets/INT-1.md`](https://github.com/jtanori/form-control-1/blob/main/docs/backlog/tickets/INT-1.md) |

### Dependencies

**Blocked by:**
- [ ] `A-3` — Page State Serialization & Debounced Mutation Watcher (distillPage)
- [ ] `B-3` — Execution Queue & Multi-Step Action Runner (executeActions)
- [ ] `C-1` — LLM Service & System Prompt Engineering — POST /api/process-command with Structured Outputs
- [ ] `C-3` — Edge Proxy & Key Custody — CORS/Origin allowlist, token brokering, quota (added ticket)
- [ ] `D-2` — Low-Latency STT & TTS Feedback Client (audio → transcript → speech)
- [ ] `E-2` — Dynamic Number Badge Overlay — [1], [2], [3] locked to their inputs at 60fps

**Unblocks:**
- INT-2
- QA-1

---

## Summary

Wire Eyes (A), Hands (B), Brain (C), Ears (D) and HUD (E) into one voice-to-form loop that is **state-machine explicit**, cancellable at every step, and recoverable after any failure.

This is the ticket where a lot of individually-correct components become a product — and where most of the real bugs live (races, stale page states, double activation, pages that navigate mid-loop).

## The state machine (the core deliverable)

```text
                 Alt+V / pill click
          ┌───────────────────────────────┐
          │                               ▼
       [IDLE] ◄──── error/timeout ──── [LISTENING] ──VAD_SPEECH_END──► [TRANSCRIBING]
          ▲                               │  ▲                              │
          │                          Esc/stop│                       transcript
          │                               ▼                              ▼
          │                            [IDLE]                       [THINKING]
          │                                                              │
          │                                                     BrainResponse
          │                                                              ▼
          │                                                        [EXECUTING]
          │                                                          │      │
          │                    ASK_CLARIFICATION ────────────────────┘      │
          │                               ▼                                 │
          │                        [CLARIFYING] ──user speaks──► [LISTENING] │
          │                               │                                 │
          └────────────── error ─────── [IDLE] ◄──── settle + re-distill ───┘
```

State transitions are the **only** way the UI changes (`E-1.setStatus`) and the **only** way the pipeline runs. Implement as an explicit reducer, not with ad-hoc booleans:

```ts
type LoopState =
  | { kind: 'idle' }
  | { kind: 'listening'; startedAt: number }
  | { kind: 'transcribing'; wav: ArrayBuffer }
  | { kind: 'thinking'; transcript: string; pageState: PageState }
  | { kind: 'executing'; report?: ExecutionReport; index: number; total: number }
  | { kind: 'clarifying'; question: string; priorPageState: PageState }
  | { kind: 'error'; code: LoopErrorCode; message: string; recoverable: boolean };
```

Every transition is guarded: e.g. a `VAD_SPEECH_END` arriving while `kind === 'executing'` is **ignored** (logged as `stale-event`) rather than starting a second pipeline. A `generation` counter (incremented on every new activation and on `Esc`) invalidates in-flight async work: any continuation whose `generation` no longer matches is dropped. This is the single most important pattern in this ticket.

## Message architecture

```text
popup ──(settings, mic grant)──►  service worker (single source of truth for audio+network)
                                     ▲    │
       commands (Alt+V, toggle)      │    │  chrome.runtime.sendMessage
                                     │    ▼
content script (per tab) ◄──────────►│  offscreen document (VAD + STT + TTS)
   ├── A-1/A-2/A-3  distillPage
   ├── B-1/B-2/B-3  executeActions
   └── E-1/E-2      HUD
```

- **The content script owns the DOM.** It never does network I/O.
- **The service worker owns the session, the offscreen document, and all network calls** (STT via C-3). It is ephemeral → keep state in `chrome.storage.session` (not module variables), and re-hydrate on wake.
- **The offscreen document owns audio.**
- Messages are typed and zod-validated at both ends (`packages/extension/src/messaging.ts`), with a `requestId` and `generation` in every payload; responses echo them.
- All SW → content messages use `chrome.tabs.sendMessage(tabId, …)`; the SW must handle "no receiving end" (tab closed) without throwing.

## The exact execution loop (implementation order)

```ts
// packages/extension/src/content/loop.ts
export async function runLoop(deps: { hud: HudController; badges: BadgeController }): Promise<void> {
  // 1. ACTIVATE (Alt+V command → SW → content)  ─────────────────────────────
  const gen = ++generation;

  // 2. EYES + HUD badges: distill and badge BEFORE listening (so numbers are on
  //    screen while the user speaks), and again on every state change.
  let pageState = distillPage({ maxElements: 250 });
  deps.badges.sync(pageState);
  const watcher = watchPage((change) => {
    if (gen !== generation) return;
    deps.badges.sync(change.pageState);
    pageState = change.pageState;                 // keep the freshest snapshot
    sendToSw({ type: 'PAGE_STATE_UPDATED', requestId, generation: gen, pageState });
  }, { debounceMs: 250 });

  // 3. EARS: start listening (D-1)
  setState({ kind: 'listening', startedAt: now() });
  deps.hud.setStatus('listening');
  await sendToSw({ type: 'AUDIO_START' });        // offscreen doc spins up VAD

  // 4. on VAD_SPEECH_END || AUDIO_ERROR (SW relays)
  //    → state 'transcribing'; HUD 'thinking'
  //    SW calls C-3 /v1/stt, then C-3 /v1/brain with { pageState, transcript, history }
  //    → returns ProcessCommandResponse

  // 5. THINKING (HUD 'thinking', "Mapping actions…")
  //    If the request fails: state 'error' (recoverable) → HUD error + retry

  // 6. EXECUTING (HUD 'executing' + progress)
  const report = await executeActions(brainResponse.actions, {
    stepDelayMs: 100,
    onActionStart: (a, i, n) => { deps.badges.flash(a.targetId); deps.hud.setActionsProgress(i, n); },
    onActionEnd: (r) => { deps.badges.flash(r.action.targetId, r.ok ? 'ok' : 'error'); },
    signal,                                        // tied to generation/Esc
  });

  // 7. FEEDBACK: speak spokenFeedback (D-2), never while VAD is live (TTS mutes VAD)
  if (brainResponse.spokenFeedback) await speak(brainResponse.spokenFeedback);

  // 8. SETTLE + RE-DISTILL: wait 300 ms for DOM mutations (new step, validation
  //    errors), re-distill, re-badge. Do NOT re-send to the Brain automatically.
  await sleep(300);
  pageState = distillPage({ maxElements: 250 });
  deps.badges.sync(pageState);
  sendToSw({ type: 'PAGE_STATE_UPDATED', pageState });

  // 9. CLARIFYING: if the Brain asked a question, speak it and immediately
  //    re-listen (one-shot), keeping the question in conversationHistory.
  //    Otherwise, if `report.ok` → 'idle' (listening stays off; the user
  //    presses Alt+V for the next command) unless `settings.continuous` is on.
}
```

### Loop rules (non-negotiable)

1. **Conversation history** lives in the SW (`chrome.storage.session`, max 20 turns, 10 min TTL): user transcripts + a compact summary of the assistant's actions, never raw page state.
2. **Fresh page state.** Every Brain call uses the `pageState` captured **immediately before** transcription completes — never one from 30 s ago.
3. **One pipeline at a time.** A new activation while `thinking`/`executing` **cancels** the old generation (abort `signal`, `stopSpeaking()`, `stopListening()`) and starts fresh. The HUD shows a brief "restarted" hint.
4. **Mic lifecycle.** Listening stops on `VAD_SPEECH_END` (one-shot per utterance) unless `settings.continuous` is true. If the user stays silent for 15 s, auto-stop with a HUD hint ("I didn't hear anything — press Alt+V").
5. **TTS never overlaps VAD.** `speak()` mutes VAD (D-2); if `settings.listenAfterSpeak` is on, listening resumes 400 ms after speech ends.
6. **Esc always wins.** `Esc` → abort generation, `executeActions` aborts between steps, `stopSpeaking()`, `AUDIO_STOP`, state `idle`. Test this at every state.
7. **No auto-submit.** The Brain may emit `CLICK` on a submit button only when the user asked; the loop never adds one. INT-2 handles the aftermath.
8. **Explicit failures.** Every step maps to a `LoopErrorCode` (`MIC_DENIED`, `STT_FAILED`, `BRAIN_FAILED`, `EXECUTION_PARTIAL`, `PAGE_NAVIGATED`, `TIMEOUT`, `UNKNOWN`) and the HUD shows actionable copy + a Retry affordance.
9. **Partial execution is a first-class outcome.** `report.ok === false` → speak a short summary of what failed ("I filled your name, but couldn't find the email field"), state `error` (recoverable), not `idle`.
10. **Navigation awareness.** If the page navigates during execution (submit), the content script is torn down — the SW listens to `chrome.tabs.onUpdated` and, on `status === 'complete'`, re-injects the content script (it is declarative, so it auto-loads) and pushes the new page state. Reset the `generation`. INT-2 continues from there.

### `chrome.storage.session` usage

- `{ conversationHistory, lastPageStateHash, settings, generation }`.
- `lastPageStateHash` = `sha256(JSON.stringify(pageState))` (cheap, no PII in logs) so the SW can skip Brain calls when nothing changed **and** the transcript is absent.

## Structured error taxonomy

```ts
export type LoopErrorCode =
  | 'MIC_DENIED' | 'NO_SPEECH' | 'STT_FAILED' | 'STT_TIMEOUT'
  | 'BRAIN_FAILED' | 'BRAIN_TIMEOUT' | 'INVALID_BRAIN_RESPONSE'
  | 'EXECUTION_PARTIAL' | 'ELEMENT_MISSING' | 'PAGE_NAVIGATED' | 'ABORTED' | 'UNKNOWN';
```

Each code has: HUD copy, `recoverable: boolean`, and an optional automatic retry policy (only `STT_TIMEOUT` retries once automatically).

## Test plan

### Unit (reducer tests, no DOM)

The state machine is a pure reducer — test it exhaustively:

| Test | Assertion |
| --- | --- |
| `happy-path` | `idle → listening → transcribing → thinking → executing → idle` with correct HUD calls |
| `stale-event-ignored` | `VAD_SPEECH_END` during `executing` does not change state |
| `double-activation` | second activation during `thinking` aborts the first (generation bump) and the first's continuation is dropped |
| `esc-at-every-state` | from all 6 states, `Esc` → `idle`, audio stopped, speech cancelled, actions aborted |
| `clarification-loop` | `ASK_CLARIFICATION` → `clarifying` → speak question → `listening` with the question in history |
| `partial-execution` | 1 of 3 actions fails → `error` recoverable, spoken summary mentions the failed field label |
| `brain-timeout` | `BRAIN_TIMEOUT` → `error` with retry affordance |
| `mic-denied` | `AUDIO_ERROR NOT_ALLOWED` → `error` with "Grant microphone access" copy |
| `silence-timeout` | no speech for 15 s → auto-stop + hint |
| `navigation` | page unload mid-execute → state `error PAGE_NAVIGATED`, no crash on `sendMessage` to a dead tab |
| `no-auto-submit` | Brain response with zero actions and no clarification → no `CLICK` emitted |

### Integration (Playwright + real extension, mocked C-3)

Load the unpacked extension in a persistent Chromium context; run against testbed forms with a **mock edge server** that returns scripted STT transcripts and Brain responses:

| Test | Assertion |
| --- | --- |
| `voice-fills-react-form` | fake audio → transcript → Brain returns 2 `FILL`s → React state JSON shows both values |
| `badges-then-fill` | badges visible before speaking; the filled field's badge flashed green |
| `clarify-then-complete` | mock returns `ASK_CLARIFICATION`, then after the second fake utterance returns the `FILL` |
| `esc-mid-execution` | 5-action batch; `Esc` after action 1 → actions 3–5 never run, state `idle` |
| `page-navigation` | click submit → new page → extension re-initialises and badges render on the new page |
| `no-mic-denied-silent-fail` | with mic denied, the HUD shows the error state (not a spinner forever) |

## Acceptance criteria

- [ ] Full voice-to-form loop works end-to-end on a live webpage without manual intervention (Chrome, real mic, real Brain via C-3): speak → fields fill → HUD returns to idle.
- [ ] State machine is a pure reducer with 100% branch coverage on transitions.
- [ ] Stale/late events can never start a second pipeline (generation guard proved by test).
- [ ] `Esc` aborts execution between actions and silences TTS in every state.
- [ ] Clarification round-trip works (ask → speak → listen → act).
- [ ] Partial failures are spoken and recoverable, never silent.
- [ ] SPA navigation mid-loop does not leave a stuck HUD or a zombie listener (tested).
- [ ] Conversation history is capped and expires; no page state is persisted beyond `chrome.storage.session`.
- [ ] All SW messages are zod-validated; unknown messages are ignored and logged.
- [ ] Loop adds no more than 150 ms of orchestration overhead per command (measured with `performance.mark`).

## Non-goals

- Multi-turn planning beyond clarification.
- Voice commands to control the extension itself ("stop listening") — `Esc` covers it.
- Undo/redo of filled values (INT-2 may add "undo last").
- Firefox/Safari.

## Definition of done

- `docs/extension/loop.md` contains the state diagram, the 10 loop rules, and the message sequence for a happy path + a clarification path.
- A recorded demo (screen capture with audio) attached to the PR.
- PR title: `[INT-1] Master control loop`.

## References

- Blueprint §PHASE 2 / INT-1
- Depends on every Track A–E ticket; INT-2 builds on this loop's post-submit phase.

---

### Live status

- [ ] Design reviewed by another track owner
- [ ] Implementation complete
- [ ] Unit tests green + coverage gate met
- [ ] Browser/E2E tests green (where applicable)
- [ ] Docs updated
- [ ] Acceptance criteria all checked

_Generated by `scripts/backlog.mjs`. Source of truth: `docs/backlog/tickets/INT-1.md`._
