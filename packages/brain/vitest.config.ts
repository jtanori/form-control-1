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
    name: 'brain',
    root: __dirname,
    environment: 'node',
    include: ['src/**/*.test.ts', 'evals/**/*.test.ts'],
    testTimeout: 20000,
  },
});
