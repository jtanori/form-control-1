// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/** Acceptance criterion: the HUD ships under 20 KB min+gzip, no runtime deps. */
describe('HUD bundle budget', () => {
  it('stays under 20 KB min+gzip', async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL('../src/content/hud/mount.ts', import.meta.url))],
      bundle: true,
      minify: true,
      write: false,
      format: 'esm',
      target: 'es2022',
      logLevel: 'silent',
    });
    const output = result.outputFiles?.[0]?.contents ?? new Uint8Array();
    const gzipped = gzipSync(Buffer.from(output)).byteLength;
    expect(gzipped).toBeLessThan(20 * 1024);
    expect(output.byteLength).toBeLessThan(60 * 1024);
  });
});
