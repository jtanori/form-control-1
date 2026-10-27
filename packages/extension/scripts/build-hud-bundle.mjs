// Bundles the HUD into a single IIFE so the Playwright isolation suite can
// inject it into a real browser page. Output is generated and git-ignored.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(here, '../test/browser/.bundle/hud.js');
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(here, '../test/browser/hud-entry.ts')],
  outfile,
  bundle: true,
  format: 'iife',
  globalName: 'VfeHudHarness',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'info',
});
