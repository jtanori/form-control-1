# Brain eval suite (C-2)

Deterministic, CI-runnable proof that the Brain does what the prompt claims.

```bash
pnpm --filter @vfe/brain eval          # mock mode, no keys, must be 100 %
pnpm --filter @vfe/brain eval:live     # real provider, ≥ 93 % baseline
pnpm --filter @vfe/brain eval:record   # refresh `mock` blocks from live output
```

## Layout

```
evals/
├── scenarios/*.json   # 20 scenarios: page state ref, transcript, expectations, mock output
├── fixtures.ts        # page states used only by evals (+ protocol checkout/wizard)
├── assert.ts          # resolution, multiset comparison, spoken-surface checks
├── run.ts             # runner, mock provider, reports
├── cli.ts             # check / live / record modes, cost guard, baseline gate
├── baseline.json      # mock = 1.0, live = 0.93
└── report.json / .md  # generated; uploaded by CI (gitignored)
```

## Scenario shape

```jsonc
{
  "id": "spoken-email",
  "pageState": "formats", // key in fixtures.ts or a @vfe/protocol fixture name
  "transcript": "john dot doe at acme dot co dot uk",
  "history": [],
  "expect": {
    "actions": [
      { "action": "FILL", "target": { "label": "Email" }, "value": "john.doe@acme.co.uk" }
    ],
    "allowExtraActions": false,
    "allowOrderChange": true,
    "spokenFeedback": { "mustNotContain": ["error"] },
    "clarificationMustMention": ["Billing", "Shipping"],
    "forbidActions": ["CLICK"]
  },
  "mock": { "thoughtProcess": "…", "spokenFeedback": "…", "actions": [ … ] }
}
```

Targets are resolved by **label + optional group label**, never by `vfe_*` ids
(machine-generated). A target matching zero or several elements is reported as a
fixture inconsistency, so the suite cannot pass by accident. Values are compared
after type-aware normalisation (case-insensitive text/email, digits-only phone,
numeric numbers, strict dates, select by option value or label).

## Modes

| Mode   | Provider                         | Requirement                     |
| ------ | -------------------------------- | ------------------------------- |
| mock   | the scenario's own `mock` block  | **100 %**, zero network, < 30 s |
| live   | OpenAI / Groq / Anthropic        | **≥ 93 %** of mandatory set     |
| record | live, then rewrite `mock` blocks | refuses below the baseline      |

The nightly workflow runs each scenario three times, prints stability, uploads
`report.live.*`, and opens or comments on a single `Brain eval regression`
issue. A projected cost above `EVAL_MAX_COST_USD` (default `$0.50`) aborts
before the first call.

## Why hand-authored mocks

The mock blocks are the reviewed, deterministic specification of model
behaviour: they make PR CI free and catch harness/expectation drift. They are
not evidence that a real provider passes — the nightly job provides that. After
a prompt change, run `eval:record`, review every changed block in the diff, and
keep the live baseline at or above 93 %. `eval:record` refuses to run below
the baseline and only rewrites scenarios that passed live.

## Deliberately-broken-mock tests

`run.test.ts` feeds the assertion engine fabricated targets, leaked passwords,
wrong action order, extra actions, forbidden clicks and non-clarifying
responses, proving each guard fails loudly instead of passing silently.
