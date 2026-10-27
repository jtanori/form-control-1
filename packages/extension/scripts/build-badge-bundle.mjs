// Bundles the badge overlay for the Playwright isolation suite. The entry file
// installs the harness on `globalThis`, so no `globalName` (which would clobber
// it with the entry's empty export object).
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(here, '../test/browser/.bundle/badges.js');
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(here, '../test/browser/badges-entry.ts')],
  outfile,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'info',
});
