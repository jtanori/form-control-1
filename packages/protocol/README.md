# @vfe/protocol

The frozen cross-platform contract: zod schemas + inferred TypeScript types for
everything that crosses a process, package, or network boundary in the Voice
Form Engine.

- **Version:** `PROTOCOL_VERSION = '1.0.0'` (`1.x` is additive-only — ADR-010).
- **Dependencies:** `zod` only. No DOM, Node, `openai`, or `zod-to-json-schema`.
- **Structured Outputs safe:** no `transform`, `preprocess`, `coerce`, or refinements on wire types.

## Install / import

```ts
import { PageStateSchema, type PageState } from '@vfe/protocol';
```

## Usage per track

### A — Eyes (dom-engine)

`distillPage()` must return exactly `PageState`. Remember the value semantics:
`''` for empty text, `false` for unchecked, `[]` for multi-select, `'<redacted>'`
for passwords.

```ts
import { PageStateSchema, type PageState, type FormElement } from '@vfe/protocol';

const state: PageState = { urlOrAppTitle: document.title, elements: [] };
PageStateSchema.parse(state);
```

### B — Hands (dom-engine)

`executeActions()` consumes `Action[]` and produces `ActionResult[]`.

```ts
import { ActionSchema, type Action, type ActionResult } from '@vfe/protocol';

const action: Action = ActionSchema.parse({ action: 'FILL', targetId: 'vfe_1', value: 'Alice' });
```

Resolve `[data-vfe-id]` **at execution time** — SPAs re-render.

### C — Brain

`BrainResponseSchema` is passed straight to `zodResponseFormat` for Structured
Outputs, and `ProcessCommandRequestSchema` validates the incoming envelope.

```ts
import {
  BrainResponseSchema,
  ProcessCommandRequestSchema,
  parseBrainResponse,
} from '@vfe/protocol';

const request = ProcessCommandRequestSchema.parse(body);
const response = parseBrainResponse(modelJson); // throws ProtocolError with issues
```

### D — Ears

`AgentStatus` drives the HUD. Audio buffers never enter the protocol.

```ts
import type { AgentStatus } from '@vfe/protocol';
```

### E — HUD

Render `AgentStatus` and `ActionResult`; never re-derive state locally.

```ts
import type { ActionResult, AgentStatus } from '@vfe/protocol';
```

## Golden fixtures

`packages/protocol/fixtures/*.json` are the canonical samples consumed by
tracks A/B/C and the eval suite. The same objects are exported from the
`@vfe/protocol/fixtures` subpath:

```ts
import { checkoutPageState, fixtures } from '@vfe/protocol/fixtures';
```

Editing a fixture requires updating all consumers in the same PR.

## Errors

`parsePageState` / `parseBrainResponse` throw `ProtocolError` with `code` and a
flattened `issues: Array<{ path, message }>`. `assertProtocolVersion` throws
`UNSUPPORTED_VERSION` for a mismatched major version.

## Change policy

1. Additive only within `1.x`: new optional fields, new union members appended.
2. Removing, renaming, or re-typing a field bumps `PROTOCOL_VERSION` to `2.0.0`
   with a migration note.
3. Consumers send `clientContext.protocolVersion`; the Brain rejects mismatched
   majors with `UNSUPPORTED_VERSION` (HTTP 409).
