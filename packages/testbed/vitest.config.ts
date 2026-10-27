import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'testbed',
    root: __dirname,
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
  },
});
