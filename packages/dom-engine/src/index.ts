export type { DistillOptions, PageWatcher, StateChange } from './eyes/distill';
export {
  BADGE_ATTRIBUTE,
  clearDistillState,
  diffPageStates,
  distillPage,
  serializeElement,
  watchPage,
} from './eyes/distill';
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
export { resolveValidationError } from './eyes/errors';
export { clearGroupCache, resolveGroupLabel } from './eyes/group';
export type { LabelSource, ResolvedContext } from './eyes/labels';
export { clearContextCache, labelOf, resolveContext } from './eyes/labels';
export { mapType, readOptions, readValue } from './eyes/serialize';
export { containsControl, hasRequiredMarker, isTextVisible, normaliseLabel } from './eyes/text';
export type { ControlOptions, OptionLike, OptionMatch } from './hands/controls';
export {
  clickElement,
  focusElement,
  matchOption,
  scrollPage,
  selectOption,
  setChecked,
} from './hands/controls';
export {
  activeElementAcrossRoots,
  isElementDisabled,
  isInViewport,
  setNativeChecked,
  setNativeValue,
  withElement,
} from './hands/element';
export type { ExecuteOptions, ExecutionReport } from './hands/execute';
export { executeActions } from './hands/execute';
export type { FillOptions } from './hands/fill';
export { clearValue, fillValue } from './hands/fill';
export type { Normalised } from './hands/normalise';
export { normaliseForElement, normaliseValue } from './hands/normalise';
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
