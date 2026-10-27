import { describe, expect, it } from 'vitest';

import { DOM_ENGINE_VERSION } from '../src/index';

describe('dom-engine placeholder', () => {
  it('exports a version', () => {
    expect(DOM_ENGINE_VERSION).toBeDefined();
  });
});
