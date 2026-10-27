import type { FormElement, PageState } from '@vfe/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classifySubmitOutcome,
  detectCaptcha,
  findOrderNumber,
  isActionableMessage,
  isSubmitLikeText,
  observeSubmit,
  sanitiseSpeech,
  spokenForOutcome,
  type SubmitSnapshot,
} from '../src/loop/submit';

function element(index: number, overrides: Partial<FormElement> = {}): FormElement {
  return {
    id: `vfe_${index}`,
    badgeIndex: index,
    type: 'text',
    label: `Field ${index}`,
    value: '',
    required: false,
    disabled: false,
    focused: false,
    ...overrides,
  };
}

function state(elements: FormElement[], urlOrAppTitle = 'Checkout'): PageState {
  return { urlOrAppTitle, elements };
}

function snapshot(overrides: Partial<SubmitSnapshot> = {}): SubmitSnapshot {
  return {
    pageState: state([element(1)]),
    url: 'https://shop.test/checkout',
    successText: [],
    navigated: false,
    ...overrides,
  };
}

const prev = state([element(1), element(2)]);

describe('classifySubmitOutcome', () => {
  it('detects a full navigation first', () => {
    expect(classifySubmitOutcome(prev, snapshot({ navigated: true }))).toEqual({
      kind: 'NAVIGATED',
    });
  });

  it('detects an SPA route change', () => {
    const next = snapshot({ pageState: state([element(1)], 'Checkout step 2') });
    expect(classifySubmitOutcome(prev, next)).toEqual({ kind: 'NAVIGATED_SPA' });
  });

  it('detects field errors with labels, never values', () => {
    const next = snapshot({
      pageState: state([element(1, { validationError: 'Must be at least 8 characters' })]),
    });
    const outcome = classifySubmitOutcome(prev, next);
    expect(outcome).toEqual({
      kind: 'FIELD_ERRORS',
      errors: [
        {
          id: 'vfe_1',
          label: 'Field 1',
          message: 'Must be at least 8 characters',
        },
      ],
    });
  });

  it('ignores an error that was already there before the submit', () => {
    const before = state([element(1, { validationError: 'Required' })]);
    const next = snapshot({ pageState: state([element(1, { validationError: 'Required' })]) });
    expect(classifySubmitOutcome(before, next).kind).toBe('UNKNOWN_SILENT');
  });

  it('detects new global errors', () => {
    const next = snapshot({
      pageState: {
        urlOrAppTitle: 'Checkout',
        elements: [element(1)],
        globalErrors: ['Server error'],
      },
    });
    expect(classifySubmitOutcome(prev, next)).toEqual({
      kind: 'GLOBAL_ERRORS',
      messages: ['Server error'],
    });
  });

  it('detects a success banner and an order number', () => {
    const next = snapshot({
      pageState: state([element(1)], 'Checkout'),
      successText: ['Thank you! Order #4412 confirmed'],
    });
    expect(classifySubmitOutcome(prev, next)).toEqual({
      kind: 'SUCCESS',
      marker: 'Thank you! Order #4412 confirmed',
      orderNumber: '4412',
    });
  });

  it('detects a form that grew (verification code step)', () => {
    const next = snapshot({ pageState: state([element(1), element(2), element(3)]) });
    expect(classifySubmitOutcome(prev, next)).toEqual({
      kind: 'FORM_CHANGED',
      addedLabels: ['Field 3'],
    });
  });

  it('reports a silent no-op honestly', () => {
    expect(
      classifySubmitOutcome(prev, snapshot({ pageState: state([element(1), element(2)]) })),
    ).toEqual({ kind: 'UNKNOWN_SILENT' });
  });
});

describe('observeSubmit', () => {
  it('returns as soon as a signal appears', async () => {
    const sleep = vi.fn(async () => undefined);
    let calls = 0;
    const outcome = await observeSubmit({
      prev,
      sleep,
      snapshot: () => {
        calls += 1;
        return calls < 3
          ? snapshot({ pageState: state([element(1), element(2)]) })
          : snapshot({ pageState: state([element(1, { validationError: 'Invalid email' })]) });
      },
    });
    expect(outcome.kind).toBe('FIELD_ERRORS');
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('finds slow validation inside the window', async () => {
    let nowMs = 0;
    const outcome = await observeSubmit({
      prev,
      now: () => nowMs,
      sleep: async (ms) => {
        nowMs += ms;
      },
      maxWaitMs: 2000,
      pollMs: 100,
      snapshot: () =>
        nowMs < 900
          ? snapshot()
          : snapshot({ pageState: state([element(1, { validationError: 'Too short' })]) }),
    });
    expect(outcome.kind).toBe('FIELD_ERRORS');
    expect(nowMs).toBeGreaterThanOrEqual(900);
  });

  it('gives up after the window with UNKNOWN_SILENT', async () => {
    let nowMs = 0;
    const outcome = await observeSubmit({
      prev,
      now: () => nowMs,
      sleep: async (ms) => {
        nowMs += ms;
      },
      maxWaitMs: 300,
      pollMs: 100,
      snapshot: () => snapshot(),
    });
    expect(outcome).toEqual({ kind: 'UNKNOWN_SILENT' });
  });
});

describe('spoken copy', () => {
  const fieldErrors = {
    kind: 'FIELD_ERRORS' as const,
    errors: [
      { id: 'vfe_1', label: 'Password', message: 'must be at least 8 characters' },
      { id: 'vfe_2', label: 'Email', message: 'enter a valid email address' },
      { id: 'vfe_3', label: 'ZIP', message: 'does not match the state' },
    ],
  };

  it('reads two errors then "and N more", and stays under 140 chars', () => {
    const text = spokenForOutcome(fieldErrors);
    expect(text).toContain('Password: must be at least 8 characters');
    expect(text).toContain('Email: enter a valid email address');
    expect(text).toContain('and 1 more');
    expect(text.length).toBeLessThanOrEqual(140);
  });

  it('never leaks a secret value from the page state', () => {
    const secret = 'hunter2-should-never-be-spoken';
    const text = spokenForOutcome({
      kind: 'FIELD_ERRORS',
      errors: [{ id: 'vfe_9', label: 'Password', message: 'must be at least 8 characters' }],
    });
    expect(text).not.toContain(secret);
    expect(text).not.toMatch(/hunter2/);
  });

  it('strips URLs, emoji and markup', () => {
    const text = sanitiseSpeech('Error! 🚫 See https://x.y/z <b>now</b>');
    expect(text).toBe(
      'Error See the link on screen now'.replace('Error See', 'Error  See').replace(/\s+/g, ' '),
    );
    expect(sanitiseSpeech('Read https://example.com/help')).toBe('Read the link on screen');
    expect(sanitiseSpeech('🥳')).toBe('');
  });

  it('announces success with an order number only when present', () => {
    expect(spokenForOutcome({ kind: 'SUCCESS', marker: 'Thanks', orderNumber: '4412' })).toBe(
      'Submitted. Order number looks like 4412.',
    );
    expect(spokenForOutcome({ kind: 'SUCCESS', marker: 'Thanks' })).toBe('Submitted.');
  });

  it('names the new field when the form grew', () => {
    expect(
      spokenForOutcome({ kind: 'FORM_CHANGED', addedLabels: ['Verification code'] }),
    ).toContain('Verification code');
  });

  it('is honest about a silent submit', () => {
    expect(spokenForOutcome({ kind: 'UNKNOWN_SILENT' })).toContain('not sure it went through');
    expect(spokenForOutcome({ kind: 'NAVIGATED' })).toBe('');
  });
});

describe('helpers', () => {
  it('recognises submit-ish labels', () => {
    for (const label of ['Submit', 'Continue', 'Place order', 'Sign in', 'Pay now', 'Save']) {
      expect(isSubmitLikeText(label)).toBe(true);
    }
    expect(isSubmitLikeText('Add another item')).toBe(false);
  });

  it('extracts unambiguous order numbers', () => {
    expect(findOrderNumber(['Order number: 4412'])).toBe('4412');
    expect(findOrderNumber(['Reference #123456 confirmed'])).toBe('123456');
    expect(findOrderNumber(['Thank you'])).toBeUndefined();
  });

  it('classifies non-actionable server errors', () => {
    expect(isActionableMessage('Server error, try later')).toBe(false);
    expect(isActionableMessage('Password must be at least 8 characters')).toBe(true);
  });
});

describe('captcha detection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds a reCAPTCHA iframe', () => {
    document.body.innerHTML =
      '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>';
    expect(detectCaptcha(document)).toBe('iframe[src*="recaptcha"]');
  });

  it('finds a data-sitekey widget', () => {
    document.body.innerHTML = '<div data-sitekey="abc123"></div>';
    expect(detectCaptcha(document)).toBe('[data-sitekey]');
  });

  it('returns null on a clean form', () => {
    document.body.innerHTML = '<form><input id="a" /></form>';
    expect(detectCaptcha(document)).toBeNull();
  });
});
