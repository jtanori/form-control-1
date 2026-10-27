# The control loop (INT-1)

Five pillars meet here: the Eyes distil the page, the Ears capture one
utterance, the Brain decides, the Hands act and the HUD narrates. Everything
else in the extension is a component; this is the product.

```text
packages/extension/src/
├── loop/
│   ├── machine.ts    # pure reducer: state + event → state + effects
│   ├── driver.ts     # applies effects to HUD, badges, audio, hands, TTS
│   ├── errors.ts     # fault taxonomy, HUD copy, spoken summaries
│   └── history.ts    # capped, expiring, value-free conversation history
├── net/brain.ts      # POST /v1/brain through the edge proxy (session token)
├── background/
│   ├── loop-store.ts # chrome.storage.session: generation, page state, history
│   └── pipeline.ts   # speech → text → intent, with no shared state
└── content/index.ts  # mount HUD + badges, wire the driver to the page
```

## State machine

```text
idle ──activate──► listening ──speech end──► transcribing ──transcript──► thinking
 ▲                    │  ▲                                                 │
 │                  esc│  └──────────── activate (re-listen) ──────┐      │
 │                    ▼                                            │      ▼
 │                   idle                                     clarifying  executing
 │                                                              ▲          │
 └──────────────── error ◄───────────────────────────────────────┴──────────┘
```

Seven states: `idle`, `listening`, `transcribing`, `thinking`, `executing`,
`clarifying`, `error`. `statusFor(state)` is the only mapping to the HUD
(`transcribing` renders as the HUD's `thinking`, "Mapping actions…").

`reduce(state, event, ctx)` is pure — no DOM, no timers, no chrome — and returns
`{ state, effects, generation, dropped? }`.

```ts
type LoopEffect =
  | { type: 'listen' } // AUDIO_START + arm the worker with a page state
  | { type: 'stopListening' } // AUDIO_STOP
  | { type: 'stopSpeech' } // TTS_STOP
  | { type: 'abortActions' } // abort the in-flight executeActions
  | { type: 'speak'; text: string }
  | { type: 'execute'; actions: Action[]; total: number }
  | { type: 'hint'; text: string; ms: number };
```

### The generation guard

Every activation and every cancel increments `generation`. Async work captures
the generation it belongs to and drops its continuation when the counter moved:

- the driver ignores `onActionStart` / `onActionEnd` / execution results from a
  stale generation;
- the content script stamps `LOOP_ARMED` and `PAGE_STATE_UPDATED` with it;
- the service worker stamps `LOOP_TRANSCRIPT`, `LOOP_BRAIN_RESULT` and
  `LOOP_ERROR` with it, and the tab ignores anything that no longer matches.

A `VAD_SPEECH_END` arriving while `executing` is dropped as `stale-event` rather
than starting a second pipeline; a brain result for an older generation can
never fill a field.

## The ten loop rules

| #   | Rule                                                                                  | Where                                               |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | History: 20 turns, 10 min TTL, transcripts + action summaries only — never page state | `loop/history.ts`, `background/loop-store.ts`       |
| 2   | Every brain call uses the page state captured for this activation                     | `LoopStore.get()` + `PAGE_STATE_UPDATED`            |
| 3   | One pipeline at a time; a new activation aborts the old one                           | `machine.ts` + generation                           |
| 4   | Listening is one-shot; 15 s of silence auto-stops with a hint                         | `driver.ts` (`SILENCE_TIMEOUT_MS`)                  |
| 5   | TTS never overlaps VAD (D-2 mute tail); the loop speaks after actions                 | `driver.ts` effects                                 |
| 6   | `Esc` always wins: aborts actions, stops audio, silences speech                       | `machine.ts` `ESC`                                  |
| 7   | The loop never adds a submit click; only the brain can emit one                       | `machine.ts` (zero-action responses settle to idle) |
| 8   | Every failure maps to a `LoopErrorCode` with actionable HUD copy                      | `loop/errors.ts`                                    |
| 9   | Partial execution is first class: spoken, named, recoverable                          | `machine.ts` `EXECUTION_DONE`                       |
| 10  | Navigation resets the loop; the worker drops the tab's generation                     | `background/index.ts` `tabs.onUpdated`              |

## Message sequence

Happy path (numbers are generations):

```text
tab ── AUDIO_START ─────────────────────────────────────────────► worker
tab ── LOOP_ARMED { gen:1, pageState } ─────────────────────────► worker (stored)
offscreen ── VAD_SPEECH_END { audio } ─────────────────────────► worker
worker ── LOOP_TRANSCRIBING { gen:1 } ─────────────────────────► tab
worker ── POST /v1/stt ────────────────────────────────────────► edge
worker ── POST /v1/brain { pageState, transcript, history } ───► edge
worker ── LOOP_TRANSCRIPT { gen:1, transcript } ──────────────► tab
worker ── LOOP_BRAIN_RESULT { gen:1, response } ──────────────► tab
tab   ── executeActions(...) ──────────────────────────────────► page
tab   ── EXECUTION_REPORT { gen:1, ok, failedLabels } ────────► worker (history)
```

Clarification path:

```text
worker ── LOOP_BRAIN_RESULT { actions:[ASK_CLARIFICATION] } ──► tab
tab   ── (speak the question, state clarifying) ───────────────► offscreen
user clicks the pill / presses Alt+V
tab   ── AUDIO_START + LOOP_ARMED { gen:2 } ───────────────────► worker
… the question stays in the conversation history for the next brain call
```

Failure path:

```text
worker ── LOOP_ERROR { gen, code: 'TIMEOUT' | 'BRAIN_FAILED' | … } ──► tab
tab   ── state error (recoverable) + HUD copy + Retry ─────────────────► user
```

## Fault taxonomy

| Code                     | HUD copy                                               | Recoverable | Auto-retry |
| ------------------------ | ------------------------------------------------------ | ----------- | ---------- |
| `MIC_DENIED`             | Grant microphone access, then press Alt+V              | yes         | no         |
| `NO_SPEECH`              | I didn't hear anything — press Alt+V to try again      | yes         | no         |
| `STT_FAILED`             | I couldn't transcribe that. Please try again.          | yes         | no         |
| `STT_TIMEOUT`            | That took too long — trying once more.                 | yes         | once       |
| `BRAIN_FAILED`           | I couldn't reach the assistant. Try again in a moment. | yes         | no         |
| `BRAIN_TIMEOUT`          | The assistant didn't answer in time. Try again.        | yes         | no         |
| `INVALID_BRAIN_RESPONSE` | The assistant sent something I couldn't use.           | yes         | no         |
| `EXECUTION_PARTIAL`      | names the failed fields, spoken too                    | yes         | no         |
| `ELEMENT_MISSING`        | A field moved or disappeared before I could use it.    | yes         | no         |
| `PAGE_NAVIGATED`         | The page navigated. Press Alt+V to continue here.      | yes         | no         |
| `ABORTED`                | Stopped.                                               | —           | no         |
| `UNKNOWN`                | Please try again.                                      | yes         | no         |

Audio codes map onto `MIC_DENIED` for `NOT_ALLOWED`, `NO_DEVICE` and
`DEVICE_BUSY`; STT codes map through `loopCodeFromStt`; brain-client codes
through `loopCodeFromBrain`.

## Privacy

- The service worker stores `{ generation, pageState, history }` per tab in
  `chrome.storage.session` only — nothing survives a browser restart, and at
  most eight tabs are kept.
- History holds transcripts and summaries such as `filled Full name, clicked
Continue`; values and page text never enter it (`summariseActions`).
- `LOOP_ARMED` / `PAGE_STATE_UPDATED` travel tab → worker; page state is never
  broadcast to other tabs.

## Tests

| File                        | Covers                                                                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/loop-machine.test.ts` | happy path, stale events, double activation, `Esc` from every state, clarification round trip, partial execution, mic denial, brain timeout, aborts, retry, silence timeout, navigation, no auto-submit, HUD mapping |
| `test/loop-driver.test.ts`  | arming the worker, silence timer, execution + badge flashes + progress, stale generation dropped, partial failure copy, `Esc` mid-execution, error copy, destroy                                                     |
| `test/brain-client.test.ts` | token use, status mapping (401/429/504), schema validation, non-JSON, network failure, caller abort, missing session                                                                                                 |
| `test/pipeline.test.ts`     | stt → brain ordering, STT timeout, empty transcript, missing page state, brain failures                                                                                                                              |
| `test/loop-history.test.ts` | 20-turn cap, TTL, whitespace, truncation, value-free summaries                                                                                                                                                       |
| `test/loop-store.test.ts`   | arm/update semantics, stale generation rejection, navigation clear, TTL pruning, 8-tab cap                                                                                                                           |

## Deliberate gaps

- The Playwright integration table from the ticket (mock edge + real extension)
  needs the testbed dev server and a fake microphone; the audio E2E harness is
  gated behind `RUN_EXTENSION_E2E=1`.
- Post-submit validation and recovery now live in
  [`post-submit.md`](./post-submit.md): a submit-ish click enters
  `post_submit` instead of settling straight to `idle`.
