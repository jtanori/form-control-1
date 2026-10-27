<!-- vfe:metadata v1 INT-2 -->

### 🏷️ Backlog metadata — `INT-2`

Status mirror of the planner metadata (labels + milestone) so it is greppable inside the issue even if labels cannot be applied through the GitHub integration.

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
