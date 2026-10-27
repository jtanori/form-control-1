import { describe, expect, it } from 'vitest';

import {
  appendTurn,
  HISTORY_LIMIT,
  HISTORY_TTL_MS,
  pruneHistory,
  summariseActions,
} from '../src/loop/history';

const NOW = 1_700_000_000_000;

describe('conversation history', () => {
  it('caps at 20 turns, keeping the newest', () => {
    let turns = [] as ReturnType<typeof appendTurn>;
    for (let index = 0; index < 30; index += 1) {
      turns = appendTurn(turns, 'user', `turn ${index}`, NOW);
    }
    expect(turns).toHaveLength(HISTORY_LIMIT);
    expect(turns.at(-1)?.text).toBe('turn 29');
  });

  it('expires turns older than ten minutes', () => {
    const turns = appendTurn([], 'user', 'old', NOW - HISTORY_TTL_MS - 1);
    expect(pruneHistory(turns, NOW)).toEqual([]);
    const fresh = appendTurn([], 'user', 'new', NOW - 1000);
    expect(pruneHistory(fresh, NOW)).toHaveLength(1);
  });

  it('collapses whitespace and drops empty turns', () => {
    const turns = appendTurn([], 'user', '  fill   my\n name  ', NOW);
    expect(turns[0]?.text).toBe('fill my name');
    expect(appendTurn(turns, 'user', '   ', NOW)).toHaveLength(1);
  });

  it('truncates very long turns', () => {
    const turns = appendTurn([], 'user', 'a'.repeat(5000), NOW);
    expect(turns[0]?.text.length).toBeLessThanOrEqual(4000);
  });
});

describe('summariseActions', () => {
  it('describes actions without values', () => {
    const summary = summariseActions(
      {
        thoughtProcess: '',
        actions: [
          { action: 'FILL', targetId: 'vfe_1', value: 'Ada' },
          { action: 'CLICK', targetId: 'vfe_2' },
        ],
      },
      [],
      { vfe_1: 'Full name', vfe_2: 'Continue' },
    );
    expect(summary).toBe('filled Full name, clicked Continue');
    expect(summary).not.toContain('Ada');
  });

  it('notes clarifications and failures', () => {
    const summary = summariseActions(
      {
        thoughtProcess: '',
        actions: [{ action: 'ASK_CLARIFICATION', questionToUser: 'Which address?' }],
      },
      [
        {
          action: { action: 'FILL', targetId: 'vfe_1', value: 'x' },
          ok: false,
          warnings: [],
          durationMs: 1,
          error: { code: 'ELEMENT_NOT_FOUND', message: 'gone' },
        },
      ],
    );
    expect(summary).toContain('asked: Which address?');
    expect(summary).toContain('ELEMENT_NOT_FOUND');
  });
});
