import { describe, expect, it } from 'vitest';

import { ActionErrorCodeSchema, ActionResultSchema, ActionSchema, type Action } from '../actions';

const allKinds: Action[] = [
  { action: 'FILL', targetId: 'vfe_1', value: 'Alice' },
  { action: 'SELECT', targetId: 'vfe_5', value: 'CA' },
  { action: 'SET_CHECKED', targetId: 'vfe_7', checked: true },
  { action: 'CLICK', targetId: 'vfe_8' },
  { action: 'FOCUS', targetId: 'vfe_2' },
  { action: 'CLEAR', targetId: 'vfe_2' },
  { action: 'SCROLL', direction: 'bottom' },
  { action: 'ASK_CLARIFICATION', questionToUser: 'Which one?' },
];

describe('ActionSchema', () => {
  it('parses one action per kind', () => {
    for (const action of allKinds) {
      expect(ActionSchema.parse(action)).toEqual(action);
    }
  });

  it('rejects FILL without a value', () => {
    expect(ActionSchema.safeParse({ action: 'FILL', targetId: 'vfe_1' }).success).toBe(false);
  });

  it('rejects an invalid scroll direction', () => {
    expect(ActionSchema.safeParse({ action: 'SCROLL', direction: 'left' }).success).toBe(false);
  });

  it('rejects an unknown action', () => {
    expect(ActionSchema.safeParse({ action: 'SUBMIT', targetId: 'vfe_1' }).success).toBe(false);
  });

  it('rejects a non-boolean checked flag', () => {
    expect(
      ActionSchema.safeParse({ action: 'SET_CHECKED', targetId: 'vfe_7', checked: 'true' }).success,
    ).toBe(false);
  });

  it('rejects a clarification without a question', () => {
    expect(ActionSchema.safeParse({ action: 'ASK_CLARIFICATION' }).success).toBe(false);
  });
});

describe('ActionResultSchema', () => {
  it('defaults warnings to an empty array', () => {
    const parsed = ActionResultSchema.parse({
      action: allKinds[0],
      ok: true,
      durationMs: 12,
    });
    expect(parsed.warnings).toEqual([]);
  });

  it('carries a typed error with details', () => {
    const parsed = ActionResultSchema.parse({
      action: allKinds[0],
      ok: false,
      error: {
        code: 'ELEMENT_NOT_FOUND',
        message: 'No element with that id',
        details: { targetId: 'vfe_999' },
      },
      warnings: ['retried once'],
      durationMs: 3,
    });
    expect(parsed.error?.code).toBe('ELEMENT_NOT_FOUND');
    expect(parsed.error?.details).toEqual({ targetId: 'vfe_999' });
  });

  it('rejects an unknown error code', () => {
    const result = ActionResultSchema.safeParse({
      action: allKinds[0],
      ok: false,
      error: { code: 'KABOOM', message: 'x' },
      durationMs: 1,
    });
    expect(result.success).toBe(false);
  });

  it('declares the closed error-code set', () => {
    expect(ActionErrorCodeSchema.options).toEqual([
      'ELEMENT_NOT_FOUND',
      'ELEMENT_DISABLED',
      'ELEMENT_NOT_FILLABLE',
      'OPTION_NOT_FOUND',
      'VALUE_MISMATCH',
      'VALUE_INVALID',
      'TIMEOUT',
      'ABORTED',
    ]);
    for (const code of ActionErrorCodeSchema.options) {
      expect(ActionErrorCodeSchema.parse(code)).toBe(code);
    }
  });
});
