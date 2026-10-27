import { describe, expect, it } from 'vitest';

import { FormElementSchema, FormElementTypeSchema, type FormElement } from '../element';

const valid: FormElement = {
  id: 'vfe_1',
  badgeIndex: 1,
  type: 'text',
  label: 'First Name',
  value: '',
  required: true,
  disabled: false,
  focused: false,
};

describe('FormElementSchema', () => {
  it('accepts a minimal valid element', () => {
    expect(FormElementSchema.parse(valid)).toEqual(valid);
  });

  it('accepts every declared type', () => {
    for (const type of FormElementTypeSchema.options) {
      expect(FormElementSchema.parse({ ...valid, type }).type).toBe(type);
    }
  });

  it('accepts optional detail fields', () => {
    const withDetail = {
      ...valid,
      placeholder: 'Jane',
      options: [{ label: 'California', value: 'CA' }],
      validationError: 'Required',
      groupLabel: 'Contact',
    };
    expect(FormElementSchema.parse(withDetail)).toMatchObject(withDetail);
  });

  it('rejects an undeclared type', () => {
    expect(FormElementSchema.safeParse({ ...valid, type: 'submit' }).success).toBe(false);
  });

  it('rejects a string badgeIndex', () => {
    expect(FormElementSchema.safeParse({ ...valid, badgeIndex: '1' }).success).toBe(false);
  });

  it.each(['required', 'disabled', 'focused'])('requires the %s flag', (key) => {
    const clone = { ...valid } as Record<string, unknown>;
    delete clone[key];
    expect(FormElementSchema.safeParse(clone).success).toBe(false);
  });

  it('accepts string, boolean and string-array values', () => {
    for (const value of ['x', true, ['a', 'b']]) {
      expect(FormElementSchema.safeParse({ ...valid, value }).success).toBe(true);
    }
  });

  it.each([null, 0, {}, ['a', 2]])('rejects the unsupported value %j', (value) => {
    expect(FormElementSchema.safeParse({ ...valid, value }).success).toBe(false);
  });

  it('rejects malformed options', () => {
    expect(FormElementSchema.safeParse({ ...valid, options: [{ label: 'x' }] }).success).toBe(
      false,
    );
  });
});
