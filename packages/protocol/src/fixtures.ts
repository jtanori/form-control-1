import type { Action } from './actions';
import type { BrainResponse } from './brain';
import type { PageState } from './page-state';

/**
 * Golden samples shared by Tracks A–E, the eval suite and the testbed.
 * The JSON files in `packages/protocol/fixtures/` mirror these objects byte for
 * byte (asserted in `src/__tests__/fixtures.test.ts`).
 */

export const checkoutPageState: PageState = {
  urlOrAppTitle: 'Checkout — Acme',
  elements: [
    {
      id: 'vfe_1',
      badgeIndex: 1,
      type: 'text',
      label: 'First Name',
      placeholder: 'Jane',
      value: '',
      required: true,
      disabled: false,
      focused: true,
      groupLabel: 'Contact',
    },
    {
      id: 'vfe_2',
      badgeIndex: 2,
      type: 'text',
      label: 'Last Name',
      placeholder: 'Doe',
      value: '',
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'Contact',
    },
    {
      id: 'vfe_3',
      badgeIndex: 3,
      type: 'email',
      label: 'Email',
      placeholder: 'you@example.com',
      value: '',
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'Contact',
    },
    {
      id: 'vfe_4',
      badgeIndex: 4,
      type: 'text',
      label: 'Address Line 1',
      value: '',
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'Shipping Address',
    },
    {
      id: 'vfe_5',
      badgeIndex: 5,
      type: 'select',
      label: 'State',
      value: 'CA',
      options: [
        { label: 'California', value: 'CA' },
        { label: 'Texas', value: 'TX' },
      ],
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'Shipping Address',
    },
    {
      id: 'vfe_6',
      badgeIndex: 6,
      type: 'text',
      label: 'ZIP Code',
      value: '',
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'Shipping Address',
    },
    {
      id: 'vfe_7',
      badgeIndex: 7,
      type: 'checkbox',
      label: 'I agree to the terms and conditions',
      value: false,
      required: true,
      disabled: false,
      focused: false,
    },
    {
      id: 'vfe_8',
      badgeIndex: 8,
      type: 'button',
      label: 'Place order',
      value: '',
      required: false,
      disabled: false,
      focused: false,
    },
  ],
  globalErrors: [],
};

export const wizardStep2PageState: PageState = {
  urlOrAppTitle: 'Account setup — Step 2 of 4',
  elements: [
    {
      id: 'vfe_1',
      badgeIndex: 1,
      type: 'text',
      label: 'First Name',
      value: 'Alice',
      required: true,
      disabled: false,
      focused: true,
      groupLabel: 'Your name',
    },
    {
      id: 'vfe_2',
      badgeIndex: 2,
      type: 'text',
      label: 'Middle Name',
      value: '',
      required: false,
      disabled: false,
      focused: false,
      groupLabel: 'Your name',
    },
    {
      id: 'vfe_3',
      badgeIndex: 3,
      type: 'text',
      label: 'Last Name',
      value: 'Liddell',
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'Your name',
    },
    {
      id: 'vfe_4',
      badgeIndex: 4,
      type: 'password',
      label: 'Password',
      value: '<redacted>',
      required: true,
      disabled: false,
      focused: false,
      validationError: 'Password must be at least 8 characters',
    },
    {
      id: 'vfe_5',
      badgeIndex: 5,
      type: 'radio',
      label: 'Standard shipping',
      value: true,
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'Shipping method',
    },
    {
      id: 'vfe_6',
      badgeIndex: 6,
      type: 'radio',
      label: 'Express shipping',
      value: false,
      required: true,
      disabled: false,
      focused: false,
      groupLabel: 'Shipping method',
    },
    {
      id: 'vfe_7',
      badgeIndex: 7,
      type: 'select',
      label: 'Country',
      value: 'US',
      options: [
        { label: 'United States', value: 'US' },
        { label: 'Canada', value: 'CA' },
      ],
      required: false,
      disabled: true,
      focused: false,
    },
    {
      id: 'vfe_8',
      badgeIndex: 8,
      type: 'button',
      label: 'Continue',
      value: '',
      required: false,
      disabled: false,
      focused: false,
    },
  ],
};

export const brainResponseFillThree: BrainResponse = {
  thoughtProcess: 'User dictated name and email; three empty text fields match by label.',
  spokenFeedback: 'Filled in your name and email.',
  actions: [
    { action: 'FILL', targetId: 'vfe_1', value: 'Alice' },
    { action: 'FILL', targetId: 'vfe_2', value: 'Liddell' },
    { action: 'FILL', targetId: 'vfe_3', value: 'alice@wonderland.com' },
  ],
};

export const brainResponseClarifyAddress: BrainResponse = {
  thoughtProcess: 'Both Billing Address and Shipping Address exist; the request is ambiguous.',
  spokenFeedback: 'Should I put that in Billing Address or Shipping Address?',
  actions: [
    {
      action: 'ASK_CLARIFICATION',
      questionToUser: 'Should I put that in Billing Address or Shipping Address?',
    },
  ],
};

export const allKindsActions: Action[] = [
  { action: 'FILL', targetId: 'vfe_1', value: 'Alice' },
  { action: 'SELECT', targetId: 'vfe_5', value: 'CA' },
  { action: 'SET_CHECKED', targetId: 'vfe_7', checked: true },
  { action: 'CLICK', targetId: 'vfe_8' },
  { action: 'FOCUS', targetId: 'vfe_2' },
  { action: 'CLEAR', targetId: 'vfe_2' },
  { action: 'SCROLL', direction: 'bottom' },
  { action: 'ASK_CLARIFICATION', questionToUser: 'Which address should I use?' },
];

export const fixtures = {
  checkoutPageState,
  wizardStep2PageState,
  brainResponseFillThree,
  brainResponseClarifyAddress,
  allKindsActions,
} as const;
