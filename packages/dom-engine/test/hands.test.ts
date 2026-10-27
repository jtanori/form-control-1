import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normaliseValue } from '../src/hands/normalise';
import {
  clearValue,
  fillValue,
  focusElement,
  matchOption,
  scrollPage,
  selectOption,
  setChecked,
  clickElement,
} from '../src/index';

import { show } from './utils';

const EVENT_TYPES = [
  'focus',
  'focusin',
  'beforeinput',
  'keydown',
  'input',
  'keyup',
  'change',
  'blur',
  'focusout',
];

function mount(html: string): void {
  document.body.innerHTML = html;
}

function tag(id = 'vfe_1', selector = 'input'): HTMLElement {
  const el = document.querySelector(selector) as HTMLElement;
  el.setAttribute('data-vfe-id', id);
  show(el);
  return el;
}

function record(el: Element): Array<{ type: string; event: Event }> {
  const events: Array<{ type: string; event: Event }> = [];
  for (const type of EVENT_TYPES) {
    el.addEventListener(type, (event) => events.push({ type, event }));
  }
  return events;
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normaliseValue', () => {
  it.each([
    ['email', '  John@Example.COM ', 'John@example.com'],
    ['email', 'john@doe.com', 'john@doe.com'],
    ['number', '1,234.50', '1234.5'],
    ['number', '1200', '1200'],
    ['tel', '(555) 123-4567', '5551234567'],
    ['tel', '+1 (555) 123-4567', '+15551234567'],
    ['date', '1990-03-05', '1990-03-05'],
    ['date', '3/5/1990', '1990-03-05'],
    ['time', '9:05', '09:05'],
    ['url', 'example.com', 'https://example.com'],
    ['url', 'https://example.com/a', 'https://example.com/a'],
    ['text', '  keep spaces  ', '  keep spaces  '],
  ])('%s: %j → %j', (type, input, expected) => {
    expect(normaliseValue(type, input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['email', 'john doe@x.com'],
    ['email', 'not-an-email'],
    ['number', 'twelve'],
    ['tel', 'abc'],
    ['date', '1990-02-30'],
    ['date', 'tomorrow'],
    ['time', '25:00'],
    ['url', ''],
  ])('rejects %s: %j', (type, input) => {
    expect(normaliseValue(type, input)).toMatchObject({ ok: false, error: 'VALUE_INVALID' });
  });
});

describe('fillValue', () => {
  it('writes the value and dispatches the full event sequence', async () => {
    mount('<input id="f" name="firstName" />');
    const el = tag();
    const events = record(el);

    const result = await fillValue('vfe_1', 'Alice', { scroll: false, blur: true });

    expect(result.ok).toBe(true);
    expect((el as HTMLInputElement).value).toBe('Alice');
    const order = events.map((entry) => entry.type);
    expect(order.indexOf('beforeinput')).toBeLessThan(order.indexOf('input'));
    expect(order.indexOf('input')).toBeLessThan(order.indexOf('change'));
    expect(order).toContain('keydown');
    expect(order).toContain('keyup');
    expect(order).toContain('blur');
    expect(order).not.toContain('keypress');
    const inputEvent = events.find((entry) => entry.type === 'input')?.event as InputEvent;
    expect(inputEvent.inputType).toBe('insertText');
    expect(inputEvent.bubbles).toBe(true);
    expect(inputEvent.composed).toBe(true);
  });

  it('normalises email and number values', async () => {
    mount('<input id="e" type="email" /><input id="n" type="number" />');
    tag('vfe_1', '#e');
    tag('vfe_2', '#n');
    expect((await fillValue('vfe_1', ' A@B.com ', { scroll: false, blur: false })).ok).toBe(true);
    expect((await fillValue('vfe_2', '1,234.50', { scroll: false, blur: false })).ok).toBe(true);
    expect((document.getElementById('e') as HTMLInputElement).value).toBe('A@b.com');
    expect((document.getElementById('n') as HTMLInputElement).value).toBe('1234.5');
  });

  it('rejects an invalid email with VALUE_INVALID', async () => {
    mount('<input id="e" type="email" />');
    tag('vfe_1', '#e');
    const result = await fillValue('vfe_1', 'john doe@x.com', { scroll: false });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALUE_INVALID' } });
  });

  it('truncates at maxLength with a warning', async () => {
    mount('<input id="m" maxlength="3" />');
    tag('vfe_1', '#m');
    const result = await fillValue('vfe_1', 'abcdef', { scroll: false, blur: false });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain('MAXLENGTH_TRUNCATED');
    expect((document.getElementById('m') as HTMLInputElement).value).toBe('abc');
  });

  it('returns ELEMENT_NOT_FOUND for an unknown id', async () => {
    const result = await fillValue('vfe_404', 'x', { scroll: false });
    expect(result).toMatchObject({ ok: false, error: { code: 'ELEMENT_NOT_FOUND' } });
  });

  it('returns ELEMENT_DISABLED for disabled and read-only inputs', async () => {
    mount('<input id="d" disabled /><input id="r" readonly />');
    tag('vfe_1', '#d');
    tag('vfe_2', '#r');
    expect((await fillValue('vfe_1', 'x', { scroll: false })).error?.code).toBe('ELEMENT_DISABLED');
    expect((await fillValue('vfe_2', 'x', { scroll: false })).error?.code).toBe('ELEMENT_DISABLED');
  });

  it('returns ELEMENT_NOT_FILLABLE for selects and checkboxes', async () => {
    mount('<select id="s"><option>a</option></select><input id="c" type="checkbox" />');
    tag('vfe_1', '#s');
    tag('vfe_2', '#c');
    expect((await fillValue('vfe_1', 'a', { scroll: false })).error?.code).toBe(
      'ELEMENT_NOT_FILLABLE',
    );
    expect((await fillValue('vfe_2', 'x', { scroll: false })).error?.code).toBe(
      'ELEMENT_NOT_FILLABLE',
    );
  });

  it('fills a textarea', async () => {
    mount('<textarea id="t"></textarea>');
    const el = tag('vfe_1', '#t') as HTMLTextAreaElement;
    expect((await fillValue('vfe_1', 'multi\nline', { scroll: false, blur: false })).ok).toBe(true);
    expect(el.value).toBe('multi\nline');
  });

  it('fills contenteditable elements', async () => {
    mount('<div id="r" contenteditable="true"></div>');
    const el = tag('vfe_1', '#r');
    const result = await fillValue('vfe_1', 'Hello rich text', { scroll: false, blur: false });
    expect(result.ok).toBe(true);
    expect(el.textContent).toBe('Hello rich text');
  });

  it('emits one input event per character in keystrokes mode', async () => {
    mount('<input id="k" />');
    const el = tag('vfe_1', '#k');
    const events = record(el);
    const result = await fillValue('vfe_1', 'abc', {
      scroll: false,
      blur: false,
      keystrokes: true,
      keystrokeDelayMs: 0,
    });
    expect(result.ok).toBe(true);
    expect(events.filter((entry) => entry.type === 'input')).toHaveLength(3);
    expect((el as HTMLInputElement).value).toBe('abc');
  });

  it('does not log the filled value', async () => {
    mount('<input id="p" type="password" />');
    tag('vfe_1', '#p');
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    await fillValue('vfe_1', 'hunter2', { scroll: false, blur: false });
    for (const spy of spies) {
      expect(spy.mock.calls.flat().join(' ')).not.toContain('hunter2');
    }
  });
});

describe('clearValue', () => {
  it('clears inputs, textareas and contenteditable', async () => {
    mount(
      '<input id="i" value="x" /><textarea id="t">y</textarea><div id="c" contenteditable="true">z</div>',
    );
    tag('vfe_1', '#i');
    tag('vfe_2', '#t');
    tag('vfe_3', '#c');
    expect((await clearValue('vfe_1', { scroll: false })).ok).toBe(true);
    expect((await clearValue('vfe_2', { scroll: false })).ok).toBe(true);
    expect((await clearValue('vfe_3', { scroll: false })).ok).toBe(true);
    expect((document.getElementById('i') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('t') as HTMLTextAreaElement).value).toBe('');
    expect(document.getElementById('c')?.textContent).toBe('');
  });

  it('clears a native select', async () => {
    mount('<select id="s"><option value="a">A</option><option value="b">B</option></select>');
    const el = tag('vfe_1', '#s') as HTMLSelectElement;
    el.value = 'b';
    expect((await clearValue('vfe_1', { scroll: false })).ok).toBe(true);
    expect(el.selectedIndex).toBe(-1);
    expect(el.value).toBe('');
  });

  it('unchecks a checkbox through the setChecked alias', async () => {
    mount('<input id="c" type="checkbox" checked />');
    const el = tag('vfe_1', '#c') as HTMLInputElement;
    const result = await clearValue('vfe_1', { scroll: false });
    expect(result.ok).toBe(true);
    expect(el.checked).toBe(false);
  });
});

describe('matchOption', () => {
  const options = [
    { label: 'United States of America', value: 'US' },
    { label: 'Canada', value: 'CA' },
    { label: 'United Kingdom', value: 'GB' },
  ];

  it.each([
    ['US', 'United States of America'],
    ['us', 'United States of America'],
    ['United States of America', 'United States of America'],
    ['united states of america', 'United States of America'],
    ['usa', 'United States of America'],
    ['u.s.a.', 'United States of America'],
    ['canada', 'Canada'],
    ['Can', 'Canada'],
  ])('matches %j', (query, label) => {
    const match = matchOption(options, query);
    expect(match.ok && match.option.label).toBe(label);
  });

  it('accepts a unique levenshtein-1 typo', () => {
    const match = matchOption([{ label: 'California', value: 'CA' }], 'Californa');
    expect(match.ok && match.option.value).toBe('CA');
  });

  it('reports ambiguity instead of guessing', () => {
    const match = matchOption(
      [
        { label: 'United States', value: 'US' },
        { label: 'United Kingdom', value: 'GB' },
      ],
      'United',
    );
    expect(match).toMatchObject({ ok: false, reason: 'ambiguous' });
  });

  it('reports not-found', () => {
    expect(matchOption(options, 'Atlantis')).toMatchObject({ ok: false, reason: 'not-found' });
  });
});

describe('selectOption', () => {
  it('selects by value, label and normalised text', async () => {
    mount(`<select id="s">
      <option value="US">United States of America</option>
      <option value="CA">Canada</option>
    </select>`);
    const el = tag('vfe_1', '#s') as HTMLSelectElement;
    expect((await selectOption('vfe_1', 'Canada', { scroll: false })).ok).toBe(true);
    expect(el.value).toBe('CA');
    expect((await selectOption('vfe_1', 'usa', { scroll: false })).ok).toBe(true);
    expect(el.value).toBe('US');
  });

  it('returns OPTION_NOT_FOUND with the available options', async () => {
    mount('<select id="s"><option value="US">United States</option></select>');
    tag('vfe_1', '#s');
    const result = await selectOption('vfe_1', 'Atlantis', { scroll: false });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('OPTION_NOT_FOUND');
    expect(result.error?.details?.available).toEqual(['United States']);
  });

  it('adds to a multi-select', async () => {
    mount(`<select id="m" multiple>
      <option value="a">Alpha</option><option value="b">Beta</option>
    </select>`);
    const el = tag('vfe_1', '#m') as HTMLSelectElement;
    expect((await selectOption('vfe_1', 'Alpha', { scroll: false })).ok).toBe(true);
    expect(el.selectedOptions[0]?.value).toBe('a');
  });

  it('selects from an open ARIA listbox', async () => {
    mount(`
      <div id="combo" role="combobox" aria-label="Country" aria-expanded="true"></div>
      <div role="listbox">
        <div role="option" data-value="US">United States</div>
        <div role="option" data-value="CA">Canada</div>
      </div>`);
    const combo = tag('vfe_1', '#combo');
    for (const option of Array.from(document.querySelectorAll('[role="option"]'))) {
      option.addEventListener('click', () => {
        combo.textContent = option.textContent;
        combo.setAttribute('aria-expanded', 'false');
      });
    }
    const result = await selectOption('vfe_1', 'Canada', { scroll: false, openTimeoutMs: 50 });
    expect(result.ok).toBe(true);
    expect(combo.textContent).toContain('Canada');
  });
});

describe('setChecked', () => {
  it('checks a native checkbox and is idempotent', async () => {
    mount('<input id="c" type="checkbox" />');
    const el = tag('vfe_1', '#c') as HTMLInputElement;
    expect((await setChecked('vfe_1', true, { scroll: false })).ok).toBe(true);
    expect(el.checked).toBe(true);
    const second = await setChecked('vfe_1', true, { scroll: false });
    expect(second.ok).toBe(true);
    expect(second.warnings).toContain('NO_OP');
    expect(el.checked).toBe(true);
  });

  it('clicks the label proxy for a visually hidden checkbox', async () => {
    mount(`
      <input id="c" type="checkbox" />
      <label for="c" id="proxy">I agree</label>`);
    const input = document.getElementById('c') as HTMLInputElement;
    input.setAttribute('data-vfe-id', 'vfe_1');
    show(document.getElementById('proxy') as HTMLElement);
    const result = await setChecked('vfe_1', true, { scroll: false });
    expect(result.ok).toBe(true);
    expect(input.checked).toBe(true);
  });

  it('reports VALUE_MISMATCH when the site rejects the change', async () => {
    mount('<input id="c" type="checkbox" />');
    const el = tag('vfe_1', '#c') as HTMLInputElement;
    el.addEventListener('click', (event) => event.preventDefault());
    const result = await setChecked('vfe_1', true, { scroll: false });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALUE_MISMATCH' } });
  });
});

describe('clickElement and focusElement', () => {
  it('dispatches the full pointer sequence', async () => {
    mount('<button id="b" type="button">Go</button>');
    const el = tag('vfe_1', '#b');
    const seen: string[] = [];
    for (const type of [
      'pointerover',
      'pointerdown',
      'mousedown',
      'pointerup',
      'mouseup',
      'click',
    ]) {
      el.addEventListener(type, () => seen.push(type));
    }
    const result = await clickElement('vfe_1', { scroll: false });
    expect(result.ok).toBe(true);
    expect(seen).toEqual([
      'pointerover',
      'pointerdown',
      'mousedown',
      'pointerup',
      'mouseup',
      'click',
    ]);
  });

  it('marks a submit-like click with a NAVIGATION warning', async () => {
    mount('<button id="b" type="submit">Place order</button>');
    tag('vfe_1', '#b');
    const result = await clickElement('vfe_1', { scroll: false });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain('NAVIGATION');
  });

  it('refuses javascript: links', async () => {
    mount('<a id="a" href="javascript:alert(1)">x</a>');
    tag('vfe_1', '#a');
    const result = await clickElement('vfe_1', { scroll: false });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALUE_INVALID' } });
  });

  it('focuses an element and verifies the active element', async () => {
    mount('<input id="f" />');
    tag('vfe_1', '#f');
    expect((await focusElement('vfe_1', { scroll: false })).ok).toBe(true);
    expect(document.activeElement?.id).toBe('f');
  });
});

describe('scrollPage', () => {
  it('returns ok for every direction', async () => {
    for (const direction of ['up', 'down', 'top', 'bottom'] as const) {
      const result = await scrollPage(direction);
      expect(result.ok).toBe(true);
      expect(result.action).toEqual({ action: 'SCROLL', direction });
    }
  });
});
