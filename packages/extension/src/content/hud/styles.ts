export const HUD_STYLES = `
:host {
  all: initial;
  --vfe-bg: rgba(20, 20, 24, 0.88);
  --vfe-fg: #ffffff;
  --vfe-muted: #c9c9d4;
  --vfe-accent: #7c5cff;
  --vfe-danger: #ff6b6b;
  --vfe-border: rgba(255, 255, 255, 0.16);
}
@media (prefers-color-scheme: light) {
  :host {
    --vfe-bg: rgba(255, 255, 255, 0.95);
    --vfe-fg: #14141a;
    --vfe-muted: #565664;
    --vfe-border: rgba(0, 0, 0, 0.14);
  }
}
* { box-sizing: border-box; }
.wrap {
  display: flex;
  justify-content: center;
  width: 100vw;
  pointer-events: none;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
.pill {
  all: unset;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  max-width: 44px;
  padding: 0 13px;
  border-radius: 999px;
  background: var(--vfe-bg);
  color: var(--vfe-fg);
  border: 1px solid var(--vfe-border);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  cursor: pointer;
  overflow: hidden;
  transition: max-width 180ms ease;
  -webkit-font-smoothing: antialiased;
}
.pill[data-state='listening'] { max-width: 320px; }
.pill[data-state='thinking'],
.pill[data-state='executing'],
.pill[data-state='clarifying'],
.pill[data-state='error'] { max-width: 320px; }
.pill[data-state='clarifying'] { border-color: var(--vfe-accent); }
.pill[data-state='error'] { border-color: var(--vfe-danger); }
.pill:focus-visible { outline: 3px solid var(--vfe-accent); outline-offset: 3px; }
.icon { flex: none; width: 18px; height: 18px; display: grid; place-items: center; }
.icon svg { width: 18px; height: 18px; display: block; }
.body { display: none; flex-direction: column; gap: 2px; min-width: 0; text-align: left; }
.pill[data-state='listening'] .body,
.pill[data-state='thinking'] .body,
.pill[data-state='executing'] .body,
.pill[data-state='clarifying'] .body,
.pill[data-state='error'] .body { display: flex; }
.title { font-size: 13px; font-weight: 600; line-height: 1.25; white-space: nowrap; }
.transcript { font-size: 12px; color: var(--vfe-muted); line-height: 1.3; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.message { font-size: 12px; line-height: 1.35; max-width: 280px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.message:empty { display: none; }
.hint { display: none; font-size: 12px; color: var(--vfe-muted); white-space: nowrap; }
.pill[data-state='idle']:hover .hint, .pill[data-state='idle']:focus-visible .hint { display: inline; }
.pill[data-state='idle']:hover, .pill[data-state='idle']:focus-visible { max-width: 220px; }
.wave { display: none; align-items: center; gap: 2px; height: 18px; }
.pill[data-state='listening'] .wave { display: flex; }
.wave span { width: 3px; height: 6px; border-radius: 2px; background: var(--vfe-danger); transform-origin: center; animation: vfe-wave 900ms ease-in-out infinite; }
.wave span:nth-child(2) { animation-delay: 120ms; }
.wave span:nth-child(3) { animation-delay: 240ms; }
.wave span:nth-child(4) { animation-delay: 360ms; }
.wave span:nth-child(5) { animation-delay: 480ms; }
@keyframes vfe-wave { 0%, 100% { transform: scaleY(0.6); opacity: 0.6; } 50% { transform: scaleY(2.2); opacity: 1; } }
.spinner { display: none; width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--vfe-border); border-top-color: var(--vfe-fg); animation: vfe-spin 800ms linear infinite; }
.pill[data-state='thinking'] .spinner { display: block; }
.pill[data-state='thinking'] .icon { display: none; }
@keyframes vfe-spin { to { transform: rotate(360deg); } }
.progress { display: none; height: 3px; width: 100%; border-radius: 2px; background: var(--vfe-border); overflow: hidden; }
.pill[data-state='executing'] .progress { display: block; }
.progress span { display: block; height: 100%; width: 0%; background: var(--vfe-accent); transition: width 150ms ease; }
.live { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.hintbox { position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); max-width: 280px; padding: 6px 10px; border-radius: 8px; background: var(--vfe-bg); color: var(--vfe-fg); border: 1px solid var(--vfe-border); font: 12px/1.35 system-ui, sans-serif; display: none; pointer-events: none; }
.hintbox[data-visible='true'] { display: block; }
@media (prefers-reduced-motion: reduce) {
  .pill { transition: none; }
  .wave span { animation: none; transform: scaleY(1.4); opacity: 1; }
  .spinner { animation: none; border-top-color: transparent; border-left-color: var(--vfe-fg); }
  .progress span { transition: none; }
}
`;
