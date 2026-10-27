export type VisibilityReason =
  | 'display-none'
  | 'visibility-hidden'
  | 'opacity-0'
  | 'zero-size'
  | 'aria-hidden'
  | 'inert'
  | 'offscreen-honeypot'
  | 'content-visibility-hidden'
  | 'type-hidden'
  | 'detached'
  | 'max-elements';

export interface DiscoveredElement {
  /** Stable generated ID: `vfe_<n>`, monotonic per page load. */
  vfeId: string;
  /** Presentation number, recomputed in document order on every pass (1..N). */
  badgeIndex: number;
  element: HTMLElement;
  /** Lower-case tag name. */
  tag: string;
  /** `input.type`, or the ARIA role, or `null`. */
  htmlType: string | null;
  /**
   * True when the control itself is visually hidden (opacity/clip) but has a
   * visible `<label>` proxy — typical custom checkbox/radio markup.
   */
  viaProxy?: boolean;
}

export interface DiscoveryOptions {
  root?: Document | ShadowRoot;
  /** Hard cap for the number of returned elements. Default 250. */
  maxElements?: number;
  /** Include buttons / role=button. Default true. */
  includeButtons?: boolean;
  /** Include plain `a[href]` links (inside forms or marked data-vfe-link). Default false. */
  includeLinks?: boolean;
  /** Collect debug notes and exclusion reasons. Default false. */
  debug?: boolean;
}

export interface DebugInfo {
  /** Open shadow roots traversed. */
  shadowRoots: number;
  /** Closed shadow roots that cannot be traversed. */
  closedShadowRoots: number;
  /** Free-form notes for diagnostics. */
  notes: string[];
}

export interface DiscoveryResult {
  elements: DiscoveredElement[];
  excluded: Array<{ vfeId?: string; tag: string; reason: VisibilityReason }>;
  durationMs: number;
  debug?: DebugInfo;
}

export interface VisibilityResult {
  visible: boolean;
  reason?: VisibilityReason;
  viaProxy?: boolean;
}
