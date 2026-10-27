import type { Action, BrainResponse, FormElement, PageState } from '@vfe/protocol';

import type { ExpectedAction, Scenario, TargetRef } from './types';

const TARGETLESS = new Set(['SCROLL', 'ASK_CLARIFICATION']);

function normaliseText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Resolve a human-readable target to a concrete element. Never matches on
 * `vfe_*` ids, which are machine-generated and change between snapshots.
 */
export function resolveTarget(
  pageState: PageState,
  ref: TargetRef,
): { element?: FormElement; error?: string } {
  const matches = pageState.elements.filter(
    (element) =>
      normaliseText(element.label) === normaliseText(ref.label) &&
      (ref.groupLabel === undefined ||
        normaliseText(element.groupLabel ?? '') === normaliseText(ref.groupLabel)),
  );
  if (matches.length === 1) return { element: matches[0] };
  if (matches.length === 0) {
    return {
      error: `fixture inconsistency: no element labelled "${ref.label}"${ref.groupLabel ? ` in "${ref.groupLabel}"` : ''}`,
    };
  }
  return {
    error: `fixture inconsistency: "${ref.label}"${ref.groupLabel ? ` in "${ref.groupLabel}"` : ''} matched ${matches.length} elements — add groupLabel`,
  };
}

function normaliseByType(type: FormElement['type'], raw: string): string {
  switch (type) {
    case 'email':
      return raw.trim().toLowerCase();
    case 'text':
    case 'textarea':
      return normaliseText(raw);
    case 'tel':
      return raw.replace(/[^\d+]/g, '');
    case 'number': {
      const numeric = Number(raw.replace(/,/g, ''));
      return Number.isFinite(numeric) ? String(numeric) : raw.trim();
    }
    case 'date':
      return raw.trim();
    default:
      return raw.trim();
  }
}

function optionFor(element: FormElement, raw: string): string | undefined {
  const needle = raw.trim();
  const match = (element.options ?? []).find(
    (option) => option.value === needle || normaliseText(option.label) === normaliseText(needle),
  );
  return match?.value;
}

function valuesMatch(element: FormElement, expected: string, actual: string): boolean {
  if (element.type === 'select' || element.type === 'combobox') {
    const expectedOption = optionFor(element, expected);
    const actualOption = optionFor(element, actual);
    if (expectedOption !== undefined) return actualOption === expectedOption;
    return normaliseText(expected) === normaliseText(actual);
  }
  return normaliseByType(element.type, expected) === normaliseByType(element.type, actual);
}

function actualTargetId(action: Action): string | undefined {
  return 'targetId' in action ? action.targetId : undefined;
}

function describeExpected(expected: ExpectedAction): string {
  const target = expected.target
    ? `${expected.target.label}${expected.target.groupLabel ? ` (${expected.target.groupLabel})` : ''}`
    : '-';
  const extra =
    expected.value !== undefined
      ? ` value=${JSON.stringify(expected.value)}`
      : expected.checked !== undefined
        ? ` checked=${String(expected.checked)}`
        : expected.direction
          ? ` direction=${expected.direction}`
          : '';
  return `${expected.action} → ${target}${extra}`;
}

function describeActual(action: Action): string {
  return JSON.stringify(action);
}

interface ResolvedExpected extends ExpectedAction {
  targetId?: string;
}

function resolveExpectations(
  pageState: PageState,
  scenario: Scenario,
  failures: string[],
): ResolvedExpected[] {
  return scenario.expect.actions.map((expected) => {
    if (!expected.target) return expected;
    const { element, error } = resolveTarget(pageState, expected.target);
    if (error) {
      failures.push(error);
      return expected;
    }
    return { ...expected, targetId: element?.id };
  });
}

function elementFor(pageState: PageState, targetId: string | undefined): FormElement | undefined {
  return targetId ? pageState.elements.find((element) => element.id === targetId) : undefined;
}

function actionMatches(expected: ResolvedExpected, actual: Action, pageState: PageState): boolean {
  if (expected.action !== actual.action) return false;
  if (expected.targetId !== undefined) {
    if (actualTargetId(actual) !== expected.targetId) return false;
  } else if (!TARGETLESS.has(expected.action)) {
    // An expected action without a target can only match the same target-less kind.
    if (actualTargetId(actual) !== undefined) return false;
  }

  switch (actual.action) {
    case 'FILL':
    case 'SELECT': {
      if (expected.value === undefined) return true;
      const element =
        elementFor(pageState, expected.targetId) ?? elementFor(pageState, actual.targetId);
      if (!element) return false;
      return valuesMatch(element, expected.value, actual.value);
    }
    case 'SET_CHECKED':
      return expected.checked === undefined || expected.checked === actual.checked;
    case 'SCROLL':
      return expected.direction === undefined || expected.direction === actual.direction;
    case 'ASK_CLARIFICATION':
      return true;
    default:
      return true;
  }
}

export function assertResponse(
  scenario: Scenario,
  pageState: PageState,
  response: BrainResponse,
): string[] {
  const failures: string[] = [];
  const expected = resolveExpectations(pageState, scenario, failures);

  // Rule 1: fabricated targets are always fatal, even when extra actions are allowed.
  for (const action of response.actions) {
    const targetId = actualTargetId(action);
    if (targetId && !pageState.elements.some((element) => element.id === targetId)) {
      failures.push(
        `fabricated target ${JSON.stringify(targetId)} in ${describeActual(action)} — not present in pageState`,
      );
    }
  }

  // Rule 2: forbidden action kinds.
  for (const forbidden of scenario.expect.forbidActions ?? []) {
    const offending = response.actions.find((action) => action.action === forbidden);
    if (offending) {
      failures.push(`forbidden action ${forbidden} was emitted: ${describeActual(offending)}`);
    }
  }

  // Rule 3: multiset comparison (or ordered comparison when requested).
  const allowOrderChange = scenario.expect.allowOrderChange !== false;
  const remaining = [...response.actions];
  const missing: string[] = [];
  const matchedIndexes: number[] = [];

  for (const wanted of expected) {
    const index = remaining.findIndex((action) => actionMatches(wanted, action, pageState));
    if (index === -1) {
      missing.push(describeExpected(wanted));
    } else {
      matchedIndexes.push(response.actions.indexOf(remaining[index] as Action));
      remaining.splice(index, 1);
    }
  }

  if (missing.length > 0) {
    failures.push(
      `missing expected action(s): ${missing.join('; ')} | actual: ${JSON.stringify(response.actions)}`,
    );
  }

  if (!allowOrderChange && missing.length === 0) {
    const actualOrder = matchedIndexes.join(',');
    const sorted = [...matchedIndexes].sort((a, b) => a - b).join(',');
    if (actualOrder !== sorted) {
      failures.push(
        `wrong action order: expected [${expected.map(describeExpected).join('; ')}] | actual: ${JSON.stringify(
          response.actions,
        )}`,
      );
    }
  }

  if (scenario.expect.allowExtraActions !== true && remaining.length > 0) {
    failures.push(`unexpected extra action(s): ${remaining.map(describeActual).join('; ')}`);
  }

  // Rule 4: spoken surface expectations.
  const feedback = response.spokenFeedback ?? '';
  const clarifications = response.actions
    .filter(
      (action): action is Extract<Action, { action: 'ASK_CLARIFICATION' }> =>
        action.action === 'ASK_CLARIFICATION',
    )
    .map((action) => action.questionToUser);
  const spokenSurface = [feedback, ...clarifications].join(' ');

  const spoken = scenario.expect.spokenFeedback;
  if (spoken?.minLength !== undefined && feedback.trim().length < spoken.minLength) {
    failures.push(
      `spokenFeedback too short: expected at least ${spoken.minLength} chars, got ${JSON.stringify(feedback)}`,
    );
  }
  for (const keyword of spoken?.mustMention ?? []) {
    if (!feedback.toLowerCase().includes(keyword.toLowerCase())) {
      failures.push(`spokenFeedback must mention "${keyword}", got ${JSON.stringify(feedback)}`);
    }
  }
  for (const keyword of spoken?.mustNotContain ?? []) {
    if (spokenSurface.toLowerCase().includes(keyword.toLowerCase())) {
      failures.push(
        `spokenFeedback must not contain "${keyword}", got ${JSON.stringify(feedback)}`,
      );
    }
  }
  for (const keyword of scenario.expect.clarificationMustMention ?? []) {
    if (!spokenSurface.toLowerCase().includes(keyword.toLowerCase())) {
      failures.push(
        `clarification must mention "${keyword}", got ${JSON.stringify(clarifications)}`,
      );
    }
  }

  // Rule 5: a clarification expectation must actually be a clarification.
  if (
    expected.some((action) => action.action === 'ASK_CLARIFICATION') &&
    clarifications.length === 0
  ) {
    failures.push('expected an ASK_CLARIFICATION action but none was emitted');
  }

  return failures;
}
