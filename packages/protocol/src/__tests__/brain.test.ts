import { describe, expect, it } from 'vitest';

import { BrainResponseSchema } from '../brain';

describe('BrainResponseSchema', () => {
  it('accepts a response with actions', () => {
    const response = {
      thoughtProcess: 'Fill the first name.',
      spokenFeedback: 'Filled your first name.',
      actions: [{ action: 'FILL', targetId: 'vfe_1', value: 'Alice' }],
    };
    expect(BrainResponseSchema.parse(response)).toEqual(response);
  });

  it('accepts a response without spoken feedback', () => {
    const response = { thoughtProcess: 'Nothing to do.', actions: [] };
    expect(BrainResponseSchema.parse(response)).toEqual(response);
  });

  it('rejects a missing actions array', () => {
    expect(BrainResponseSchema.safeParse({ thoughtProcess: 'x' }).success).toBe(false);
  });

  it('rejects a non-string thought process', () => {
    expect(BrainResponseSchema.safeParse({ thoughtProcess: 1, actions: [] }).success).toBe(false);
  });

  it('rejects invalid actions', () => {
    expect(
      BrainResponseSchema.safeParse({
        thoughtProcess: 'x',
        actions: [{ action: 'FILL', targetId: 'vfe_1' }],
      }).success,
    ).toBe(false);
  });

  it('documents every field for Structured Outputs', () => {
    const shape = BrainResponseSchema.shape;
    expect(shape.thoughtProcess.description).toBeDefined();
    expect(shape.spokenFeedback.description).toBeDefined();
  });
});
