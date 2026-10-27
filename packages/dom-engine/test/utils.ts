import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { mockLayout, type MockLayoutConfig } from '../../../vitest.setup';

/**
 * Vitest runs packages either from the repo root (workspace mode) or from the
 * package directory (`pnpm --filter`). Resolve the fixture folder from wherever
 * the process starts.
 */
const fixturesDir = [
  resolve(process.cwd(), 'test/fixtures'),
  resolve(process.cwd(), 'packages/dom-engine/test/fixtures'),
].find((candidate) => existsSync(candidate));

if (!fixturesDir) throw new Error('Unable to locate packages/dom-engine/test/fixtures');

/** Load an HTML fixture into `document.body`. */
export function loadFixture(path: string): void {
  document.body.innerHTML = readFileSync(join(fixturesDir, path), 'utf8');
}

/** Give an element (or every element under a root) a synthetic jsdom layout box. */
export function show<T extends Element>(el: T, config: MockLayoutConfig = {}): T {
  return mockLayout(el, config);
}

export function showAll(root: ParentNode, config: MockLayoutConfig = {}): void {
  if (root instanceof Element) show(root, config);
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el instanceof HTMLElement || el instanceof SVGElement) show(el, config);
  }
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing fixture element #${id}`);
  return el as T;
}

/** Collect console calls so tests can assert the engine is silent. */
export function spyConsole(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const original = methods.map((m) => console[m]);
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      calls.push(`${method}: ${args.map(String).join(' ')}`);
    };
  }
  return {
    calls,
    restore: () => {
      methods.forEach((m, index) => {
        console[m] = original[index] as typeof console.log;
      });
    },
  };
}
