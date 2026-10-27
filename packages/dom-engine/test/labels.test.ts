import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveValidationError } from '../src/eyes/errors';
import { resolveGroupLabel } from '../src/eyes/group';
import { clearContextCache, resolveContext } from '../src/eyes/labels';
import type { ResolvedContext } from '../src/eyes/labels';
import { normaliseLabel } from '../src/eyes/text';

import { byId, loadFixture, show } from './utils';

interface Row {
  fixture: string;
  selector: string;
  expected: Partial<ResolvedContext>;
}

const rows: Row[] = [
  {
    fixture: 'bootstrap-stacked.html',
    selector: '#first-name',
    expected: {
      label: 'First Name',
      labelSource: 'label-for',
      groupLabel: 'Shipping Address',
      required: true,
      requiredSource: 'label-marker',
    },
  },
  {
    fixture: 'bootstrap-floating.html',
    selector: '#float-email',
    expected: { label: 'Email address', labelSource: 'proximity' },
  },
  {
    fixture: 'tailwind-label-above.html',
    selector: '#tw-email',
    expected: { label: 'Email', labelSource: 'proximity' },
  },
  {
    fixture: 'mui-textfield.html',
    selector: '#mui-input',
    expected: {
      label: 'Email address',
      labelSource: 'aria-labelledby',
      validationError: 'Please enter a valid email',
      required: true,
      requiredSource: 'aria',
    },
  },
  {
    fixture: 'placeholder-only.html',
    selector: '#search',
    expected: { label: 'Search', labelSource: 'placeholder' },
  },
  {
    fixture: 'no-attributes.html',
    selector: '#fn',
    expected: { label: 'First Name', labelSource: 'name-attr' },
  },
  {
    fixture: 'radio-group-fieldset.html',
    selector: 'input[value="standard"]',
    expected: {
      label: 'Standard shipping',
      labelSource: 'label-parent',
      groupLabel: 'Shipping method',
      required: true,
      requiredSource: 'html',
    },
  },
  {
    fixture: 'checkbox-card.html',
    selector: '#terms',
    expected: {
      label: 'I agree to the terms and conditions',
      labelSource: 'label-for',
      required: false,
      requiredSource: 'none',
    },
  },
  {
    fixture: 'aria-label-wins.html',
    selector: '#email-input',
    expected: { label: 'Preferred email', labelSource: 'aria-label' },
  },
  {
    fixture: 'error-sibling.html',
    selector: '#err-email',
    expected: { label: 'Email', validationError: 'Email is required' },
  },
  {
    fixture: 'error-red-text.html',
    selector: '#addr',
    expected: { label: 'Address', validationError: 'That address looks wrong' },
  },
  {
    fixture: 'heading-group.html',
    selector: '#billing-street',
    expected: { label: 'Billing Street', labelSource: 'name-attr', groupLabel: 'Billing Address' },
  },
  {
    fixture: 'multiple-labels.html',
    selector: '#multi',
    expected: { label: 'Work Email Address', labelSource: 'label-for' },
  },
  {
    fixture: 'duplicate-labels.html',
    selector: '#dup-1',
    expected: { label: 'Contact', labelSource: 'proximity' },
  },
];

beforeEach(() => {
  clearContextCache();
});

afterEach(() => {
  clearContextCache();
});

describe('label & context resolution', () => {
  it.each(rows)('$fixture → $expected.label', ({ fixture, selector, expected }) => {
    loadFixture(`labels/${fixture}`);
    const el = document.querySelector(selector) as HTMLElement;
    expect(el).not.toBeNull();
    expect(resolveContext(el)).toMatchObject(expected);
  });

  it('does not give the same proximity text to two controls', () => {
    loadFixture('labels/duplicate-labels.html');
    const first = resolveContext(byId('dup-1'));
    const second = resolveContext(byId('dup-2'));
    expect(first.label).toBe('Contact');
    expect(second.label).toBe('Phone');
    expect(second.labelSource).toBe('name-attr');
  });

  it('resolves a label across a shadow boundary', () => {
    loadFixture('labels/shadow-label.html');
    const host = byId('shadow-host');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input id="inner-email" />';
    const inner = shadow.getElementById('inner-email') as HTMLElement;
    expect(resolveContext(inner).label).toBe('Shadow Email');
    expect(resolveContext(inner).labelSource).toBe('label-for');
  });

  it('resolves aria-labelledby pointing into a shadow root', () => {
    document.body.innerHTML = `
      <div id="host"></div>
      <input id="outside" aria-labelledby="shadow-label-text" />
    `;
    const shadow = byId('host').attachShadow({ mode: 'open' });
    shadow.innerHTML = '<span id="shadow-label-text">Inside label</span>';
    expect(resolveContext(byId('outside')).label).toBe('Inside label');
  });

  it('guards aria-labelledby cycles and depth', () => {
    document.body.innerHTML = `
      <span id="a">Alpha</span>
      <input id="x" aria-labelledby="b" />
      <span id="b">Beta</span>
    `;
    // A cycle between two labelledby targets must terminate.
    byId('a').setAttribute('aria-labelledby', 'b');
    byId('b').setAttribute('aria-labelledby', 'a');
    expect(resolveContext(byId('x')).label).toBe('Beta');
  });

  it('falls back to Field when nothing is readable', () => {
    document.body.innerHTML = '<input />';
    expect(resolveContext(document.querySelector('input') as HTMLElement)).toMatchObject({
      label: 'Field',
      labelSource: 'fallback',
    });
  });

  it('humanises ids as a last resort', () => {
    document.body.innerHTML = '<input id="input_shipping_zip1" />';
    expect(resolveContext(byId('input_shipping_zip1')).label).toBe('Shipping Zip');
  });

  it('ignores hidden helper text as a label', () => {
    document.body.innerHTML = `
      <div><span style="display:none">Hidden helper</span><input id="h" name="hiddenHelp" /></div>`;
    expect(resolveContext(byId('h')).label).toBe('Hidden Help');
  });

  it('prefers html required over aria and label markers', () => {
    document.body.innerHTML = `
      <label for="r">Name *</label>
      <input id="r" required aria-required="true" />`;
    expect(resolveContext(byId('r'))).toMatchObject({
      required: true,
      requiredSource: 'html',
    });
  });

  it('caches per element until the cache is cleared', () => {
    document.body.innerHTML = '<label for="c">Cached</label><input id="c" />';
    const el = byId('c');
    const first = resolveContext(el);
    expect(resolveContext(el)).toBe(first);
    clearContextCache();
    expect(resolveContext(el)).not.toBe(first);
    expect(resolveContext(el).label).toBe('Cached');
  });

  it('never throws on a detached element', () => {
    const input = document.createElement('input');
    expect(() => resolveContext(input)).not.toThrow();
    expect(resolveContext(input).label).toBe('Field');
  });
});

describe('normaliseLabel', () => {
  it.each([
    ['  First   Name  ', 'First Name'],
    ['Email *', 'Email'],
    ['Email (required)', 'Email'],
    ['Email: required', 'Email'],
    ['Required Email', 'Email'],
    ['Email:', 'Email'],
    ['Email\u200B', 'Email'],
    ['🚀 Launch', 'Launch'],
    ['*', ''],
    ['Required', ''],
    [null, ''],
    ['a'.repeat(200), 'a'.repeat(120)],
  ])('normalises %j → %j', (raw, expected) => {
    expect(normaliseLabel(raw as string | null)).toBe(expected);
  });
});

describe('group labels', () => {
  it.each([
    ['radio-group-fieldset.html', 'input[value="express"]', 'Shipping method'],
    ['heading-group.html', '#billing-street', 'Billing Address'],
  ])('%s → %s', (fixture, selector, expected) => {
    loadFixture(`labels/${fixture}`);
    expect(resolveGroupLabel(document.querySelector(selector) as Element)).toBe(expected);
  });

  it('uses an aria-labelledby radiogroup', () => {
    document.body.innerHTML = `
      <span id="rg-label">Notify me</span>
      <div role="radiogroup" aria-labelledby="rg-label">
        <label><input type="radio" id="yes" /> Yes</label>
      </div>`;
    expect(resolveGroupLabel(byId('yes'))).toBe('Notify me');
  });

  it('uses an aria-label group and section name', () => {
    document.body.innerHTML = `
      <section aria-label="Payment">
        <div role="group" aria-label="Card details"><input id="card" /></div>
      </section>`;
    expect(resolveGroupLabel(byId('card'))).toBe('Card details');
  });

  it('falls back to the section name and then undefined', () => {
    document.body.innerHTML = `
      <section aria-label="Payment"><input id="pay" /></section>
      <div><input id="loose" /></div>`;
    expect(resolveGroupLabel(byId('pay'))).toBe('Payment');
    expect(resolveGroupLabel(byId('loose'))).toBeUndefined();
  });

  it('stops the backwards walk at a form boundary', () => {
    document.body.innerHTML = `
      <h3>Outside</h3>
      <form><input id="f" /></form>`;
    expect(resolveGroupLabel(byId('f'))).toBeUndefined();
  });
});

describe('validation errors', () => {
  it('prefers aria-errormessage over aria-describedby', () => {
    document.body.innerHTML = `
      <input id="e" aria-invalid="true" aria-errormessage="em" aria-describedby="db" />
      <span id="em">First error</span>
      <span id="db">Second error</span>`;
    expect(resolveValidationError(byId('e'))).toBe('First error');
  });

  it('uses aria-describedby only for error-ish or alert text', () => {
    document.body.innerHTML = `
      <input id="a" aria-invalid="true" aria-describedby="helper" />
      <span id="helper">We'll never share your email</span>
      <input id="b" aria-invalid="true" aria-describedby="alert" />
      <span id="alert" role="alert">Something went wrong</span>`;
    expect(resolveValidationError(byId('a'))).toBeUndefined();
    expect(resolveValidationError(byId('b'))).toBe('Something went wrong');
  });

  it('finds role=alert inside the wrapper', () => {
    document.body.innerHTML = `
      <div class="field"><label for="x">X</label><input id="x" /><span role="alert">Required field</span></div>`;
    expect(resolveValidationError(byId('x'))).toBe('Required field');
  });

  it('ignores an error template that is hidden', () => {
    document.body.innerHTML = `
      <div class="field"><input id="x" /><div class="invalid-feedback" style="display:none">Hidden error</div></div>`;
    expect(resolveValidationError(byId('x'))).toBeUndefined();
  });

  it('ignores helper text without an error marker', () => {
    document.body.innerHTML = `
      <div class="field"><input id="x" /><div class="helper-text">We'll never share your email</div></div>`;
    expect(resolveValidationError(byId('x'))).toBeUndefined();
  });

  it('uses computed red text as a last heuristic', () => {
    document.body.innerHTML = `
      <div class="field"><input id="x" /><span id="red">Nope</span></div>`;
    show(byId('red'), { color: 'rgb(190, 20, 20)' });
    expect(resolveValidationError(byId('x'))).toBe('Nope');
  });

  it('reads HTML5 validation only after interaction', () => {
    document.body.innerHTML = '<input id="v" required />';
    const el = byId<HTMLInputElement>('v');
    Object.defineProperty(el, 'validationMessage', { configurable: true, value: 'Fill this out' });
    expect(resolveValidationError(el)).toBeUndefined();
    el.setAttribute('data-vfe-touched', 'true');
    const matched = el.matches(':invalid');
    expect(resolveValidationError(el)).toBe(matched ? 'Fill this out' : undefined);
  });

  it('never throws', () => {
    const detached = document.createElement('input');
    expect(resolveValidationError(detached)).toBeUndefined();
  });
});
