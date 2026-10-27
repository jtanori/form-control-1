import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Vitest runs packages either from the repo root (workspace mode) or from the
 * package directory (`pnpm --filter`). Resolve the source folder from wherever
 * the process starts.
 */
const candidates = [
  resolve(process.cwd(), 'src/content'),
  resolve(process.cwd(), 'packages/extension/src/content'),
];
const CONTENT_DIR = candidates.find((candidate) => existsSync(candidate));
if (!CONTENT_DIR) throw new Error('Unable to locate packages/extension/src/content');

const BANNED = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Defends the "untrusted text never becomes markup" rule at the source level. */
describe('content script markup safety', () => {
  it('scans the content script sources', () => {
    expect(files(CONTENT_DIR as string).length).toBeGreaterThan(3);
  });

  it('never assigns HTML strings', () => {
    const offenders = files(CONTENT_DIR as string).filter((path) => {
      const source = readFileSync(path, 'utf8');
      return BANNED.some((token) => source.includes(token));
    });
    expect(offenders).toEqual([]);
  });
});
