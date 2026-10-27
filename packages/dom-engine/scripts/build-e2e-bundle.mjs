// Bundles the dom-engine into a single IIFE so Playwright can inject it into a
// real browser page without running a dev server. Output is generated, ignored
// by git, and rebuilt by `pnpm test:e2e`.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(here, '../test/browser/.bundle/dom-engine.js');
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(here, '../src/index.ts')],
  outfile,
  bundle: true,
  format: 'iife',
  globalName: 'VfeDomEngine',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'info',
});
