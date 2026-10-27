import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from './index';

describe('protocol placeholder', () => {
  it('exports a version', () => {
    expect(PROTOCOL_VERSION).toBe('0.0.0-pending');
  });
});
