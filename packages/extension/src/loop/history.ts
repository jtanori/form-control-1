import type { Action, ActionResult, BrainResponse, ConversationTurn } from '@vfe/protocol';

/** INT-1 rule 1: 20 turns, 10 minute TTL, never raw page state. */
export const HISTORY_LIMIT = 20;
export const HISTORY_TTL_MS = 10 * 60_000;
export const MAX_TURN_CHARS = 4000;

export interface HistoryOptions {
  limit?: number;
  ttlMs?: number;
}

function clampText(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_TURN_CHARS ? `${clean.slice(0, MAX_TURN_CHARS - 1)}…` : clean;
}

/** Drop expired turns, keep the newest `limit` and never grow past the cap. */
export function pruneHistory(
  turns: ConversationTurn[],
  now: number,
  options: HistoryOptions = {},
): ConversationTurn[] {
  const limit = options.limit ?? HISTORY_LIMIT;
  const ttl = options.ttlMs ?? HISTORY_TTL_MS;
  const fresh = turns.filter((turn) => Number.isFinite(turn.at) && now - turn.at <= ttl);
  return fresh.slice(Math.max(0, fresh.length - limit));
}

export function appendTurn(
  turns: ConversationTurn[],
  role: ConversationTurn['role'],
  text: string,
  now: number,
  options: HistoryOptions = {},
): ConversationTurn[] {
  const clean = clampText(text);
  if (!clean) return pruneHistory(turns, now, options);
  return pruneHistory([...turns, { role, text: clean, at: now }], now, options);
}

const ACTION_VERBS: Record<Action['action'], string> = {
  FILL: 'filled',
  SELECT: 'selected in',
  SET_CHECKED: 'toggled',
  CLICK: 'clicked',
  FOCUS: 'focused',
  CLEAR: 'cleared',
  SCROLL: 'scrolled',
  ASK_CLARIFICATION: 'asked about',
};

/**
 * Compact, value-free summary of what the assistant did — this is what goes
 * back to the model, never field values or page text.
 */
export function summariseActions(
  response: BrainResponse,
  results: ActionResult[] = [],
  labels: Record<string, string> = {},
): string {
  const parts: string[] = [];
  for (const action of response.actions) {
    if (action.action === 'ASK_CLARIFICATION') {
      parts.push(`asked: ${clampText(action.questionToUser)}`);
      continue;
    }
    if (action.action === 'SCROLL') {
      parts.push(`scrolled ${action.direction}`);
      continue;
    }
    const label = labels[action.targetId] ?? action.targetId;
    parts.push(`${ACTION_VERBS[action.action]} ${label}`);
  }
  const failures = results.filter((result) => !result.ok);
  const summary = parts.length > 0 ? parts.join(', ') : 'nothing to do';
  return failures.length > 0
    ? `${summary} (${failures.length} failed: ${failures
        .map((failure) => failure.error?.code ?? 'ERROR')
        .join(', ')})`
    : summary;
}
