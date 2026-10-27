<!-- vfe:metadata v1 QA-1 -->

### 🏷️ Backlog metadata — `QA-1`

Status mirror of the planner metadata (labels + milestone) so it is greppable inside the issue even if labels cannot be applied through the GitHub integration.

**Milestone:** `Phase 3 — QA & Synthetic Torture Testbed`  
**Priority:** `p0` · **Type:** `feature` · **Estimate:** `20h (XL)` · **Owner:** QA/Frontend Engineer

| Label          | Meaning                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- |
| `phase:3-qa`   | Phase 3 — QA & synthetic torture testbed                                                     |
| `track:qa`     | QA, testbed & end-to-end verification                                                        |
| `type:feature` | New user-facing capability                                                                   |
| `area:testbed` | @vfe/testbed playground                                                                      |
| `area:e2e`     | Playwright end-to-end suites                                                                 |
| `priority:p0`  | Blocks the MVP release                                                                       |
| `agent-ready`  | Fully specified: algorithms, acceptance criteria, test plan — safe to hand to a coding agent |
| `backlog`      | Part of the MVP backlog (auto-applied by scripts/backlog.mjs)                                |

```json
{
  "ticket": "QA-1",
  "title": "Form Torture Testbed — 5 hostile form patterns for E2E proof",
  "phase": "phase-3",
  "milestone": "Phase 3 — QA & Synthetic Torture Testbed",
  "labels": [
    "phase:3-qa",
    "track:qa",
    "type:feature",
    "area:testbed",
    "area:e2e",
    "priority:p0",
    "agent-ready",
    "backlog"
  ],
  "priority": "p0",
  "type": "feature",
  "track": "qa",
  "ownerRole": "QA/Frontend Engineer",
  "estimateHours": 20,
  "estimate": "XL",
  "parallelSafe": true,
  "blockedBy": ["P0-1"],
  "blocks": [],
  "githubIssue": 18
}
```
