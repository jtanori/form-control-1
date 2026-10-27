import { defineConfig } from '@playwright/test';

/** HUD isolation suite: a plain page plus an injected bundle, so headless works. */
export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  // The `github` reporter turns a failure into a check annotation, which is the
  // only failure channel available when job logs are not readable.
  reporter: [['list'], ['github']],
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
