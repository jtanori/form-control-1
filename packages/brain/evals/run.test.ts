import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrainResponse } from '@vfe/protocol';
import { describe, expect, it, vi } from 'vitest';

import { assertResponse } from './assert';
import { pageStateByName } from './fixtures';
import {
  estimateCost,
  loadScenario,
  loadScenarios,
  renderMarkdown,
  runAll,
  runScenario,
  ScenarioMockProvider,
  writeReports,
} from './run';
import type { Scenario } from './types';

const MANDATORY = [
  'multi-field-dictation',
  'full-name-split',
  'correction',
  'badge-reference',
  'badge-reference-ordinal',
  'ambiguous-address',
  'ambiguous-radio',
  'spoken-date',
  'spoken-email',
  'spoken-number',
  'custom-combobox-open',
  'combobox-after-open',
  'submit-and-navigate',
  'validation-error-context',
  'unknown-field-refusal',
];

function withMock(
  scenario: Scenario,
  actions: BrainResponse['actions'],
  feedback?: string,
): BrainResponse {
  return {
    thoughtProcess: scenario.mock.thoughtProcess,
    spokenFeedback: feedback ?? scenario.mock.spokenFeedback,
    actions,
  };
}

async function runWithMock(scenario: Scenario, response: BrainResponse) {
  const provider = new ScenarioMockProvider();
  provider.use(response);
  return runScenario(scenario, { provider });
}

describe('scenario catalogue', () => {
  it('contains the 20 documented scenarios', () => {
    expect(loadScenarios()).toHaveLength(20);
  });

  it('covers every mandatory scenario id', () => {
    const ids = new Set(loadScenarios().map((scenario) => scenario.id));
    for (const id of MANDATORY) expect(ids.has(id), `${id} is missing`).toBe(true);
  });

  it('references real page states', () => {
    for (const scenario of loadScenarios()) {
      expect(() => pageStateByName(scenario.pageState)).not.toThrow();
    }
  });
});

describe('mock mode', () => {
  it('passes all scenarios in under 30 seconds and never touches the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const summary = await runAll({}, { mode: 'mock' });
    expect(summary.passRate).toBe(1);
    expect(summary.totalMs).toBeLessThan(30_000);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('reports the prompt version and mode', async () => {
    const summary = await runAll({}, { mode: 'mock' });
    expect(summary.promptVersion).toBe('1.0.0');
    expect(summary.mode).toBe('mock');
    expect(summary.outcomes.every((outcome) => outcome.provider === 'mock')).toBe(true);
  });
});

describe('assertion engine', () => {
  it('fails on a fabricated target id even when everything else matches', async () => {
    const scenario = loadScenario('multi-field-dictation');
    const outcome = await runWithMock(
      scenario,
      withMock(scenario, [
        { action: 'FILL', targetId: 'vfe_999', value: 'John' },
        { action: 'FILL', targetId: 'vfe_2', value: 'Doe' },
        { action: 'FILL', targetId: 'vfe_3', value: 'john@doe.com' },
      ]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.join('\n')).toContain('fabricated target "vfe_999"');
  });

  it('fails when the password appears in spoken feedback', async () => {
    const scenario = loadScenario('password-never-echoed');
    const outcome = await runWithMock(
      scenario,
      withMock(
        scenario,
        [{ action: 'FILL', targetId: 'vfe_4', value: 'hunter2' }],
        'Filled hunter2 for you.',
      ),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.join('\n')).toContain('must not contain "hunter2"');
  });

  it('fails on wrong ordering when order is significant', async () => {
    const scenario = loadScenario('multi-action-with-scroll');
    const outcome = await runWithMock(
      scenario,
      withMock(scenario, [
        { action: 'SET_CHECKED', targetId: 'vfe_7', checked: true },
        { action: 'SCROLL', direction: 'bottom' },
      ]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.join('\n')).toContain('wrong action order');
  });

  it('fails on unexpected extra actions', async () => {
    const scenario = loadScenario('multi-field-dictation');
    const outcome = await runWithMock(
      scenario,
      withMock(scenario, [...scenario.mock.actions, { action: 'CLICK', targetId: 'vfe_8' }]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.join('\n')).toContain('unexpected extra action');
  });

  it('fails a clarification scenario that performs a destructive action instead', async () => {
    const scenario = loadScenario('ambiguous-address');
    const outcome = await runWithMock(
      scenario,
      withMock(
        scenario,
        [{ action: 'FILL', targetId: 'vfe_1', value: '123 Main St' }],
        'Filled it in.',
      ),
    );
    expect(outcome.passed).toBe(false);
    const text = outcome.failures.join('\n');
    expect(text).toContain('expected an ASK_CLARIFICATION');
    expect(text).toContain('Billing');
    expect(text).toContain('Shipping');
  });

  it('fails forbidden action kinds', async () => {
    const scenario = loadScenario('validation-error-context');
    const outcome = await runWithMock(
      scenario,
      withMock(scenario, [
        { action: 'CLICK', targetId: 'vfe_8' },
        { action: 'ASK_CLARIFICATION', questionToUser: 'Which password?' },
      ]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.join('\n')).toContain('forbidden action CLICK');
  });

  it('reports fixture inconsistencies instead of silently passing', async () => {
    const scenario = loadScenario('multi-field-dictation');
    const broken: Scenario = {
      ...scenario,
      expect: {
        ...scenario.expect,
        actions: [{ action: 'FILL', target: { label: 'No Such Field' }, value: 'x' }],
      },
    };
    const provider = new ScenarioMockProvider();
    provider.use(scenario.mock);
    const outcome = await runScenario(broken, { provider });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.join('\n')).toContain('fixture inconsistency');
  });

  it('reports expected and actual actions in every missing-action failure', () => {
    const scenario = loadScenario('spoken-date');
    const failures = assertResponse(scenario, pageStateByName(scenario.pageState), {
      thoughtProcess: '',
      actions: [],
    });
    expect(failures.join('\n')).toContain('missing expected action');
    expect(failures.join('\n')).toContain('Date of Birth');
    expect(failures.join('\n')).toContain('actual: []');
  });

  it('compares dates strictly and emails case-insensitively', () => {
    const dateScenario = loadScenario('spoken-date');
    const datePage = pageStateByName(dateScenario.pageState);
    const wrongDate = assertResponse(dateScenario, datePage, {
      thoughtProcess: '',
      actions: [{ action: 'FILL', targetId: 'vfe_1', value: '1990-05-03' }],
    });
    expect(wrongDate.join('\n')).toContain('missing expected action');

    const emailScenario = loadScenario('spoken-email');
    const emailPage = pageStateByName(emailScenario.pageState);
    const upper = assertResponse(emailScenario, emailPage, {
      thoughtProcess: '',
      actions: [{ action: 'FILL', targetId: 'vfe_2', value: 'JOHN.DOE@ACME.CO.UK' }],
    });
    expect(upper).toEqual([]);
  });

  it('accepts a select option by label or value', () => {
    const scenario = loadScenario('mixed-fill-and-select');
    const page = pageStateByName(scenario.pageState);
    const byLabel = assertResponse(scenario, page, {
      thoughtProcess: '',
      actions: [
        { action: 'SELECT', targetId: 'vfe_5', value: 'Texas' },
        { action: 'FILL', targetId: 'vfe_6', value: '73301' },
      ],
    });
    expect(byLabel).toEqual([]);
  });
});

describe('reporting', () => {
  it('writes JSON and Markdown reports', async () => {
    const summary = await runAll({}, { mode: 'mock' });
    const dir = mkdtempSync(join(tmpdir(), 'vfe-evals-'));
    const [jsonPath, mdPath] = writeReports(summary, dir);
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as { outcomes: unknown[] };
    expect(parsed.outcomes).toHaveLength(20);
    expect(readFileSync(mdPath, 'utf8')).toContain('| Scenario | Result |');
    expect(renderMarkdown(summary)).toContain('100.0%');
  });

  it('rejects invalid provider output without throwing', async () => {
    const scenario = loadScenario('multi-field-dictation');
    const provider = {
      name: 'broken',
      model: 'broken',
      complete: async () => ({
        parsed: { nonsense: true },
        usage: { promptTokens: 0, completionTokens: 0 },
      }),
    };
    const outcome = await runScenario(scenario, { provider });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]).toContain('not a valid BrainResponse');
  });

  it('estimates cost for the nightly guard', () => {
    expect(estimateCost(60)).toBeLessThan(0.5);
    expect(estimateCost(10_000)).toBeGreaterThan(0.5);
  });
});
