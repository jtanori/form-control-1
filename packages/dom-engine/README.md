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

## Testing

- Unit: `pnpm --filter @vfe/dom-engine test` (jsdom + `mockLayout` — jsdom has
  no layout engine, so every visibility fixture installs a synthetic box).
- Browser: `pnpm --filter @vfe/dom-engine test:e2e` (Playwright, real Chromium
  layout, 500-input performance budget).
