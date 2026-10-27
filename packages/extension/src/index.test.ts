import { describe, expect, it } from 'vitest';

import { EXTENSION_VERSION } from './index';

describe('extension placeholder', () => {
  it('exports a version', () => {
    expect(EXTENSION_VERSION).toBeDefined();
  });
});
