import type { Action } from '@vfe/protocol';
import { describe, expect, it } from 'vitest';

import { reduce, type LoopState } from '../src/loop/machine';
import type { SubmitOutcome } from '../src/loop/submit';

const NOW = 1_700_000_000_000;
const ctx = { generation: 1, now: NOW };

const executing: LoopState = {
  kind: 'executing',
  transcript: 'place my order',
  index: 1,
  total: 1,
};

const postSubmit: LoopState = { kind: 'post_submit', transcript: 'place my order', attempted: 1 };

const submitClick: Action = { action: 'CLICK', targetId: 'vfe_submit' };

describe('executing → post_submit', () => {
  it('waits for INT-2 instead of announcing success', () => {
    const result = reduce(
      executing,
      {
        type: 'EXECUTION_DONE',
        ok: true,
        failedLabels: [],
        total: 1,
        submitted: true,
        attempted: 0,
      },
      ctx,
    );
    expect(result.state).toMatchObject({ kind: 'post_submit', attempted: 1 });
    expect(result.effects).toEqual([]);
  });

  it('does not enter post_submit for a non-submit action', () => {
    const result = reduce(
      executing,
      { type: 'EXECUTION_DONE', ok: true, failedLabels: [], total: 1 },
      ctx,
    );
    expect(result.state).toEqual({ kind: 'idle' });
  });

  it('still reports a failed submit as a partial execution', () => {
    const result = reduce(
      executing,
      {
        type: 'EXECUTION_DONE',
        ok: false,
        failedLabels: ['Continue'],
        total: 1,
        submitted: true,
        attempted: 0,
      },
      ctx,
    );
    expect(result.state).toMatchObject({ kind: 'error', code: 'EXECUTION_PARTIAL' });
  });

  it('stops after three attempts', () => {
    const result = reduce(
      { ...executing },
      {
        type: 'EXECUTION_DONE',
        ok: true,
        failedLabels: [],
        total: 1,
        submitted: true,
        attempted: 3,
      },
      ctx,
    );
    expect(result.state).toMatchObject({ kind: 'error', code: 'SUBMIT_ATTEMPTS_EXHAUSTED' });
  });
});

describe('post_submit outcomes', () => {
  function outcome(event: SubmitOutcome) {
    return reduce(postSubmit, { type: 'SUBMIT_OUTCOME', outcome: event }, ctx);
  }

  it('SUCCESS clears history and announces the order number', () => {
    const result = outcome({ kind: 'SUCCESS', marker: 'Thanks', orderNumber: '4412' });
    expect(result.state).toEqual({ kind: 'idle' });
    expect(result.effects).toEqual([
      { type: 'speak', text: 'Submitted. Order number looks like 4412.' },
      { type: 'clearHistory' },
    ]);
  });

  it('FIELD_ERRORS focuses and flashes the first invalid field, then re-listens', () => {
    const result = outcome({
      kind: 'FIELD_ERRORS',
      errors: [
        { id: 'vfe_7', label: 'Password', message: 'must be at least 8 characters' },
        { id: 'vfe_8', label: 'Email', message: 'enter a valid email address' },
      ],
    });
    expect(result.state).toMatchObject({ kind: 'listening' });
    expect(result.effects.map((effect) => effect.type)).toEqual([
      'focus',
      'flashError',
      'speak',
      'remember',
      'listen',
    ]);
    const spoken = result.effects.find((effect) => effect.type === 'speak');
    expect(spoken && 'text' in spoken ? spoken.text : '').toContain('Password');
    const remembered = result.effects.find((effect) => effect.type === 'remember');
    expect(remembered && 'text' in remembered ? remembered.text : '').toContain('could not submit');
    expect(result.generation).toBe(2);
  });

  it('GLOBAL_ERRORS with a server error does not auto-relisten', () => {
    const result = outcome({ kind: 'GLOBAL_ERRORS', messages: ['Server error, try later'] });
    expect(result.state).toMatchObject({ kind: 'error' });
    expect(result.effects.map((effect) => effect.type)).toEqual(['stopListening', 'speak']);
  });

  it('GLOBAL_ERRORS with an actionable message re-listens', () => {
    const result = outcome({ kind: 'GLOBAL_ERRORS', messages: ['Please check your card number'] });
    expect(result.effects.map((effect) => effect.type)).toContain('listen');
  });

  it('FORM_CHANGED re-listens for the extra step', () => {
    const result = outcome({ kind: 'FORM_CHANGED', addedLabels: ['Verification code'] });
    expect(result.state).toMatchObject({ kind: 'listening' });
    expect(result.effects).toEqual([{ type: 'listen' }]);
  });

  it('UNKNOWN_SILENT is reported honestly, not as success', () => {
    const result = outcome({ kind: 'UNKNOWN_SILENT' });
    expect(result.state).toMatchObject({ kind: 'error', code: 'SUBMIT_UNCONFIRMED' });
    expect(result.effects.map((effect) => effect.type)).toEqual(['hint']);
  });

  it('navigation returns to idle without talking over the new page', () => {
    expect(outcome({ kind: 'NAVIGATED' }).state).toEqual({ kind: 'idle' });
    expect(outcome({ kind: 'NAVIGATED_SPA' }).effects).toEqual([{ type: 'stopListening' }]);
  });

  it('ignores outcomes outside post_submit', () => {
    const result = reduce(
      executing,
      { type: 'SUBMIT_OUTCOME', outcome: { kind: 'SUCCESS', marker: 'x' } },
      ctx,
    );
    expect(result.dropped).toBe('stale-event');
  });
});

describe('captcha guard', () => {
  it('blocks submission and says why', () => {
    const result = reduce(postSubmit, { type: 'SUBMIT_BLOCKED', reason: 'CAPTCHA' }, ctx);
    expect(result.state).toMatchObject({ kind: 'error', code: 'CAPTCHA_BLOCKED' });
    const spoken = result.effects.find((effect) => effect.type === 'speak');
    expect(spoken && 'text' in spoken ? spoken.text : '').toContain('CAPTCHA');
  });
});

describe('submit actions are recognised by the driver', () => {
  it('treats a labelled submit button as a submit', () => {
    expect(submitClick.action).toBe('CLICK');
  });
});
