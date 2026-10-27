/**
 * DOM helpers shared by discovery (A-1), labels (A-2) and distillation (A-3).
 * Everything here is shadow-DOM aware: a `ShadowRoot` is a root, and its host
 * is the parent of the root's top-level children.
 */

/** Parent element, crossing a shadow boundary via the host when needed. */
export function parentOf(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) return root.host;
  return null;
}

export function isShadowRoot(node: Node): node is ShadowRoot {
  return typeof ShadowRoot !== 'undefined' && node instanceof ShadowRoot;
}

/**
 * Collect the root and every open shadow root reachable from it.
 * Closed shadow roots are skipped (unreachable by design).
 */
export function collectRoots(root: Document | ShadowRoot): {
  roots: Array<Document | ShadowRoot>;
  closedShadowRoots: number;
} {
  const roots: Array<Document | ShadowRoot> = [root];
  let closedShadowRoots = 0;
  for (let index = 0; index < roots.length; index += 1) {
    const current = roots[index];
    if (!current) continue;
    for (const el of Array.from(current.querySelectorAll('*'))) {
      const shadow = el.shadowRoot;
      if (shadow) {
        roots.push(shadow);
      } else if (hasClosedShadowRoot(el)) {
        closedShadowRoots += 1;
      }
    }
  }
  return { roots, closedShadowRoots };
}

/**
 * There is no standard API to detect a closed shadow root. `attachShadow` on
 * an element that already has one throws, which is the only observable clue —
 * and calling it would mutate the page, so we only look for the marker some
 * libraries leave behind.
 */
function hasClosedShadowRoot(el: Element): boolean {
  return (el as Element & { __vfeClosedShadow?: boolean }).__vfeClosedShadow === true;
}

export function escapeId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(id);
  return id.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

/** Find an element by id in a root, then in the document (shadow-crossing). */
export function findByIdInRoots(id: string, root: Document | ShadowRoot): Element | null {
  const local = root.getElementById?.(id);
  if (local) return local;
  const { roots } = collectRoots(root);
  for (const candidateRoot of roots) {
    const found = candidateRoot.querySelector(`#${escapeId(id)}`);
    if (found) return found;
  }
  return null;
}
