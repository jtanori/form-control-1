import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearVfeTags,
  discoverInteractiveElements,
  findByVfeId,
  VFE_BADGE_ATTRIBUTE,
  VFE_ID_ATTRIBUTE,
} from '../src/eyes/discover';

import { byId, loadFixture, show, showAll, spyConsole } from './utils';

beforeEach(() => {
  clearVfeTags();
});

describe('discoverInteractiveElements', () => {
  it('finds visible inputs and a button, numbered 1..N in document order', () => {
    loadFixture('discovery/visible-basic.html');
    showAll(document.body);

    const result = discoverInteractiveElements();

    expect(result.elements.map((el) => el.htmlType)).toEqual(['text', 'text', 'email', 'button']);
    expect(result.elements.map((el) => el.badgeIndex)).toEqual([1, 2, 3, 4]);
    expect(result.elements.map((el) => el.vfeId)).toEqual(['vfe_1', 'vfe_2', 'vfe_3', 'vfe_4']);
    expect(
      result.elements.every((el) => el.element.getAttribute(VFE_ID_ATTRIBUTE) === el.vfeId),
    ).toBe(true);
    expect(byId('first').getAttribute(VFE_BADGE_ATTRIBUTE)).toBe('1');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('excludes every hidden pattern with the matching reason', () => {
    loadFixture('discovery/hidden-honeypot.html');
    show(byId('visible'));
    show(byId('offscreen'), { left: -9999 });
    show(byId('tiny'), { width: 1, height: 1 });

    const result = discoverInteractiveElements();

    expect(result.elements.map((el) => el.element.id)).toEqual(['visible']);
    expect(result.excluded.map((entry) => entry.reason).sort()).toEqual(
      [
        'display-none',
        'offscreen-honeypot',
        'opacity-0',
        'visibility-hidden',
        'zero-size',
        'zero-size',
      ].sort(),
    );
  });

  it('excludes descendants of aria-hidden sections even when they have size', () => {
    loadFixture('discovery/aria-hidden-section.html');
    showAll(document.body);
    const result = discoverInteractiveElements();
    expect(result.elements.map((el) => el.element.id)).toEqual(['outside']);
    expect(result.excluded).toContainEqual({ tag: 'input', reason: 'aria-hidden' });
  });

  it('excludes inert subtrees and includes them once inert is removed', () => {
    loadFixture('discovery/inert-modal.html');
    showAll(document.body);
    expect(discoverInteractiveElements().elements.map((el) => el.element.id)).toEqual(['outside']);

    byId('modal').removeAttribute('inert');
    (byId('modal') as HTMLElement & { inert: boolean }).inert = false;
    expect(discoverInteractiveElements().elements.map((el) => el.element.id)).toEqual([
      'inside-inert',
      'outside',
    ]);
  });

  it('discovers an input inside an open shadow root and tags it there', () => {
    loadFixture('discovery/shadow-host.html');
    const host = byId('host');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input id="shadow-input" name="inner" />';
    show(byId('light'));
    show(shadow.getElementById('shadow-input') as HTMLElement);

    const result = discoverInteractiveElements({ debug: true });

    expect(result.elements.map((el) => el.element.id)).toEqual(['light', 'shadow-input']);
    const shadowInput = shadow.getElementById('shadow-input') as HTMLElement;
    expect(shadowInput.getAttribute(VFE_ID_ATTRIBUTE)).toBe('vfe_2');
    expect(findByVfeId('vfe_2')).toBe(shadowInput);
    expect(result.debug?.shadowRoots).toBe(1);

    clearVfeTags();
    expect(shadowInput.hasAttribute(VFE_ID_ATTRIBUTE)).toBe(false);
    expect(byId('light').hasAttribute(VFE_ID_ATTRIBUTE)).toBe(false);
  });

  it('does not throw on a closed shadow root and reports it in debug mode', () => {
    loadFixture('discovery/shadow-closed-host.html');
    const host = byId('closed-host');
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = '<input id="secret" />';
    (host as HTMLElement & { __vfeClosedShadow?: boolean }).__vfeClosedShadow = true;

    expect(() => discoverInteractiveElements()).not.toThrow();
    const result = discoverInteractiveElements({ debug: true });
    expect(result.elements).toHaveLength(0);
    expect(result.debug?.closedShadowRoots).toBe(1);
  });

  it('discovers a field wrapped in display:contents', () => {
    loadFixture('discovery/display-contents.html');
    show(byId('wrapped'));
    const result = discoverInteractiveElements();
    expect(result.elements.map((el) => el.element.id)).toEqual(['wrapped']);
  });

  it('excludes descendants of an opacity:0 ancestor', () => {
    loadFixture('discovery/opacity-ancestor.html');
    show(byId('child'));
    show(byId('outside'));
    const result = discoverInteractiveElements();
    expect(result.elements.map((el) => el.element.id)).toEqual(['outside']);
    expect(result.excluded).toContainEqual({ tag: 'input', reason: 'opacity-0' });
  });

  it('hoists dialog controls before background controls', () => {
    loadFixture('discovery/modal-hoist.html');
    showAll(document.body);
    const result = discoverInteractiveElements();
    expect(result.elements.map((el) => el.element.id)).toEqual([
      'dialog-name',
      'dialog-close',
      'page-first',
      'page-second',
    ]);
    expect(result.elements.map((el) => el.badgeIndex)).toEqual([1, 2, 3, 4]);
  });

  it('keeps a script-hidden checkbox with a visible label', () => {
    loadFixture('discovery/hidden-native-checkbox.html');
    show(document.querySelector('label') as HTMLElement);
    const result = discoverInteractiveElements();
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]?.element.id).toBe('terms');
    expect(result.elements[0]?.viaProxy).toBe(true);
    expect(byId('terms').getAttribute('data-vfe-via-proxy')).toBe('true');
  });

  it('drops role=option outside a visible listbox', () => {
    loadFixture('discovery/role-option-closed.html');
    showAll(document.body);
    const result = discoverInteractiveElements();
    expect(result.elements.map((el) => el.element.id)).toEqual(['visible']);
    expect(result.excluded.filter((entry) => entry.reason === 'type-hidden')).toHaveLength(2);
  });

  it('keeps role=option inside a visible listbox', () => {
    document.body.innerHTML = `
      <div role="listbox" id="listbox">
        <div role="option" id="opt-1">California</div>
        <div role="option" id="opt-2">Texas</div>
      </div>`;
    showAll(document.body);
    const result = discoverInteractiveElements();
    expect(result.elements.map((el) => el.element.id)).toEqual(['listbox', 'opt-1', 'opt-2']);
  });

  it('discovers children of a disabled fieldset (A-3 reports disabled)', () => {
    loadFixture('discovery/disabled-fieldset.html');
    showAll(document.body);
    const result = discoverInteractiveElements();
    expect(result.elements.map((el) => el.element.id)).toEqual(['address', 'country']);
  });

  it('keeps IDs stable and badge numbers refreshed across passes', () => {
    loadFixture('discovery/visible-basic.html');
    showAll(document.body);
    const first = discoverInteractiveElements();
    const second = discoverInteractiveElements();

    expect(second.elements.map((el) => el.vfeId)).toEqual(first.elements.map((el) => el.vfeId));
    expect(second.elements.map((el) => el.badgeIndex)).toEqual([1, 2, 3, 4]);
    expect(byId('first').getAttribute(VFE_ID_ATTRIBUTE)).toBe('vfe_1');
  });

  it('reuses an id that already exists on the node', () => {
    document.body.innerHTML = '<input id="x" data-vfe-id="vfe_42" />';
    show(byId('x'));
    const result = discoverInteractiveElements();
    expect(result.elements[0]?.vfeId).toBe('vfe_42');
    expect(byId('x').getAttribute(VFE_ID_ATTRIBUTE)).toBe('vfe_42');
  });

  it('caps discovery at maxElements and records the reason', () => {
    document.body.innerHTML = Array.from({ length: 300 }, (_, i) => `<input id="i${i}" />`).join(
      '',
    );
    showAll(document.body);

    const result = discoverInteractiveElements({ maxElements: 250 });

    expect(result.elements).toHaveLength(250);
    expect(result.elements.at(-1)?.element.id).toBe('i249');
    expect(result.excluded).toContainEqual({ tag: 'input', reason: 'max-elements' });
  });

  it('respects includeButtons=false', () => {
    loadFixture('discovery/visible-basic.html');
    showAll(document.body);
    const result = discoverInteractiveElements({ includeButtons: false });
    expect(result.elements.map((el) => el.tag)).not.toContain('button');
  });

  it('only discovers links inside forms unless marked', () => {
    document.body.innerHTML = `
      <a href="/outside" id="outside-link">Outside</a>
      <form><a href="/inside" id="inside-link">Inside</a></form>
      <a href="/marked" id="marked-link" data-vfe-link>Marked</a>`;
    showAll(document.body);
    expect(discoverInteractiveElements().elements.map((el) => el.element.id)).toEqual([
      'marked-link',
    ]);
    expect(
      discoverInteractiveElements({ includeLinks: true }).elements.map((el) => el.element.id),
    ).toEqual(['inside-link', 'marked-link']);
  });

  it('honours data-vfe-ignore', () => {
    document.body.innerHTML = '<input id="ignored" data-vfe-ignore /><input id="kept" />';
    showAll(document.body);
    const result = discoverInteractiveElements({ debug: true });
    expect(result.elements.map((el) => el.element.id)).toEqual(['kept']);
    expect(result.debug?.notes).toEqual(['ignored input (data-vfe-ignore)']);
  });

  it('excludes non-actionable input types as type-hidden', () => {
    document.body.innerHTML = `
      <input id="hidden" type="hidden" value="x" />
      <input id="file" type="file" />
      <input id="submit" type="submit" />
      <input id="reset" type="reset" />
      <input id="image" type="image" />
      <input id="button" type="button" value="OK" />`;
    showAll(document.body);
    const result = discoverInteractiveElements();
    expect(result.elements.map((el) => el.element.id)).toEqual(['button']);
    expect(result.excluded.filter((e) => e.reason === 'type-hidden')).toHaveLength(5);
  });

  it('includes contenteditable elements only when editable', () => {
    document.body.innerHTML = `
      <div id="editable" contenteditable="true">x</div>
      <div id="editable-empty" contenteditable>x</div>
      <div id="readonly" contenteditable="false">x</div>`;
    showAll(document.body);
    const result = discoverInteractiveElements();
    expect(result.elements.map((el) => el.element.id)).toEqual(['editable', 'editable-empty']);
    expect(result.elements.map((el) => el.htmlType)).toEqual(['textbox', 'textbox']);
  });

  it('returns exclusion reasons in debug mode without logging', () => {
    loadFixture('discovery/hidden-honeypot.html');
    show(byId('visible'));
    show(byId('offscreen'), { left: -9999 });
    show(byId('tiny'), { width: 1, height: 1 });
    const spy = spyConsole();
    try {
      const result = discoverInteractiveElements({ debug: true });
      expect(result.excluded.length).toBeGreaterThan(0);
      expect(result.debug?.notes).toEqual([]);
    } finally {
      spy.restore();
    }
    expect(spy.calls).toEqual([]);
  });

  it('discovers 500 controls without super-linear blow-up in jsdom', () => {
    document.body.innerHTML = `<form>${Array.from(
      { length: 500 },
      (_, i) => `<input id="s${i}" />`,
    ).join('')}</form>`;
    showAll(document.body);
    const result = discoverInteractiveElements({ maxElements: 600 });
    expect(result.elements).toHaveLength(500);
    // Wall-clock guard only: shared CI runners are noisy, so this catches a
    // pathological O(n²) regression rather than policing milliseconds.
    expect(result.durationMs).toBeLessThan(2000);
  });
});

describe('findByVfeId', () => {
  it('returns null for unknown ids', () => {
    expect(findByVfeId('vfe_999')).toBeNull();
  });
});

describe('clearVfeTags', () => {
  it('removes only engine-owned attributes', () => {
    document.body.innerHTML = '<input id="x" data-vfe-ignore />';
    show(byId('x'));
    discoverInteractiveElements();
    clearVfeTags();
    expect(byId('x').getAttribute(VFE_ID_ATTRIBUTE)).toBeNull();
    expect(byId('x').getAttribute(VFE_BADGE_ATTRIBUTE)).toBeNull();
    expect(byId('x').hasAttribute('data-vfe-ignore')).toBe(true);
  });
});
