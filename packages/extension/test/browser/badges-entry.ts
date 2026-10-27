import type { PageState } from '@vfe/protocol';

import { destroyBadges, mountBadges } from '../../src/content/badges/mount';

let controller: ReturnType<typeof mountBadges> | null = null;

function stateFromDom(): PageState {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-vfe-id]'));
  return {
    urlOrAppTitle: document.title,
    elements: nodes.map((node, index) => ({
      id: node.dataset.vfeId as string,
      badgeIndex: index + 1,
      type: 'text' as const,
      label: node.getAttribute('aria-label') ?? 'Field',
      value: '',
      required: false,
      disabled: false,
      focused: false,
    })),
  };
}

const harness = {
  mount: () => {
    controller = mountBadges();
  },
  sync: () => {
    controller?.sync(stateFromDom());
    controller?.reposition();
  },
  count: () =>
    document.querySelectorAll('vfe-badges')[0]?.shadowRoot?.querySelectorAll('.badge').length ?? 0,
  destroy: () => {
    destroyBadges();
    controller = null;
  },
};

(globalThis as unknown as { VfeBadgeHarness: typeof harness }).VfeBadgeHarness = harness;
