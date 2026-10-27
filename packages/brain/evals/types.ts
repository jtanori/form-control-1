import type { ActionKind, BrainResponse, ConversationTurn, ScrollDirection } from '@vfe/protocol';

export interface TargetRef {
  label: string;
  groupLabel?: string;
}

export interface ExpectedAction {
  action: ActionKind;
  target?: TargetRef;
  value?: string;
  checked?: boolean;
  direction?: ScrollDirection;
}

export interface SpokenFeedbackExpectation {
  mustMention?: string[];
  mustNotContain?: string[];
  minLength?: number;
}

export interface ScenarioExpectation {
  actions: ExpectedAction[];
  allowExtraActions?: boolean;
  allowOrderChange?: boolean;
  spokenFeedback?: SpokenFeedbackExpectation;
  clarificationMustMention?: string[];
  forbidActions?: ActionKind[];
}

export interface Scenario {
  id: string;
  title: string;
  tags: string[];
  pageState: string;
  history?: ConversationTurn[];
  transcript: string;
  expect: ScenarioExpectation;
  recorded?: {
    provider: string;
    model: string;
    at: string;
    latencyMs: number;
  };
  mock: BrainResponse;
}

export interface ScenarioOutcome {
  id: string;
  passed: boolean;
  failures: string[];
  actual: BrainResponse;
  latencyMs: number;
  provider: string;
  model: string;
}

export interface RunSummary {
  outcomes: ScenarioOutcome[];
  passRate: number;
  promptVersion: string;
  mode: 'mock' | 'live';
  startedAt: string;
  totalMs: number;
}
