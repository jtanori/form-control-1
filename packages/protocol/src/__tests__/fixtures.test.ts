import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ActionSchema, type Action } from '../actions';
import { BrainResponseSchema } from '../brain';
import { fixtures } from '../fixtures';
import { PageStateSchema } from '../page-state';

const fixturesDir = fileURLToPath(new URL('../../fixtures/', import.meta.url));

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(`${fixturesDir}${name}`, 'utf8'));
}

describe('golden fixtures', () => {
  it('keeps the JSON files byte-identical to the typed exports', () => {
    expect(readJson('page-state.checkout.json')).toEqual(fixtures.checkoutPageState);
    expect(readJson('page-state.wizard-step-2.json')).toEqual(fixtures.wizardStep2PageState);
    expect(readJson('brain-response.fill-three.json')).toEqual(fixtures.brainResponseFillThree);
    expect(readJson('brain-response.clarify-address.json')).toEqual(
      fixtures.brainResponseClarifyAddress,
    );
    expect(readJson('action.all-kinds.json')).toEqual(fixtures.allKindsActions);
  });

  it('parses every page-state fixture', () => {
    expect(PageStateSchema.safeParse(fixtures.checkoutPageState).success).toBe(true);
    expect(PageStateSchema.safeParse(fixtures.wizardStep2PageState).success).toBe(true);
  });

  it('parses every brain-response fixture', () => {
    expect(BrainResponseSchema.safeParse(fixtures.brainResponseFillThree).success).toBe(true);
    expect(BrainResponseSchema.safeParse(fixtures.brainResponseClarifyAddress).success).toBe(true);
  });

  it('parses the all-kinds action fixture and covers every discriminator', () => {
    const actions = readJson('action.all-kinds.json') as Action[];
    for (const action of actions) {
      expect(ActionSchema.parse(action)).toEqual(action);
    }
    expect(new Set(actions.map((a) => a.action)).size).toBe(8);
  });
});
