# voice-form-engine

Voice-driven form filling for the web. Say _"my name is Alice, email alice at wonderland dot com, and click Continue"_ — the assistant numbers every field on the page, listens, understands, and fills it in.

Phase 0 (foundation), all of Phase 1 (tracks A–E) and two Phase 2 tickets
(`INT-1` master control loop, `INT-2` post-submit validation & recovery) are
implemented: the protocol, the DOM eyes and hands, the brain, the edge proxy,
the audio pipeline, the HUD/badge UI, the state machine that ties them together
and the recovery loop that reads the page back after a submit. The QA testbed
is next.

```text
┌──────────────────────────── Chrome MV3 extension ────────────────────────────┐
│  EARS  (VAD + STT)   →   BRAIN (LLM)   →   HANDS (DOM actions)   →  HUD      │
│  eyes see the DOM    →   protocol JSON →   fills/selects/clicks  →  badges   │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Where things are

| Path                                                               | What                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| [`BACKLOG.md`](BACKLOG.md)                                         | Generated index of all 18 tickets with phases, estimates, dependencies and issue links                  |
| [`docs/backlog/tickets/`](docs/backlog/tickets)                    | **Source of truth** — one detailed ticket per file (algorithm specs, acceptance criteria, test plans)   |
| [`docs/backlog/execution-plan.md`](docs/backlog/execution-plan.md) | Dependency graph, agent assignment, schedule, definition of ready/done, kickoff prompt                  |
| [`docs/architecture.md`](docs/architecture.md)                     | ADRs (protocol-first, offscreen audio, key custody, state machine, shadow-DOM isolation) + threat model |
| [`docs/backlog/issues/`](docs/backlog/issues)                      | Rendered issue bodies + metadata-comment payloads (generated, used by the sync script)                  |
| [`docs/backlog/backlog.json`](docs/backlog/backlog.json)           | Machine-readable metadata for all 18 tickets (labels, milestone, deps, estimates, issue numbers)        |
| [`scripts/backlog.mjs`](scripts/backlog.mjs)                       | Backlog tooling: `build` (regenerate docs) and `sync` (publish to GitHub)                               |

## The backlog in one screen

| Phase               | Tickets                                                                                                                                        | Parallel?                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **0 — Foundation**  | `P0-1` monorepo · `P0-2` universal protocol (zod, frozen)                                                                                      | sequential — blocks everything |
| **1 — Tracks A–E**  | `A-1..A-3` DOM distiller · `B-1..B-3` action executor · `C-1..C-3` LLM brain + edge proxy · `D-1..D-2` audio/STT/TTS · `E-1..E-2` HUD + badges | 5 tracks fully parallel        |
| **2 — Integration** | `INT-1` master control loop · `INT-2` post-submit validation & recovery                                                                        | sequential                     |
| **3 — QA**          | `QA-1` form torture testbed (starts on day 1)                                                                                                  | parallel with Phase 1/2        |

Total: **18 tickets · ~166 engineer-hours** → ~9 working days with 5 parallel agents on the critical path.

The headline acceptance test is `QA-1`: **five deliberately hostile forms completed start-to-finish with 100% voice commands**, no mouse, no keyboard.

## Monorepo layout (created by `P0-1`)

```text
packages/
├── protocol/      @vfe/protocol     shared zod schemas + types (the universal contract)
├── brain/         @vfe/brain        LLM orchestration API + edge proxy
├── dom-engine/    @vfe/dom-engine   "eyes" (distill) and "hands" (execute) — pure DOM lib
├── extension/     @vfe/extension    Chrome MV3 client (VAD, STT/TTS, HUD)
└── testbed/       @vfe/testbed      React playground with hostile forms
```

Design rule: `dom-engine` and `protocol` stay **platform-agnostic**, so a desktop or mobile shell can reuse them in Phase 2.

## Working with the backlog

```bash
# regenerate BACKLOG.md + docs/backlog/issues/*.md from the ticket files
node scripts/backlog.mjs build

# preview what would be published to GitHub (no writes)
node scripts/backlog.mjs sync --dry-run

# create/update labels, milestones and issues (idempotent; writes issue numbers back)
node scripts/backlog.mjs sync --apply

# post the labels/milestone block as an idempotent comment on each issue
node scripts/backlog.mjs annotate --apply
```

Issue titles are `[<ID>] <title>` so an agent can be told simply: _"implement `A-2`"_. The kickoff prompt for coding agents lives in [`docs/backlog/execution-plan.md`](docs/backlog/execution-plan.md#7-kickoff-prompt-for-a-coding-agent).

## Status

|              |                                                           |
| ------------ | --------------------------------------------------------- |
| Planning     | ✅ complete (18 tickets, dependency-checked, agent-ready) |
| Phase 0      | ✅ `P0-1` monorepo, `P0-2` frozen protocol 1.0.0          |
| Phase 1      | ✅ `A-1…A-3`, `B-1…B-3`, `C-1…C-3`, `D-1…D-2`, `E-1…E-2`  |
| Phase 2      | ✅ `INT-1` control loop, `INT-2` post-submit recovery     |
| Phase 2 / QA | ⬜ next: `QA-1`                                           |

## License

TBD.
