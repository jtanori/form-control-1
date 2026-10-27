import { createHudController, type HudController, type HudEvent } from './controller';
export type { HudController, HudEvent } from './controller';
import { HUD_STYLES } from './styles';
import { createHudDom } from './templates';

export interface MountHudOptions {
  onEvent?: (event: HudEvent) => void;
  doc?: Document;
}

export interface MountedHud {
  controller: HudController;
  host: HTMLElement;
}

const HOST_TAG = 'vfe-hud';
const MAX_REMOUNTS_PER_MINUTE = 3;

let active: MountedHud | null = null;

function defineElement(doc: Document): void {
  try {
    const registry = doc.defaultView?.customElements;
    if (!registry || registry.get(HOST_TAG)) return;
    registry.define(HOST_TAG, class extends (doc.defaultView?.HTMLElement ?? HTMLElement) {});
  } catch {
    // Double injection or a hostile page must not break the HUD.
  }
}

function styleHost(host: HTMLElement): void {
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.right = '0';
  host.style.bottom = '24px';
  host.style.display = 'block';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'none';
  host.style.width = '100%';
  host.style.height = 'auto';
}

/**
 * Idempotent mount. The host lives directly under `<html>` so a page that wipes
 * `<body>` cannot delete the HUD. Open shadow root by decision: isolation comes
 * from scoped styles, while Playwright and screen readers can still inspect it.
 */
export function mountHud(options: MountHudOptions = {}): HudController {
  const doc = options.doc ?? document;
  if (active) {
    if (!active.host.isConnected) doc.documentElement.append(active.host);
    return active.controller;
  }

  defineElement(doc);

  const host = doc.createElement(HOST_TAG);
  styleHost(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = HUD_STYLES;
  const elements = createHudDom();
  const wrap = doc.createElement('div');
  wrap.append(elements.pill, elements.hintBox, elements.live);
  shadow.append(style, wrap);

  const controller = createHudController({
    elements,
    host,
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    doc,
  });
  const mounted: MountedHud = { controller, host };
  active = mounted;

  doc.documentElement.append(host);
  controller.reposition();

  const abort = new AbortController();
  const remounts: number[] = [];

  // Page wipes `<html>` or a hostile script removes the host: re-attach, but
  // never in an infinite loop (max 3 per minute).
  const observer = new MutationObserver(() => {
    if (host.isConnected) return;
    const now = Date.now();
    while (remounts.length > 0 && now - (remounts[0] ?? now) > 60_000) remounts.shift();
    if (remounts.length >= MAX_REMOUNTS_PER_MINUTE) return;
    remounts.push(now);
    doc.documentElement.append(host);
    controller.reposition();
  });
  observer.observe(doc.documentElement, { childList: true });

  let repositionTimer: ReturnType<typeof setTimeout> | null = null;
  const requestReposition = (): void => {
    if (repositionTimer) return;
    repositionTimer = setTimeout(() => {
      repositionTimer = null;
      controller.reposition();
    }, 500);
  };
  const view = doc.defaultView;
  view?.addEventListener('scroll', requestReposition, { passive: true, signal: abort.signal });
  view?.addEventListener('resize', requestReposition, { passive: true, signal: abort.signal });

  const originalDestroy = controller.destroy;
  controller.destroy = (): void => {
    abort.abort();
    if (repositionTimer) clearTimeout(repositionTimer);
    repositionTimer = null;
    observer.disconnect();
    originalDestroy();
    if (active === mounted) active = null;
  };

  return controller;
}

/** Test helper: full teardown between cases. */
export function destroyHud(): void {
  active?.controller.destroy();
  active = null;
}
