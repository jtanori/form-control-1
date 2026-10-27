# Badge overlay

Every discovered control gets a visible number, so the user can say _"put 90210
in field 4"_ instead of describing a field. The overlay has to stay glued to its
input while the page scrolls, resizes, opens accordions or re-renders — without
fighting the host page for the main thread.

Source: `packages/extension/src/content/badges/`.

```text
mount.ts       host element, shadow root, remount guard
controller.ts  sync() diffing, flash(), enable/disable, position pass
position.ts    pure clamp/placement maths
scheduler.ts   one shared requestAnimationFrame pass
styles.ts      badge CSS (inside the shadow root)
```

## Positioning model

The host is a single `<vfe-badges>` element with `position: fixed; inset: 0;
pointer-events: none; z-index: 2147483646` — one below the HUD pill, so the pill
is never covered. Each badge is an absolutely positioned `<div>` inside the
shadow root, positioned **in viewport coordinates** with
`transform: translate3d(x, y, 0)`.

Why viewport coordinates and not document coordinates? Document coordinates
would avoid a scroll listener, but they are only equivalent to viewport
coordinates when no ancestor applies a CSS transform. The overlay must also work
inside transformed modals and scaled containers, where `getBoundingClientRect()`
is still correct and document coordinates are not. The cost is one reposition
pass per frame while scrolling.

### Read/write split

The pass is two loops, never interleaved:

1. **read** — resolve each element (once per id, re-resolving when the cached
   node is detached) and collect `getBoundingClientRect()`;
2. **write** — set `data-visible` and `transform`, nothing else.

Reading a rect after a style write would force the browser to synchronously
recompute layout; the split keeps a 100-badge pass in the low single-digit
milliseconds. `debugStats()` exposes `{ reads, writes }` and a unit test asserts
`writes === 0` at every read.

### Scheduling

`createScheduler()` collapses any number of `schedule()` calls inside one tick
into a single `requestAnimationFrame` pass. Reposition is requested from:

| Event                                         | Why                                             |
| --------------------------------------------- | ----------------------------------------------- |
| `scroll` (capture, passive)                   | page and nested-container scrolling             |
| `resize`                                      | viewport changes                                |
| `focusin` / `keydown`                         | focus moves can reveal or shift controls        |
| `transitionend` / `animationend` (capture)    | accordions and sheets                           |
| each `sync()` that actually changed something | distiller output                                |
| `visibilitychange`                            | one immediate pass when the tab becomes visible |

While `document.hidden` the scheduler refuses to work; the visibility handler
cancels any pending frame.

## Modes

- **scroll-listener** (default): the listener set above; correct for any page
  that scrolls, including `body { overflow: hidden }` scroll jails.
- **no-listener**: for pages that never scroll (typical SPA shells) a single
  mount-time pass is enough; badges still follow `sync()`, focus and transition
  events. The mode is chosen at mount by checking whether the document is
  taller than the viewport.

Neither mode re-creates badge nodes: nodes are created once per `vfeId` and
mutated afterwards. Re-creating nodes on every frame is the classic way to miss
60 fps.

## Sync contract

```ts
controller.sync(pageState); // full replacement, diffed by vfeId
controller.flash(vfeId, 'ok' | 'error');
controller.setEnabled(boolean);
controller.destroy();
```

`sync()` compares against the previous state and:

- creates nodes only for new ids,
- removes nodes whose id disappeared,
- rewrites `textContent` only when `badgeIndex` changed (the node identity is
  preserved, so a re-distillation burst never flickers),
- **returns without touching the DOM when nothing changed** — the hot path
  during `watchPage` bursts, asserted with a `MutationObserver` count.

Elements are resolved through A-1's `findByVfeId`, which walks open shadow roots.
A cached element is reused while `isConnected`; React re-renders that replace
inputs are therefore picked up on the next pass instead of pointing at detached
nodes forever. Badge nodes themselves carry `data-vfe-id` (for tests), so the
resolver rejects hits inside its own overlay.

## Visuals

| State      | Rendering                                               |
| ---------- | ------------------------------------------------------- |
| `default`  | 20 px black pill, white ring, `600 11px` system font    |
| `active`   | green `#22c55e`, scaled 1.15 (set by `flash(id, 'ok')`) |
| `error`    | red ring (`flash(id, 'error')` or a `validationError`)  |
| `disabled` | grey, 55% opacity                                       |
| `focused`  | blue ring                                               |

The number is `badgeIndex`, never the `vfeId`. Reduced motion disables the flash
transition and the scale. Above 60 badges the badge style keeps `contain: strict`
and `will-change` is applied only while a reposition pass is running, to avoid
one compositor layer per badge. The hard cap is 250 badges, matching A-1's
`maxElements`.

## Isolation and accessibility

- Everything lives in one open shadow root; the host is `pointer-events: none`
  and so is every badge. Clicking a badge's pixel reaches the control underneath
  (asserted by a Playwright test) — click-to-target is a Phase 2 idea, and
  stealing clicks from the page is not.
- The overlay (and each badge) is `aria-hidden`: the numbers are redundant with
  the labels a screen reader announces. The HUD is what says "Field 4".
- Host CSS cannot move badges (positions come from rects, not from inherited
  styles) and a `* { transform: none !important }` page does not break them.
- The host is re-attached by the same capped remount guard as the HUD (3 per
  minute).

## Tests

| Layer        | File                          | Covers                                                                                                                                                                                                                      |
| ------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit (jsdom) | `test/badges.test.ts`         | create/diff/renumber, zero-write idle sync, disabled/error/focused states, 250 cap, clamping, offscreen hiding, stale-element re-resolution, read/write split, flash timing, scheduler coalescing, destroy, a11y attributes |
| browser      | `test/browser/badges.spec.ts` | glue across scroll and resize, accordion follow, host CSS reset immunity, above a `2147483645` overlay, no click stealing, 100-badge frame rate                                                                             |

Run the browser suite with `pnpm --filter @vfe/extension test:e2e`.
