import { describe, expect, it } from 'vitest';

import { isVisible } from '../src/eyes/visibility';

import { byId, loadFixture, show } from './utils';

describe('isVisible', () => {
  it('reports a laid-out element as visible', () => {
    loadFixture('discovery/visible-basic.html');
    show(byId('first'));
    expect(isVisible(byId('first'))).toEqual({ visible: true });
  });

  it('excludes detached nodes', () => {
    const input = document.createElement('input');
    expect(isVisible(input)).toEqual({ visible: false, reason: 'detached' });
  });

  it('excludes display:none', () => {
    loadFixture('discovery/hidden-honeypot.html');
    expect(isVisible(byId('display-none'))).toEqual({ visible: false, reason: 'display-none' });
  });

  it('excludes visibility:hidden and collapse', () => {
    loadFixture('discovery/hidden-honeypot.html');
    expect(isVisible(byId('visibility-hidden'))).toEqual({
      visible: false,
      reason: 'visibility-hidden',
    });
    const collapse = document.createElement('input');
    document.body.append(collapse);
    show(collapse, { visibility: 'collapse' });
    expect(isVisible(collapse).reason).toBe('visibility-hidden');
  });

  it('excludes content-visibility:hidden', () => {
    document.body.innerHTML = '<input id="cv" />';
    show(byId('cv'), { contentVisibility: 'hidden' });
    expect(isVisible(byId('cv'))).toEqual({
      visible: false,
      reason: 'content-visibility-hidden',
    });
  });

  it('excludes opacity:0 on self and on an ancestor', () => {
    loadFixture('discovery/opacity-ancestor.html');
    show(byId('child'));
    show(byId('outside'));
    expect(isVisible(byId('child'))).toEqual({ visible: false, reason: 'opacity-0' });
    expect(isVisible(byId('outside')).visible).toBe(true);

    loadFixture('discovery/hidden-honeypot.html');
    expect(isVisible(byId('opacity-zero')).reason).toBe('opacity-0');
  });

  it('excludes aria-hidden and inert ancestors', () => {
    loadFixture('discovery/aria-hidden-section.html');
    show(byId('inside-hidden'));
    show(byId('outside'));
    expect(isVisible(byId('inside-hidden'))).toEqual({ visible: false, reason: 'aria-hidden' });

    loadFixture('discovery/inert-modal.html');
    show(byId('inside-inert'));
    expect(isVisible(byId('inside-inert'))).toEqual({ visible: false, reason: 'inert' });

    byId('modal').removeAttribute('inert');
    (byId('modal') as HTMLElement & { inert: boolean }).inert = false;
    expect(isVisible(byId('inside-inert')).visible).toBe(true);
  });

  it('excludes zero-size and 1×1 boxes', () => {
    loadFixture('discovery/hidden-honeypot.html');
    expect(isVisible(byId('honeypot'))).toEqual({ visible: false, reason: 'zero-size' });
    show(byId('tiny'), { width: 1, height: 1 });
    expect(isVisible(byId('tiny'))).toEqual({ visible: false, reason: 'zero-size' });
    show(byId('visible'), { width: 0, height: 24 });
    expect(isVisible(byId('visible')).reason).toBe('zero-size');
  });

  it('excludes offscreen honeypots but keeps below-the-fold fields', () => {
    loadFixture('discovery/hidden-honeypot.html');
    show(byId('offscreen'), { left: -9999 });
    expect(isVisible(byId('offscreen'))).toEqual({
      visible: false,
      reason: 'offscreen-honeypot',
    });
    show(byId('visible'), { top: 5000, left: 10 });
    expect(isVisible(byId('visible')).visible).toBe(true);
  });

  it('treats a script-hidden checkbox with a visible label as visible via proxy', () => {
    loadFixture('discovery/hidden-native-checkbox.html');
    show(byId<HTMLInputElement>('terms').labels?.[0] as HTMLElement);
    expect(isVisible(byId('terms'))).toEqual({ visible: true, viaProxy: true });
  });

  it('keeps a hidden checkbox hidden when its label is not visible', () => {
    document.body.innerHTML = '<input id="cb" type="checkbox" style="opacity:0" />';
    expect(isVisible(byId('cb'))).toEqual({ visible: false, reason: 'opacity-0' });
  });

  it('resolves aria-labelledby targets across the root', () => {
    document.body.innerHTML = `
      <span id="lbl" >Accept terms</span>
      <input id="cb" type="checkbox" aria-labelledby="lbl" style="opacity:0" />
    `;
    show(byId('lbl'));
    expect(isVisible(byId('cb'))).toEqual({ visible: true, viaProxy: true });
  });

  it('does not treat a select wrapped in a visible label as hidden', () => {
    document.body.innerHTML = `<label>Country <select id="sel" style="opacity:0"></select></label>`;
    show(document.querySelector('label') as HTMLElement);
    expect(isVisible(byId('sel'))).toEqual({ visible: true, viaProxy: true });
  });

  it('pierces shadow boundaries when checking ancestors', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = byId('host');
    host.setAttribute('aria-hidden', 'true');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input id="inner" />';
    show(byId('host'));
    const inner = shadow.getElementById('inner') as HTMLElement;
    show(inner);
    expect(isVisible(inner)).toEqual({ visible: false, reason: 'aria-hidden' });
  });
});
