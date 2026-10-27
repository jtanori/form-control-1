import { readdirSync, readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrainResponseSchema, type BrainResponse, type PageState } from '@vfe/protocol';

import type { LlmCompleteArgs, LlmProvider } from '../src/llm/types';
import { buildSystemPrompt, SYSTEM_PROMPT_VERSION } from '../src/prompt/system';

import { assertResponse } from './assert';
import { pageStateByName } from './fixtures';
import type { RunSummary, Scenario, ScenarioOutcome } from './types';

const SCENARIOS_DIR = fileURLToPath(new URL('./scenarios/', import.meta.url));

export function scenarioPath(id: string): string {
  return join(SCENARIOS_DIR, `${id}.json`);
}

export function loadScenarios(dir = SCENARIOS_DIR): Scenario[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Scenario;
      if (`${raw.id}.json` !== file) {
        throw new Error(`Scenario file ${file} declares id "${raw.id}"`);
      }
      pageStateByName(raw.pageState);
      return raw;
    });
}

export function loadScenario(id: string): Scenario {
  return JSON.parse(readFileSync(scenarioPath(id), 'utf8')) as Scenario;
}

/** Serves the scenario's recorded `mock` block — zero network, deterministic. */
export class ScenarioMockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'eval-fixture';
  private current: BrainResponse | null = null;

  use(response: BrainResponse): void {
    this.current = response;
  }

  async complete(
    _args: LlmCompleteArgs,
  ): Promise<{ parsed: unknown; usage: { promptTokens: number; completionTokens: number } }> {
    if (!this.current) throw new Error('ScenarioMockProvider.use() must be called first');
    return { parsed: this.current, usage: { promptTokens: 0, completionTokens: 0 } };
  }
}

export function requestFor(scenario: Scenario): {
  pageState: PageState;
  transcript: string;
  conversationHistory: NonNullable<Scenario['history']>;
  clientContext: {
    client: 'extension';
    clientVersion: string;
    protocolVersion: string;
    locale: string;
  };
} {
  return {
    pageState: pageStateByName(scenario.pageState),
    transcript: scenario.transcript,
    conversationHistory: scenario.history ?? [],
    clientContext: {
      client: 'extension',
      clientVersion: 'eval',
      protocolVersion: '1.0.0',
      locale: 'en-US',
    },
  };
}

export async function runScenario(
  scenario: Scenario,
  deps: { provider: LlmProvider },
): Promise<ScenarioOutcome> {
  const pageState = pageStateByName(scenario.pageState);
  const request = requestFor(scenario);
  const started = performance.now();
  let actual: BrainResponse;
  try {
    const result = await deps.provider.complete({
      system: buildSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: `${JSON.stringify(request.pageState)}\n\nTRANSCRIPT:\n${scenario.transcript}`,
        },
      ],
      schema: BrainResponseSchema,
      schemaName: 'brain_response',
      temperature: 0,
    });
    actual = BrainResponseSchema.parse(result.parsed);
  } catch (error) {
    return {
      id: scenario.id,
      passed: false,
      failures: [
        `provider output was not a valid BrainResponse: ${error instanceof Error ? error.message : String(error)}`,
      ],
      actual: { thoughtProcess: '', actions: [] },
      latencyMs: Math.round(performance.now() - started),
      provider: deps.provider.name,
      model: deps.provider.model,
    };
  }
  const latencyMs = Math.round(performance.now() - started);
  const failures = assertResponse(scenario, pageState, actual);
  return {
    id: scenario.id,
    passed: failures.length === 0,
    failures,
    actual,
    latencyMs,
    provider: deps.provider.name,
    model: deps.provider.model,
  };
}

export interface RunOptions {
  tags?: string[];
  /** Factory so live runs reuse one provider and mock runs swap per scenario. */
  providerFactory?: (scenario: Scenario) => LlmProvider;
  providerName?: string;
  model?: string;
  mode?: 'mock' | 'live';
  now?: () => number;
}

export async function runAll(
  filter: { tags?: string[] } = {},
  options: RunOptions = {},
): Promise<RunSummary> {
  const startedAt = new Date(options.now?.() ?? Date.now()).toISOString();
  const started = performance.now();
  const scenarios = loadScenarios().filter(
    (scenario) => !filter.tags?.length || scenario.tags.some((tag) => filter.tags?.includes(tag)),
  );
  const outcomes: ScenarioOutcome[] = [];

  const factory: (scenario: Scenario) => LlmProvider =
    options.providerFactory ??
    ((scenario) => {
      const provider = new ScenarioMockProvider();
      provider.use(scenario.mock);
      return provider;
    });

  for (const scenario of scenarios) {
    outcomes.push(await runScenario(scenario, { provider: factory(scenario) }));
  }

  const passed = outcomes.filter((outcome) => outcome.passed).length;
  return {
    outcomes,
    passRate: outcomes.length === 0 ? 1 : passed / outcomes.length,
    promptVersion: SYSTEM_PROMPT_VERSION,
    mode: options.mode ?? 'mock',
    startedAt,
    totalMs: Math.round(performance.now() - started),
  };
}

export function renderTable(summary: RunSummary): string {
  const rows = summary.outcomes.map((outcome) => {
    const status = outcome.passed ? 'PASS' : 'FAIL';
    return `${status.padEnd(5)} ${outcome.id.padEnd(28)} ${String(outcome.latencyMs).padStart(5)} ms`;
  });
  const passed = summary.outcomes.filter((outcome) => outcome.passed).length;
  return [
    `Brain evals (${summary.mode}, prompt ${summary.promptVersion})`,
    `${passed}/${summary.outcomes.length} passed — ${(summary.passRate * 100).toFixed(1)}%`,
    '',
    ...rows,
  ].join('\n');
}

export function renderMarkdown(summary: RunSummary): string {
  const lines = [
    `# Brain eval report`,
    '',
    `- Mode: **${summary.mode}**`,
    `- Prompt version: **${summary.promptVersion}**`,
    `- Started: ${summary.startedAt}`,
    `- Duration: ${summary.totalMs} ms`,
    `- Pass rate: **${(summary.passRate * 100).toFixed(1)}%** (${summary.outcomes.filter((o) => o.passed).length}/${summary.outcomes.length})`,
    '',
    '| Scenario | Result | Latency | Failures |',
    '| --- | --- | ---: | --- |',
    ...summary.outcomes.map(
      (outcome) =>
        `| \`${outcome.id}\` | ${outcome.passed ? '✅ pass' : '❌ fail'} | ${outcome.latencyMs} ms | ${
          outcome.failures.length ? outcome.failures.join('<br>').replace(/\|/g, '\\|') : '—'
        } |`,
    ),
    '',
  ];
  return lines.join('\n');
}

export function writeReports(summary: RunSummary, dir?: string): string[] {
  const outDir = dir ?? fileURLToPath(new URL('.', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, summary.mode === 'live' ? 'report.live.json' : 'report.json');
  const mdPath = join(outDir, summary.mode === 'live' ? 'report.live.md' : 'report.md');
  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, renderMarkdown(summary), 'utf8');
  return [jsonPath, mdPath];
}

/** gpt-4o-mini pricing, USD per token. Used only for the nightly cost guard. */
const PRICE_INPUT = 0.15 / 1_000_000;
const PRICE_OUTPUT = 0.6 / 1_000_000;

export function estimateCost(calls: number, promptTokens = 1500, completionTokens = 160): number {
  return calls * (promptTokens * PRICE_INPUT + completionTokens * PRICE_OUTPUT);
}
