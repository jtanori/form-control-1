import { defineConfig } from '@playwright/test';

/**
 * Extension audio E2E needs a real Chromium with an extension origin and the
 * fake-media flags, so it runs explicitly:
 *   RUN_EXTENSION_E2E=1 pnpm --filter @vfe/extension test:e2e:audio
 */
export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
