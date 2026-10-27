# @vfe/dom-engine

Pure DOM logic: the **Eyes** (distil a page into `PageState`) and the **Hands**
(execute `Action[]`). No extension APIs, no HTTP, no audio, no LLM — the same
code can run in a desktop or mobile webview.

```ts
import { discoverInteractiveElements, findByVfeId, clearVfeTags, isVisible } from '@vfe/dom-engine';
```

## How discovery works (A-1)

Discovery is a deterministic, single-pass waterfall. Every step only **reads**
the DOM; a single write phase at the end attaches `data-vfe-id` and
`data-vfe-badge` attributes.

```text
document + every open shadow root
        │
        ▼
 candidate selector match  ── input / textarea / select / button / role=* /
        │                      contenteditable / a[href] (opt-in)
        ▼
 cheap exclusions          ── data-vfe-ignore, input[type=file|hidden|submit|
        │                      reset|image], role=option outside an open listbox
        ▼
 visibility waterfall      ── detached → aria-hidden → inert → display:none →
        │                      visibility → content-visibility → opacity (self+
        │                      ancestors) → zero-size → off-screen honeypot
        ▼
 modal hoist + numbering   ── dialog controls first, then document order, 1..N
        ▼
 single write phase        ── data-vfe-id (stable), data-vfe-badge (presentational)
```

### Guarantees

- **IDs are stable**: `data-vfe-id="vfe_7"` stays on the same node across
  re-scans (module `WeakMap`), so an action can be resolved after a re-render.
- **`badgeIndex` is not an identity**: it is recomputed on every pass and is
  only the number the user sees.
- **Open shadow roots are pierced**; closed roots cannot be traversed and are
  reported in `debug.closedShadowRoots`. Same-origin iframes are out of scope.
- **Honeypots are dropped, below-the-fold fields are kept** — scrolling is
  cheap, losing a field is not.
- **`maxElements`** (default 250) bounds both the walk and the LLM prompt.

### The `viaProxy` caveat

Custom checkbox/radio markup usually hides the native `<input>` with
`opacity: 0` or a 1×1 clipped box and styles its `<label>` instead. Dropping the
input would make "check the terms" impossible, so discovery keeps the control
when it has a **visible** `<label>` / `aria-labelledby` proxy and marks it with
`data-vfe-via-proxy="true"`; the Hands click the label, not the hidden input.

### Debug mode

`discoverInteractiveElements({ debug: true })` adds a `debug` object with the
number of shadow roots, closed roots and notes, and every skipped candidate is
returned in `excluded` with a `VisibilityReason`. The engine never logs.

### Tearing down

`clearVfeTags()` removes every engine-owned attribute from the document and all
open shadow roots and resets the ID registry. Site-authored
`data-vfe-ignore` attributes are never touched.

## How labels are resolved (A-2)

`resolveContext()` runs a deterministic waterfall — `aria-label` →
`aria-labelledby` → `<label for>` → wrapping `<label>` → proximity →
placeholder/name/id/`Field` — and returns the label, group legend, visible
validation error and required provenance. It never throws and never returns an
empty label. The full waterfall, including the anti-duplication rule for shared
headers, is documented in [`docs/dom-engine/label-waterfall.md`](../../docs/dom-engine/label-waterfall.md).

## distillPage & the watcher (A-3)

`distillPage()` composes discovery + context into a `PageState` that always
passes `PageStateSchema.parse`. Serialisation rules that matter:

- **Passwords are never serialised**: `'<redacted>'` when non-empty, `''` when
  empty. This is a privacy invariant, asserted by a string-search test.
- Checkboxes/radios serialise to booleans; multi-selects to string arrays;
  buttons always `''`; numbers stay strings (the Brain formats).
- `<select>` exposes every option; a custom `role="combobox"` exposes `[]` while
  closed and its visible `role="option"` children once expanded.
- `disabled` honours `disabled`, `aria-disabled` and a disabled `<fieldset>`;
  `focused` works inside open shadow roots.

`watchPage(onChange)` observes the document **and every open shadow root**,
debounces bursts (120 ms trailing, 500 ms max wait), ignores its own
`data-vfe-*` writes, and emits only real diffs (`added` / `removed` /
`updated`). New nodes that represent the same logical field (same name, type,
label and group) re-adopt their old `vfeId`, so a React re-render does not
renumber the form.

```ts
const watcher = watchPage((change) => hud.render(change));
watcher.start();
// … later
watcher.stop();
```

## How the Hands work (B-1/B-2/B-3)

`executeActions(Action[])` runs a batch sequentially and returns a typed report.
Individual handlers are exported for direct use: `fillValue`, `clearValue`,
`selectOption`, `setChecked`, `clickElement`, `focusElement`, `scrollPage`.

- **Framework bypass:** values go through the prototype setter plus the full
  `beforeinput → keydown → input → keyup → change → blur` sequence, so React
  `onChange`, Vue `v-model`, Svelte bindings and Angular `ngModel` see a real
  edit. See [`docs/dom-engine/framework-compat.md`](../../docs/dom-engine/framework-compat.md).
- **Option matching:** a seven-step waterfall (value → label → normalised →
  acronym → prefix → substring → Levenshtein ≤ 2) that never guesses between
  ambiguous candidates; failures carry the available options so the Brain can
  retry.
- **Clicks are pointer sequences**, not `.click()`, because Radix/Headless UI
  listen on `pointerdown`.
- **Hidden native checkboxes** are clicked through their visible label proxy.
- **Post-conditions:** every handler re-reads the DOM and returns
  `VALUE_MISMATCH` instead of a false success.
- **Queue semantics:** late resolution, transient-only retries, per-action
  timeouts, `AbortSignal`, submit-click navigation guard, and a mutex that
  serialises concurrent batches. See
  [`docs/dom-engine/execution-semantics.md`](../../docs/dom-engine/execution-semantics.md).

## Testing

- Unit: `pnpm --filter @vfe/dom-engine test` (jsdom + `mockLayout` — jsdom has
  no layout engine, so every visibility fixture installs a synthetic box).
- Browser: `pnpm --filter @vfe/dom-engine test:e2e` (Playwright, real Chromium
  layout, 500-input performance budget).
