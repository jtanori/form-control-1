import { PageStateSchema } from '@vfe/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearVfeTags } from '../src/eyes/discover';
import {
  clearDistillState,
  distillPage,
  serializeElement,
  watchPage,
  type StateChange,
} from '../src/eyes/distill';

import { showAll } from './utils';

beforeEach(() => {
  clearVfeTags();
  clearDistillState();
});

afterEach(() => {
  clearVfeTags();
  clearDistillState();
});

describe('distillPage', () => {
  it('returns a schema-valid page state', () => {
    document.body.innerHTML = `
      <form>
        <label for="f">First Name</label>
        <input id="f" name="firstName" required />
        <label for="e">Email</label>
        <input id="e" type="email" />
        <button type="button">Continue</button>
      </form>`;
    showAll(document.body);

    const state = distillPage();

    expect(PageStateSchema.safeParse(state).success).toBe(true);
    expect(state.elements).toHaveLength(3);
    expect(state.elements.map((el) => el.id)).toEqual(['vfe_1', 'vfe_2', 'vfe_3']);
    expect(state.elements.map((el) => el.badgeIndex)).toEqual([1, 2, 3]);
    expect(state.urlOrAppTitle).toBeDefined();
  });

  it('serialises all twelve protocol types', () => {
    document.body.innerHTML = `
      <form>
        <input id="t" type="text" aria-label="Text" />
        <input id="em" type="email" aria-label="Email" />
        <input id="pw" type="password" aria-label="Password" />
        <input id="n" type="number" aria-label="Number" />
        <input id="tel" type="tel" aria-label="Phone" />
        <input id="d" type="date" aria-label="Date" />
        <textarea id="ta" aria-label="Notes"></textarea>
        <select id="s" aria-label="State"><option value="CA">California</option></select>
        <input id="cb" type="checkbox" aria-label="Terms" />
        <input id="r1" type="radio" name="ship" aria-label="Standard" checked />
        <button id="btn" type="button">Go</button>
        <div id="combo" role="combobox" aria-label="Country" aria-expanded="false"></div>
      </form>`;
    showAll(document.body);
    const state = distillPage();
    expect(state.elements.map((el) => el.type)).toEqual([
      'text',
      'email',
      'password',
      'number',
      'tel',
      'date',
      'textarea',
      'select',
      'checkbox',
      'radio',
      'button',
      'combobox',
    ]);
    expect(PageStateSchema.safeParse(state).success).toBe(true);
  });

  it('never leaks password values', () => {
    document.body.innerHTML = `
      <label for="pw">Password</label>
      <input id="pw" type="password" value="hunter2" />`;
    showAll(document.body);
    const state = distillPage();
    expect(state.elements[0]?.value).toBe('<redacted>');
    expect(JSON.stringify(state)).not.toContain('hunter2');
  });

  it('redacts an empty password as an empty string', () => {
    document.body.innerHTML = '<input id="pw" type="password" aria-label="Password" />';
    showAll(document.body);
    expect(distillPage().elements[0]?.value).toBe('');
  });

  it('omits values entirely in privacy mode', () => {
    document.body.innerHTML = `
      <input id="t" aria-label="Text" value="secret" />
      <input id="cb" type="checkbox" aria-label="Check" checked />
      <select id="m" multiple aria-label="Multi"><option selected>a</option></select>`;
    showAll(document.body);
    const state = distillPage({ includeValues: false });
    expect(state.elements[0]?.value).toBe('');
    expect(state.elements[1]?.value).toBe(false);
    expect(state.elements[2]?.value).toEqual([]);
  });

  it('serialises checkbox and radio semantics', () => {
    document.body.innerHTML = `
      <input id="cb" type="checkbox" aria-label="Terms" checked />
      <input id="r1" type="radio" name="ship" aria-label="Standard" checked />
      <input id="r2" type="radio" name="ship" aria-label="Express" />
      <div id="sw" role="switch" aria-label="Notifications" aria-checked="true"></div>`;
    showAll(document.body);
    const state = distillPage();
    expect(state.elements.map((el) => el.value)).toEqual([true, true, false, true]);
  });

  it('serialises select options and multi-select values', () => {
    document.body.innerHTML = `
      <select id="s" aria-label="State"><option value="CA">California</option><option value="TX">Texas</option></select>
      <select id="m" multiple aria-label="Interests"><option value="a" selected>Alpha</option><option value="b" selected>Beta</option></select>`;
    showAll(document.body);
    const state = distillPage();
    expect(state.elements[0]?.options).toEqual([
      { label: 'California', value: 'CA' },
      { label: 'Texas', value: 'TX' },
    ]);
    expect(state.elements[1]?.value).toEqual(['a', 'b']);
  });

  it('serialises a closed combobox with no options and an open one with options', () => {
    document.body.innerHTML = `
      <div id="closed" role="combobox" aria-label="Country" aria-expanded="false"></div>
      <div id="open" role="combobox" aria-label="State" aria-expanded="true">
        <div role="option" data-value="CA">California</div>
        <div role="option" data-value="TX">Texas</div>
      </div>`;
    showAll(document.body);
    const state = distillPage();
    expect(state.elements[0]?.options).toEqual([]);
    expect(state.elements[1]?.options).toEqual([
      { label: 'California', value: 'CA' },
      { label: 'Texas', value: 'TX' },
    ]);
  });

  it('maps role=option to a text element with the listbox label as group', () => {
    document.body.innerHTML = `
      <div role="listbox" aria-label="Country">
        <div role="option" id="o1">Canada</div>
      </div>`;
    showAll(document.body);
    const state = distillPage();
    const option = state.elements.find((el) => el.label === 'Canada');
    expect(option?.type).toBe('text');
    expect(option?.groupLabel).toBe('Country');
  });

  it('reports disabled via attribute, aria and fieldset', () => {
    document.body.innerHTML = `
      <input id="a" aria-label="A" disabled />
      <input id="b" aria-label="B" aria-disabled="true" />
      <fieldset disabled><input id="c" aria-label="C" /></fieldset>
      <input id="d" aria-label="D" />`;
    showAll(document.body);
    expect(distillPage().elements.map((el) => el.disabled)).toEqual([true, true, true, false]);
  });

  it('reports focus, including inside a shadow root', () => {
    document.body.innerHTML = '<div id="host"></div><input id="plain" aria-label="Plain" />';
    const shadow = (document.getElementById('host') as HTMLElement).attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input id="inner" aria-label="Inner" />';
    showAll(document.body);
    showAll(shadow);
    (shadow.getElementById('inner') as HTMLInputElement).focus();
    const state = distillPage();
    expect(state.elements.find((el) => el.label === 'Inner')?.focused).toBe(true);
  });

  it('collects page-level global errors but not field errors', () => {
    document.body.innerHTML = `
      <div role="alert">Your session expired</div>
      <div aria-live="assertive">Payment declined</div>
      <form>
        <div class="field"><input id="e" aria-label="Email" /><span role="alert">Email is required</span></div>
        <div class="error">Card number invalid</div>
      </form>`;
    showAll(document.body);
    const state = distillPage();
    expect(state.globalErrors).toContain('Your session expired');
    expect(state.globalErrors).toContain('Payment declined');
    expect(state.globalErrors).toContain('Card number invalid');
    expect(state.globalErrors).not.toContain('Email is required');
  });

  it('caps global errors at five', () => {
    document.body.innerHTML = Array.from(
      { length: 8 },
      (_, i) => `<div role="alert">Error ${i}</div>`,
    ).join('');
    showAll(document.body);
    expect(distillPage().globalErrors).toHaveLength(5);
  });

  it('serialises one element directly', () => {
    document.body.innerHTML = '<label for="x">Nickname</label><input id="x" value="Al" />';
    const el = document.getElementById('x') as HTMLElement;
    const model = serializeElement(el, 'vfe_9', 9);
    expect(model).toMatchObject({ id: 'vfe_9', badgeIndex: 9, label: 'Nickname', value: 'Al' });
  });

  it('falls back to the og:title and then the pathname', () => {
    document.title = '';
    document.head.innerHTML = '<meta property="og:title" content="Og Title" />';
    document.body.innerHTML = '<input aria-label="X" />';
    showAll(document.body);
    expect(distillPage().urlOrAppTitle).toBe('Og Title');

    document.head.innerHTML = '';
    expect(distillPage().urlOrAppTitle).toBe('/');
  });

  it('reuses the vfeId of a replaced node with the same logical identity', () => {
    document.body.innerHTML = '<input id="email" name="email" aria-label="Email" />';
    showAll(document.body);
    const first = distillPage();
    expect(first.elements[0]?.id).toBe('vfe_1');

    document.body.innerHTML = '<input id="email2" name="email" aria-label="Email" />';
    showAll(document.body);
    const second = distillPage();
    expect(second.elements[0]?.id).toBe('vfe_1');
  });

  it('distils 250 controls within the jsdom budget', () => {
    document.body.innerHTML = Array.from(
      { length: 250 },
      (_, i) => `<input aria-label="Field ${i}" name="f${i}" />`,
    ).join('');
    showAll(document.body);
    const started = performance.now();
    const state = distillPage();
    const duration = performance.now() - started;
    expect(state.elements).toHaveLength(250);
    expect(duration).toBeLessThan(1000);
  });
});

describe('watchPage', () => {
  it('fires when an input is appended', async () => {
    document.body.innerHTML = '<input id="a" aria-label="A" />';
    showAll(document.body);
    const changes: StateChange[] = [];
    const watcher = watchPage((change) => changes.push(change));
    watcher.start();
    try {
      const input = document.createElement('input');
      input.setAttribute('aria-label', 'B');
      document.body.append(input);
      showAll(document.body);
      await new Promise((resolve) => setTimeout(resolve, 260));
      expect(changes).toHaveLength(1);
      expect(changes[0]?.added).toHaveLength(1);
      expect(changes[0]?.reason).toBe('mutation');
    } finally {
      watcher.stop();
    }
  });

  it('does not fire for a no-op mutation', async () => {
    document.body.innerHTML = '<input id="a" aria-label="A" />';
    showAll(document.body);
    const changes: StateChange[] = [];
    const watcher = watchPage((change) => changes.push(change));
    watcher.start();
    try {
      document.body.setAttribute('data-unrelated', 'x');
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(changes).toHaveLength(0);
    } finally {
      watcher.stop();
    }
  });

  it('never fires from its own tagging writes', async () => {
    document.body.innerHTML = '<input aria-label="A" />';
    showAll(document.body);
    const changes: StateChange[] = [];
    const watcher = watchPage((change) => changes.push(change));
    watcher.start();
    try {
      distillPage();
      distillPage();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(changes).toHaveLength(0);
    } finally {
      watcher.stop();
    }
  });

  it('reports removed and updated fields', async () => {
    document.body.innerHTML = `
      <input id="a" aria-label="A" />
      <input id="b" aria-label="B" />`;
    showAll(document.body);
    const changes: StateChange[] = [];
    const watcher = watchPage((change) => changes.push(change));
    watcher.start();
    try {
      document.getElementById('b')?.remove();
      await new Promise((resolve) => setTimeout(resolve, 200));

      const a = document.getElementById('a') as HTMLInputElement;
      a.value = 'changed';
      a.setAttribute('value', 'changed');
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(changes.some((change) => change.removed.length === 1)).toBe(true);
      expect(changes.at(-1)?.updated.length).toBe(1);
    } finally {
      watcher.stop();
    }
  });

  it('observes mutations inside open shadow roots', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const shadow = (document.getElementById('host') as HTMLElement).attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input aria-label="Existing" />';
    showAll(document.body);
    showAll(shadow);
    const changes: StateChange[] = [];
    const watcher = watchPage((change) => changes.push(change));
    watcher.start();
    try {
      const input = document.createElement('input');
      input.setAttribute('aria-label', 'Shadow added');
      shadow.append(input);
      showAll(shadow);
      await new Promise((resolve) => setTimeout(resolve, 260));
      expect(changes).toHaveLength(1);
      expect(changes[0]?.added).toHaveLength(1);
    } finally {
      watcher.stop();
    }
  });

  it('refresh emits immediately with reason manual', () => {
    document.body.innerHTML = '<input aria-label="A" />';
    showAll(document.body);
    const changes: StateChange[] = [];
    const watcher = watchPage((change) => changes.push(change));
    const change = watcher.refresh();
    expect(change.reason).toBe('manual');
    expect(changes).toHaveLength(0);
    expect(watcher.current()?.elements).toHaveLength(1);
  });

  it('stops observing after stop()', async () => {
    document.body.innerHTML = '<input aria-label="A" />';
    showAll(document.body);
    const changes: StateChange[] = [];
    const watcher = watchPage((change) => changes.push(change));
    watcher.start();
    watcher.stop();
    document.body.append(document.createElement('input'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(changes).toHaveLength(0);
  });

  it('start is idempotent and stop is safe without start', () => {
    const watcher = watchPage(() => undefined);
    expect(() => {
      watcher.stop();
      watcher.start();
      watcher.start();
      watcher.stop();
    }).not.toThrow();
  });
});
