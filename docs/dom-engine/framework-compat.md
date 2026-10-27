# Framework compatibility (B-1)

## Why `el.value = x` is not enough

React, Vue, Svelte and Angular keep their own copy of a controlled field's
value. Assigning through the instance goes through the framework's patched
`value` setter, which updates that copy but does **not** tell the framework the
user changed anything — the form then submits stale data or the next render
wipes the field.

## The native-setter bypass

```ts
const proto =
  el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;

Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
```

React's input change plugin compares the DOM value with the value recorded in
`_valueTracker`. Because the prototype setter never touches the tracker, the
next `input` event looks like a real change and `onChange` fires. When a
framework version still suppresses the event, B-1 clears the tracker
(`_valueTracker.setValue('')`) inside a `try/catch`.

## Event order

1. `focus` (non-bubbling) + `focusin`
2. `beforeinput` with `inputType: 'insertText'`
3. `keydown`
4. `input` (`InputEvent` with `data`/`inputType`) — the critical one
5. `keyup`
6. `change`
7. `blur` + `focusout` (validators often run here)
8. Escape (dismisses autocomplete overlays)

Every event is constructed with `bubbles: true`, `cancelable: true`,
`composed: true`, so it crosses shadow boundaries. `keypress` is deliberately
**not** dispatched: it is deprecated and React 19 removed its handling. If a
site is proven to require it, add `legacyKeypress` behind an option rather than
reintroducing it globally.

## contenteditable

`execCommand('insertText')` is deprecated but remains the only broadly working
path for ProseMirror/Slate/Draft.js editors, which rely on `beforeinput`. B-1
uses it first and falls back to a manual range selection + `textContent` +
`InputEvent` when the editor rejects it.

## Post-conditions

A fill is not `ok: true` until the value has been re-read from the DOM.
Text-like values compare trimmed; dates, numbers, emails, tel, time and URLs
compare exactly. A mismatch returns `VALUE_MISMATCH` with
`{ expected, actual }` — silent failure is worse than a typed failure the Brain
can repair.

## Browser-level proof

`packages/dom-engine/test/browser/fill.spec.ts` simulates a controlled
component (instance-level value setter + tracker + `input` listener) and a
pointer-only widget, and asserts the 40-field budget. Real React/Vue/Svelte/
Angular routes live in the QA-1 testbed (Phase 3) and reuse the same
`fillValue` contract.
