import { defineWorkspace } from 'vitest/config';

/**
 * One project per package. Each package owns its `vitest.config.ts` so it can
 * run standalone (`pnpm --filter @vfe/x test`) or from the root (`pnpm test`).
 */
export default defineWorkspace([
  'packages/protocol',
  'packages/dom-engine',
  'packages/brain',
  'packages/extension',
  'packages/testbed',
]);
