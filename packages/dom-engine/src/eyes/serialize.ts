import type { FormElement, FormElementOption } from '@vfe/protocol';

import { parentOf } from './dom';
import { resolveContext } from './labels';

const DISABLED_FIELDSET = 'fieldset[disabled]';

export function mapType(el: HTMLElement): FormElement['type'] {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  if (tag === 'button' || role === 'button') return 'button';
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'email') return 'email';
    if (type === 'number') return 'number';
    if (type === 'tel') return 'tel';
    if (type === 'date') return 'date';
    if (type === 'password') return 'password';
    return 'text';
  }
  if (role === 'combobox') return 'combobox';
  if (role === 'checkbox' || role === 'switch') return 'checkbox';
  if (role === 'radio') return 'radio';
  if (role === 'listbox') return 'combobox';
  return 'text';
}

function isDisabled(el: HTMLElement): boolean {
  if ((el as HTMLInputElement).disabled === true) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  for (let node = parentOf(el); node; node = parentOf(node)) {
    if (node.matches(DISABLED_FIELDSET)) return true;
  }
  return false;
}

function isFocused(el: HTMLElement): boolean {
  const root = el.getRootNode() as Document | ShadowRoot;
  if (root.activeElement === el) return true;
  return document.activeElement === el;
}

export function readValue(
  el: HTMLElement,
  type: FormElement['type'],
  includeValues = true,
): FormElement['value'] {
  if (type === 'password') {
    const password = (el as HTMLInputElement).value ?? '';
    if (!includeValues) return '';
    return password.length > 0 ? '<redacted>' : '';
  }
  if (type === 'checkbox') {
    if (!includeValues) return false;
    if (el.tagName === 'INPUT') return (el as HTMLInputElement).checked;
    return el.getAttribute('aria-checked') === 'true';
  }
  if (type === 'radio') {
    if (!includeValues) return false;
    return (el as HTMLInputElement).checked === true;
  }
  if (type === 'select') {
    const select = el as HTMLSelectElement;
    if (select.multiple) {
      if (!includeValues) return [];
      return Array.from(select.selectedOptions, (option) => option.value);
    }
    return includeValues ? select.value : '';
  }
  if (type === 'button') return '';
  if (!includeValues) return '';
  if (el.isContentEditable) {
    const text = typeof el.innerText === 'string' ? el.innerText : el.textContent;
    return (text ?? '').trim();
  }
  return (el as HTMLInputElement).value ?? '';
}

function visibleRoleOptions(el: HTMLElement): FormElementOption[] {
  const visible = (node: Element): boolean => {
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  };
  return Array.from(el.querySelectorAll('[role="option"]'))
    .filter(visible)
    .map((option) => ({
      label: (option.textContent ?? '').replace(/\s+/g, ' ').trim(),
      value: option.getAttribute('data-value') ?? (option.textContent ?? '').trim(),
    }));
}

export function readOptions(
  el: HTMLElement,
  type: FormElement['type'],
): FormElementOption[] | undefined {
  if (type === 'select') {
    return Array.from((el as HTMLSelectElement).options, (option) => ({
      label: (option.textContent ?? '').replace(/\s+/g, ' ').trim(),
      value: option.value,
    }));
  }
  if (type === 'combobox') {
    const expanded =
      el.getAttribute('aria-expanded') === 'true' || el.getAttribute('role') === 'listbox';
    if (!expanded) return [];
    return visibleRoleOptions(el);
  }
  return undefined;
}

function groupLabelFor(el: HTMLElement): string | undefined {
  if (el.getAttribute('role') !== 'option') return undefined;
  for (let node = parentOf(el); node; node = parentOf(node)) {
    if (node.getAttribute('role') === 'listbox') {
      const label = node.getAttribute('aria-label');
      if (label) return label.replace(/\s+/g, ' ').trim();
      const labelledBy = node.getAttribute('aria-labelledby');
      if (labelledBy) {
        const target = document.getElementById(labelledBy);
        if (target?.textContent) return target.textContent.replace(/\s+/g, ' ').trim();
      }
    }
  }
  return undefined;
}

/** Map one discovered DOM node to the protocol's `FormElement`. */
export function serializeElement(
  el: HTMLElement,
  vfeId: string,
  badgeIndex: number,
  options: { includeValues?: boolean } = {},
): FormElement {
  const includeValues = options.includeValues ?? true;
  const context = resolveContext(el);
  const type = mapType(el);

  const element: FormElement = {
    id: vfeId,
    badgeIndex,
    type,
    label: context.label,
    value: readValue(el, type, includeValues),
    required: context.required,
    disabled: isDisabled(el),
    focused: isFocused(el),
  };

  const placeholder = el.getAttribute('placeholder')?.trim();
  if (placeholder) element.placeholder = placeholder;

  const optionsList = readOptions(el, type);
  if (optionsList) element.options = optionsList;

  const groupLabel = groupLabelFor(el) ?? context.groupLabel;
  if (groupLabel) element.groupLabel = groupLabel;

  if (context.validationError) element.validationError = context.validationError;

  return element;
}
