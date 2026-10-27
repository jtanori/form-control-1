import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { BrainResponse } from '@vfe/protocol';

import { loadConfig } from '../src/config';
import { createProvider } from '../src/llm/factory';

import {
  estimateCost,
  loadScenario,
  loadScenarios,
  renderTable,
  runAll,
  writeReports,
} from './run';
import type { RunSummary, Scenario } from './types';

interface Baseline {
  mock: number;
  live: number;
}

const DIR = fileURLToPath(new URL('.', import.meta.url));
const MAX_COST_USD = Number(process.env.EVAL_MAX_COST_USD ?? '0.5');
const MAX_MOCK_MS = 30_000;

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit?.slice(prefix.length);
}

function baseline(): Baseline {
  try {
    return JSON.parse(readFileSync(`${DIR}baseline.json`, 'utf8')) as Baseline;
  } catch {
    return { mock: 1, live: 0.93 };
  }
}

function printFailures(summary: RunSummary): void {
  for (const outcome of summary.outcomes) {
    if (outcome.passed) continue;
    console.error(`\n✗ ${outcome.id}`);
    for (const failure of outcome.failures) console.error(`  - ${failure}`);
  }
}

function summarise(summary: RunSummary): number {
  console.log(renderTable(summary));
  printFailures(summary);
  const [json, md] = writeReports(summary);
  console.log(`\nWrote ${json}`);
  console.log(`Wrote ${md}`);
  const passed = summary.outcomes.filter((outcome) => outcome.passed).length;
  return passed / Math.max(summary.outcomes.length, 1);
}

async function main(): Promise<void> {
  const tags = arg('tags')?.split(',').filter(Boolean);
  const live = process.env.LIVE === '1' || process.argv.includes('--live');
  const record = process.env.RECORD === '1' || process.argv.includes('--record');
  const repeat = Math.max(
    1,
    Number(arg('repeat') ?? process.env.EVAL_REPEAT ?? (live ? '1' : '1')),
  );
  const limits = baseline();

  if (live || record) {
    const config = loadConfig(process.env);
    if (config.mock) throw new Error('eval:live needs a real provider — unset MOCK_LLM');
    const provider = createProvider(config);
    const scenarios = loadScenarios();
    const projectedCalls = scenarios.length * repeat;
    const projectedCost = estimateCost(projectedCalls);
    if (projectedCost > MAX_COST_USD) {
      throw new Error(
        `Cost guard: ${projectedCalls} calls ≈ $${projectedCost.toFixed(4)} exceeds $${MAX_COST_USD}`,
      );
    }
    console.log(
      `Live eval: ${scenarios.length} scenarios × ${repeat} ≈ $${projectedCost.toFixed(4)} (${provider.name}/${provider.model})`,
    );

    if (record) {
      const summary = await runAll({}, { providerFactory: () => provider, mode: 'live' });
      const passRate = summarise(summary);
      if (passRate < limits.live) {
        throw new Error(
          `Record refused: live pass rate ${(passRate * 100).toFixed(1)}% is below the ${(limits.live * 100).toFixed(0)}% baseline`,
        );
      }
      let updated = 0;
      for (const outcome of summary.outcomes) {
        const scenario = loadScenario(outcome.id) as Scenario;
        recordMock(scenario, outcome.actual, provider.name, provider.model, outcome.latencyMs);
        updated += 1;
      }
      console.log(`Recorded ${updated} mock blocks (human review required before commit).`);
      return;
    }

    let passed = 0;
    let total = 0;
    const merged: RunSummary['outcomes'] = [];
    for (let run = 0; run < repeat; run += 1) {
      const summary = await runAll({ tags }, { providerFactory: () => provider, mode: 'live' });
      passed += summary.outcomes.filter((outcome) => outcome.passed).length;
      total += summary.outcomes.length;
      merged.push(...summary.outcomes);
      process.stdout.write('.');
    }
    process.stdout.write('\n');
    const overall: RunSummary = {
      outcomes: merged,
      passRate: total === 0 ? 1 : passed / total,
      promptVersion: (await import('../src/prompt/system')).SYSTEM_PROMPT_VERSION,
      mode: 'live',
      startedAt: new Date().toISOString(),
      totalMs: 0,
    };
    const passRate = summarise(overall);
    if (passRate < limits.live) {
      throw new Error(
        `Live pass rate ${(passRate * 100).toFixed(1)}% is below the ${(limits.live * 100).toFixed(0)}% baseline`,
      );
    }
    return;
  }

  // Mock mode: fixture-driven, zero network, must be 100 %.
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    fetchCalls += 1;
    return originalFetch(...args);
  }) as typeof fetch;

  const summary = await runAll({ tags }, { mode: 'mock' });
  const passRate = summarise(summary);
  globalThis.fetch = originalFetch;

  if (fetchCalls > 0)
    throw new Error(`Mock eval made ${fetchCalls} network call(s); it must be offline`);
  if (summary.totalMs > MAX_MOCK_MS) {
    throw new Error(`Mock eval took ${summary.totalMs} ms, budget is ${MAX_MOCK_MS} ms`);
  }
  if (passRate < limits.mock) {
    throw new Error(
      `Mock pass rate ${(passRate * 100).toFixed(1)}% is below ${(limits.mock * 100).toFixed(0)}%`,
    );
  }
}

function recordMock(
  scenario: Scenario,
  actual: BrainResponse,
  provider: string,
  model: string,
  latencyMs: number,
): void {
  const path = `${DIR}scenarios/${scenario.id}.json`;
  const next: Scenario = {
    ...scenario,
    recorded: { provider, model, at: new Date().toISOString(), latencyMs },
    mock: actual,
  };
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
