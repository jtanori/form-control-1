import type { PageState } from '@vfe/protocol';
import { checkoutPageState, wizardStep2PageState } from '@vfe/protocol/fixtures';

/**
 * Extra page states used only by the eval suite. Protocol fixtures stay the
 * canonical checkout/wizard pages; everything else lives here so C-2 can cover
 * every edge case without inflating the public fixture surface.
 */

export const addressesPageState: PageState = {
  urlOrAppTitle: 'Shipping — Acme',
  elements: [
    {
      id: 'vfe_1',
      badgeIndex: 1,
      type: 'text',
      label: 'Address Line 1',
      value: '',
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'Billing Address',
    },
    {
      id: 'vfe_2',
      badgeIndex: 2,
      type: 'text',
      label: 'Address Line 1',
      value: '',
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'Shipping Address',
    },
    {
      id: 'vfe_3',
      badgeIndex: 3,
      type: 'text',
      label: 'City',
      value: '',
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'Billing Address',
    },
    {
      id: 'vfe_4',
      badgeIndex: 4,
      type: 'text',
      label: 'City',
      value: '',
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'Shipping Address',
    },
    {
      id: 'vfe_5',
      badgeIndex: 5,
      type: 'button',
      label: 'Save',
      value: '',
      required: false,
      disabled: false,
      focused: false,
    },
  ],
};

export const radiosPageState: PageState = {
  urlOrAppTitle: 'Preferences — Acme',
  elements: [
    {
      id: 'vfe_1',
      badgeIndex: 1,
      type: 'radio',
      label: 'Yes',
      value: false,
      required: false,
      disabled: false,
      focused: false,
      groupLabel: 'Newsletter',
    },
    {
      id: 'vfe_2',
      badgeIndex: 2,
      type: 'radio',
      label: 'No',
      value: false,
      required: false,
      disabled: false,
      focused: false,
      groupLabel: 'Newsletter',
    },
    {
      id: 'vfe_3',
      badgeIndex: 3,
      type: 'radio',
      label: 'Yes',
      value: false,
      required: false,
      disabled: false,
      focused: false,
      groupLabel: 'Terms',
    },
    {
      id: 'vfe_4',
      badgeIndex: 4,
      type: 'radio',
      label: 'No',
      value: false,
      required: false,
      disabled: false,
      focused: false,
      groupLabel: 'Terms',
    },
  ],
};

export const formatsPageState: PageState = {
  urlOrAppTitle: 'Personal details — Acme',
  elements: [
    {
      id: 'vfe_1',
      badgeIndex: 1,
      type: 'date',
      label: 'Date of Birth',
      value: '',
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'About you',
    },
    {
      id: 'vfe_2',
      badgeIndex: 2,
      type: 'email',
      label: 'Email',
      value: '',
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'About you',
    },
    {
      id: 'vfe_3',
      badgeIndex: 3,
      type: 'number',
      label: 'Annual Income',
      value: '',
      required: false,
      disabled: false,
      focused: false,
      groupLabel: 'Finances',
    },
    {
      id: 'vfe_4',
      badgeIndex: 4,
      type: 'tel',
      label: 'Phone',
      value: '',
      required: false,
      disabled: false,
      focused: false,
      groupLabel: 'Contact',
    },
  ],
};

export const comboboxCollapsedPageState: PageState = {
  urlOrAppTitle: 'Address — Acme',
  elements: [
    {
      id: 'vfe_1',
      badgeIndex: 1,
      type: 'combobox',
      label: 'State',
      placeholder: 'Choose a state',
      value: '',
      options: [],
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'Address',
    },
    {
      id: 'vfe_2',
      badgeIndex: 2,
      type: 'button',
      label: 'Continue',
      value: '',
      required: false,
      disabled: false,
      focused: false,
    },
  ],
};

export const comboboxExpandedPageState: PageState = {
  urlOrAppTitle: 'Address — Acme',
  elements: [
    {
      id: 'vfe_1',
      badgeIndex: 1,
      type: 'combobox',
      label: 'State',
      value: '',
      options: [
        { label: 'California', value: 'CA' },
        { label: 'Texas', value: 'TX' },
        { label: 'Oregon', value: 'OR' },
      ],
      required: true,
      disabled: false,
      focused: true,
      groupLabel: 'Address',
    },
    {
      id: 'vfe_2',
      badgeIndex: 2,
      type: 'button',
      label: 'Continue',
      value: '',
      required: false,
      disabled: false,
      focused: false,
    },
  ],
};

export const termsPageState: PageState = {
  urlOrAppTitle: 'Terms — Acme',
  elements: [
    {
      id: 'vfe_1',
      badgeIndex: 1,
      type: 'checkbox',
      label: 'I agree to the terms and conditions',
      value: false,
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'Legal',
    },
    {
      id: 'vfe_2',
      badgeIndex: 2,
      type: 'button',
      label: 'Accept',
      value: '',
      required: false,
      disabled: false,
      focused: false,
    },
  ],
};

export const evalPageStates = {
  'checkout-basic': checkoutPageState,
  'wizard-step-2': wizardStep2PageState,
  addresses: addressesPageState,
  radios: radiosPageState,
  formats: formatsPageState,
  'combobox-collapsed': comboboxCollapsedPageState,
  'combobox-expanded': comboboxExpandedPageState,
  terms: termsPageState,
} as const;

export type EvalPageStateName = keyof typeof evalPageStates;

export function pageStateByName(name: string): PageState {
  const state = (evalPageStates as Record<string, PageState | undefined>)[name];
  if (!state) {
    throw new Error(
      `Unknown pageState "${name}". Known: ${Object.keys(evalPageStates).join(', ')}`,
    );
  }
  return state;
}
