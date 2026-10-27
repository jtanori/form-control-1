import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@vfe/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)),
      '@vfe/dom-engine': fileURLToPath(new URL('../dom-engine/src/index.ts', import.meta.url)),
    },
  },
  test: {
    name: 'extension',
    root: __dirname,
    environment: 'jsdom',
    setupFiles: [fileURLToPath(new URL('../../vitest.setup.ts', import.meta.url))],
    include: ['src/**/*.test.ts'],
  },
});
