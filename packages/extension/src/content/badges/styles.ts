export const BADGE_STYLES = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483646;
  contain: layout style;
}
* { box-sizing: border-box; }
.badge {
  position: fixed;
  top: 0;
  left: 0;
  display: none;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: #111827;
  color: #ffffff;
  font: 600 11px/20px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  text-align: center;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.4),
    0 0 0 1.5px #ffffff;
  transform: translate3d(-9999px, -9999px, 0);
  transition:
    background-color 150ms ease,
    box-shadow 150ms ease,
    scale 150ms ease;
  contain: strict;
}
.badge[data-visible='true'] { display: grid; }
.badge[data-state='active'] { background: #22c55e; scale: 1.15; }
.badge[data-state='error'] { box-shadow: 0 0 0 2px #ef4444; }
.badge[data-state='disabled'] { opacity: 0.55; background: #6b7280; }
.badge[data-state='focused'] { box-shadow: 0 0 0 2px #3b82f6; }
.badge.repositioning { will-change: transform; }
@media (prefers-reduced-motion: reduce) {
  .badge { transition: none; }
  .badge[data-state='active'] { scale: 1; }
}
`;
