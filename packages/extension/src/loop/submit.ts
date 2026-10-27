import type { PageState } from '@vfe/protocol';

/** What actually happened after a submit-ish click (INT-2 §1). */
export type SubmitOutcome =
  | { kind: 'SUCCESS'; marker: string; orderNumber?: string }
  | { kind: 'FIELD_ERRORS'; errors: Array<{ id: string; label: string; message: string }> }
  | { kind: 'GLOBAL_ERRORS'; messages: string[] }
  | { kind: 'FORM_CHANGED'; addedLabels: string[] }
  | { kind: 'NAVIGATED' }
  | { kind: 'NAVIGATED_SPA' }
  | { kind: 'UNKNOWN_SILENT' };

export interface SubmitSnapshot {
  pageState: PageState;
  url: string;
  /** Text of banners/alerts/headings that look like a confirmation. */
  successText: string[];
  /** True when the document itself was replaced (pagehide/navigation). */
  navigated: boolean;
}

const SUCCESS_MARKER =
  /thank|success|confirmed|order\s*(number|#|no)?|received|submitted|signed in|complete/i;

export function isSubmitLikeText(text: string): boolean {
  return /submit|continue|next|sign ?in|log ?in|pay|place order|save|send/i.test(text);
}

/** Order numbers are read out only when they are unambiguous ("#4412"). */
export function findOrderNumber(texts: string[]): string | undefined {
  for (const text of texts) {
    const match = /(?:order|reference|confirmation)\s*(?:number|no\.?|#)?\s*[:#]?\s*(\d{3,})/i.exec(
      text,
    );
    if (match?.[1]) return match[1];
    const hash = /#\s*(\d{3,})/.exec(text);
    if (hash?.[1]) return hash[1];
  }
  return undefined;
}

function labelsOf(pageState: PageState): Map<string, string> {
  return new Map(pageState.elements.map((element) => [element.id, element.label]));
}

function formatLabel(label: string): string {
  return label.length > 48 ? `${label.slice(0, 47)}…` : label;
}

/** Pure diff of two page states → the INT-2 outcome. */
export function classifySubmitOutcome(prev: PageState, next: SubmitSnapshot): SubmitOutcome {
  if (next.navigated) return { kind: 'NAVIGATED' };
  if (prev.urlOrAppTitle && next.pageState.urlOrAppTitle !== prev.urlOrAppTitle) {
    return { kind: 'NAVIGATED_SPA' };
  }

  const previous = new Map(prev.elements.map((element) => [element.id, element]));
  const fieldErrors: Array<{ id: string; label: string; message: string }> = [];
  for (const element of next.pageState.elements) {
    const before = previous.get(element.id);
    if (element.validationError && element.validationError !== before?.validationError) {
      fieldErrors.push({
        id: element.id,
        label: formatLabel(element.label || element.id),
        message: element.validationError,
      });
    }
  }
  if (fieldErrors.length > 0) return { kind: 'FIELD_ERRORS', errors: fieldErrors };

  const previousGlobal = new Set(prev.globalErrors ?? []);
  const globalErrors = (next.pageState.globalErrors ?? []).filter(
    (message) => !previousGlobal.has(message),
  );
  if (globalErrors.length > 0) return { kind: 'GLOBAL_ERRORS', messages: globalErrors };

  const markers = next.successText.filter((text) => SUCCESS_MARKER.test(text));
  if (markers.length > 0) {
    const marker = markers[0] ?? '';
    const orderNumber = findOrderNumber(markers);
    return {
      kind: 'SUCCESS',
      marker: formatLabel(marker),
      ...(orderNumber ? { orderNumber } : {}),
    };
  }

  const added = next.pageState.elements.filter((element) => !previous.has(element.id));
  if (added.length > 0) {
    return {
      kind: 'FORM_CHANGED',
      addedLabels: added.slice(0, 3).map((element) => formatLabel(element.label || element.id)),
    };
  }

  // A form that disappeared without a banner is still a success signal.
  if (prev.elements.length > 0 && next.pageState.elements.length === 0) {
    return { kind: 'SUCCESS', marker: 'The form is gone' };
  }

  return { kind: 'UNKNOWN_SILENT' };
}

export interface ObserveDeps {
  prev: PageState;
  snapshot: () => SubmitSnapshot;
  sleep: (ms: number) => Promise<void>;
  /** Total observation window. Default 2000 ms. */
  maxWaitMs?: number;
  /** Sampling interval. Default 100 ms. */
  pollMs?: number;
  now?: () => number;
}

/**
 * Wait for a decisive signal, then stop. Slow validations (900 ms) are caught;
 * a totally silent page resolves to `UNKNOWN_SILENT` at the end of the window.
 */
export async function observeSubmit(deps: ObserveDeps): Promise<SubmitOutcome> {
  const maxWaitMs = deps.maxWaitMs ?? 2000;
  const pollMs = deps.pollMs ?? 100;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  let last: SubmitOutcome = { kind: 'UNKNOWN_SILENT' };

  for (;;) {
    const snapshot = deps.snapshot();
    last = classifySubmitOutcome(deps.prev, snapshot);
    if (last.kind !== 'UNKNOWN_SILENT') return last;
    if (now() - startedAt >= maxWaitMs) return last;
    await deps.sleep(pollMs);
  }
}

const URL_PATTERN = /\bhttps?:\/\/\S+/gi;
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

/** TTS-safe text: no URLs, markup, emoji, control characters; ≤ 140 chars. */
export function sanitiseSpeech(text: string, maxChars = 140): string {
  let clean = text
    .replace(URL_PATTERN, 'the link on screen')
    .replace(/<[^>]*>/g, ' ')
    .replace(EMOJI_PATTERN, ' ')
    .replace(/[*_`~!]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length > maxChars) {
    clean = `${clean.slice(0, maxChars - 1).trimEnd()}…`;
  }
  return clean;
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** One spoken sentence per outcome, never containing a field value. */
export function spokenForOutcome(outcome: SubmitOutcome): string {
  switch (outcome.kind) {
    case 'SUCCESS':
      return sanitiseSpeech(
        outcome.orderNumber
          ? `Submitted. Order number looks like ${outcome.orderNumber}.`
          : 'Submitted.',
      );
    case 'FIELD_ERRORS': {
      const spoken = outcome.errors
        .slice(0, 2)
        .map((error) => `${error.label}: ${error.message}`)
        .join('. ');
      const remaining = outcome.errors.length - 2;
      const tail = remaining > 0 ? ` and ${remaining} more` : '';
      return sanitiseSpeech(`The form couldn't submit: ${spoken}${tail}.`);
    }
    case 'GLOBAL_ERRORS':
      return sanitiseSpeech(
        `The form couldn't submit: ${outcome.messages[0] ?? 'something went wrong'}.`,
      );
    case 'FORM_CHANGED':
      return sanitiseSpeech(`The form needs one more thing: ${joinNames(outcome.addedLabels)}.`);
    case 'UNKNOWN_SILENT':
      return sanitiseSpeech("I clicked submit but I'm not sure it went through.");
    case 'NAVIGATED':
    case 'NAVIGATED_SPA':
      return '';
  }
}

/** Errors that no amount of talking can fix ("server error", "try later"). */
export function isActionableMessage(message: string): boolean {
  return !/server|unavailable|try again later|try later|maintenance|something went wrong/i.test(
    message,
  );
}

/** The conversation turn the repair loop adds before re-listening. */
export function repairHistoryText(outcome: SubmitOutcome): string {
  if (outcome.kind === 'FIELD_ERRORS') {
    return `The form could not submit. ${outcome.errors
      .slice(0, 3)
      .map((error) => `${error.label}: ${error.message}`)
      .join('. ')}`;
  }
  if (outcome.kind === 'GLOBAL_ERRORS') {
    return `The form could not submit. ${outcome.messages[0] ?? ''}`;
  }
  if (outcome.kind === 'FORM_CHANGED') {
    return `The form needs one more thing: ${joinNames(outcome.addedLabels)}`;
  }
  return spokenForOutcome(outcome);
}

/** CAPTCHA probes, run before any submit click (INT-2 guard rail). */
export const CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '[data-sitekey]',
  '#g-recaptcha',
  '[class*="captcha"]',
];

export function detectCaptcha(doc: Document): string | null {
  for (const selector of CAPTCHA_SELECTORS) {
    const found = doc.querySelector(selector);
    if (found) return selector;
  }
  return null;
}

/** Labels for a page state, used by the driver when focusing errors. */
export function firstErrorElement(outcome: SubmitOutcome): string | null {
  if (outcome.kind === 'FIELD_ERRORS') return outcome.errors[0]?.id ?? null;
  return null;
}

export function labelsById(pageState: PageState): Record<string, string> {
  return Object.fromEntries(labelsOf(pageState));
}
