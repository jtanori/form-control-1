import { createBadgeController, type BadgeController } from './controller';
import { BADGE_STYLES } from './styles';

export type BadgeControllerHandle = BadgeController;

const HOST_TAG = 'vfe-badges';
const MAX_REMOUNTS_PER_MINUTE = 3;

let active: { controller: BadgeController; host: HTMLElement } | null = null;

function defineElement(doc: Document): void {
  try {
    const registry = doc.defaultView?.customElements;
    if (!registry || registry.get(HOST_TAG)) return;
    registry.define(HOST_TAG, class extends (doc.defaultView?.HTMLElement ?? HTMLElement) {});
  } catch {
    // Double injection: the existing definition is fine.
  }
}

function styleHost(host: HTMLElement): void {
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.width = '100vw';
  host.style.height = '100vh';
  host.style.zIndex = '2147483646';
  host.style.pointerEvents = 'none';
  host.style.display = 'block';
}

/**
 * Idempotent overlay mount. One shadow root, one node per badge, one rAF pass.
 * The overlay never receives pointer events: badges must not steal clicks from
 * the page they describe (click-to-target is a Phase 2 concern).
 */
export function mountBadges(doc: Document = document): BadgeController {
  if (active) {
    if (!active.host.isConnected) doc.documentElement.append(active.host);
    return active.controller;
  }

  defineElement(doc);

  const host = doc.createElement(HOST_TAG);
  styleHost(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = BADGE_STYLES;

  const layer = doc.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.dataset.vfeBadgeLayer = 'true';

  shadow.append(style, layer);
  doc.documentElement.append(host);

  const controller = createBadgeController({ layer, doc });
  active = { controller, host };

  const remounts: number[] = [];
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

  const destroy = controller.destroy;
  controller.destroy = (): void => {
    observer.disconnect();
    destroy();
    host.remove();
    if (active?.controller === controller) active = null;
  };

  return controller;
}

/** Test helper: full teardown between cases. */
export function destroyBadges(): void {
  active?.controller.destroy();
  active = null;
}
