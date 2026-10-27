import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@vfe/protocol/fixtures': fileURLToPath(
        new URL('../protocol/src/fixtures.ts', import.meta.url),
      ),
      '@vfe/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)),
    },
  },
  test: {
    name: 'dom-engine',
    root: __dirname,
    environment: 'jsdom',
    setupFiles: [fileURLToPath(new URL('../../vitest.setup.ts', import.meta.url))],
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
