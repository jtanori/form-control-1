export {
  clearVfeTags,
  discoverInteractiveElements,
  exclusionReason,
  findByVfeId,
  VFE_BADGE_ATTRIBUTE,
  VFE_ID_ATTRIBUTE,
  VFE_TOUCHED_ATTRIBUTE,
  VFE_VIA_PROXY_ATTRIBUTE,
} from './eyes/discover';
export { collectRoots, escapeId, findByIdInRoots, isShadowRoot, parentOf } from './eyes/dom';
export type {
  DebugInfo,
  DiscoveredElement,
  DiscoveryOptions,
  DiscoveryResult,
  VisibilityReason,
  VisibilityResult,
} from './eyes/types';
export {
  createVisibilityContext,
  hasVisibleProxyLabel,
  isVisible,
  isVisibleWithContext,
} from './eyes/visibility';
export type { VisibilityContext } from './eyes/visibility';
