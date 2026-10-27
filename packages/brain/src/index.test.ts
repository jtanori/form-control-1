import { describe, expect, it } from 'vitest';

import { BRAIN_VERSION } from './index';

describe('brain placeholder', () => {
  it('exports a version', () => {
    expect(BRAIN_VERSION).toBeDefined();
  });
});
