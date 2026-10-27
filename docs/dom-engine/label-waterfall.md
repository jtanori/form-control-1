# Label & context waterfall (A-2)

`resolveContext(el)` turns a DOM node into the four pieces of text the Brain
needs: `label` (never empty), `groupLabel`, `validationError`, and the
required-flag with its provenance. It is deterministic, cached per pass, and
never throws.

The waterfall stops at the first non-empty result.

## 1. `aria-label`

The most explicit machine-readable name wins. `<input aria-label="Preferred email">`
is labelled `Preferred email` even when a visible `<label>` says something else
(fixture `aria-label-wins.html`).

## 2. `aria-labelledby`

IDs are resolved in the element's own root first, then the document, then every
open shadow root — labels frequently live on the other side of a shadow
boundary. Multiple ids are concatenated in order. If a referenced node is itself
a control, its own label is resolved recursively (depth ≤ 2, cycle-guarded).

## 3. `<label for="…">`

Works with ids that contain CSS metacharacters (`CSS.escape`), searches the root
and the document, and joins every matching label with a single space
(`multiple-labels.html` → `Work Email Address`).

## 4. Implicit parent `<label>`

`<label><input type="radio"> Standard shipping</label>` resolves to
`Standard shipping`. The label is cloned and every nested control/svg is removed
before reading its text, so the input's own rendered text can never leak into
the label, and reading `innerText` never forces layout on the live node.

## 5. Proximity heuristic

Used by Bootstrap-floating/Tailwind-style markup with no `for` and no wrapper:
the previous sibling, the parent's previous sibling, or the first text element
inside the closest field wrapper. A candidate is accepted only when it is
visible, has 1–60 characters, contains no control, is not a heading, and has
not already been claimed as another control's label (`duplicate-labels.html`).
This last rule prevents one shared "Email" header from labelling two fields.

## 6. Fallbacks

`placeholder` → humanised `name` (`firstName` → `First Name`) → `data-testid` →
`id` → the literal `Field`. The label is therefore **never** empty.

## Required detection

`required` is true when the native `required` property is set, else when
`aria-required="true"`, else when the resolved label contained a marker (`*`,
`✱`, `(required)`, `: required`). `requiredSource` reports which of `html`,
`aria`, `label-marker`, `none` won. Markers are stripped from the label.

## Group labels

1. nearest `<fieldset>` → its `<legend>`;
2. nearest `role="group"` / `role="radiogroup"` with an accessible name;
3. up to six ancestor levels backwards looking for a heading or a short bare
   text block (stopping at `<form>`, `<section>`, `<main>`);
4. `<section>`/`<form>` with `aria-label`/`aria-labelledby`;
5. `undefined` — the Brain must see genuine ambiguity rather than an invented
   group.

## Validation errors

Only messages the user can currently see are reported, in this order:
`aria-errormessage` → error-ish or `role="alert"` `aria-describedby` →
`role="alert"` inside the field wrapper → error/invalid/danger class or id →
red-ish computed colour → HTML5 `validationMessage` (only after the field has
been touched, marked with `data-vfe-touched="true"`). Hidden `.error` templates
and neutral helper text are ignored. One message per field, closest in document
order.

## Caching

`resolveContext` caches per element (`WeakMap`) and the proximity "used text"
registry is scoped to one distillation pass. `clearContextCache()` is called by
`distillPage()` at the start of every pass and is exported for tests.
