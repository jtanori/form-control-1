import { defineConfig } from '@playwright/test';

/** HUD isolation suite: a plain page plus an injected bundle, so headless works. */
export default defineConfig({
  testDir: './test/browser',
  fullyParallel: true,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
});
