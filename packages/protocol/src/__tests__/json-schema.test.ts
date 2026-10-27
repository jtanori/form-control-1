import { describe, expect, it } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { BrainResponseSchema } from '../brain';
import { ProcessCommandRequestSchema } from '../transport';

describe('Structured Outputs compatibility', () => {
  const jsonSchema = zodToJsonSchema(BrainResponseSchema, { $refStrategy: 'none' });
  const serialised = JSON.stringify(jsonSchema);

  it('emits a snapshot-stable schema', () => {
    expect(jsonSchema).toMatchSnapshot();
  });

  it('contains no $ref cycles', () => {
    expect(serialised).not.toContain('$ref');
  });

  it('contains no transform/preprocess artefacts', () => {
    expect(serialised).not.toContain('transform');
    expect(serialised).not.toContain('preprocess');
    expect(serialised).not.toContain('effects');
  });

  it('documents fields via descriptions', () => {
    expect(serialised).toContain('Brief reasoning about what the user wants');
  });

  it('keeps the request envelope free of refinements', () => {
    const requestSchema = JSON.stringify(
      zodToJsonSchema(ProcessCommandRequestSchema, { $refStrategy: 'none' }),
    );
    expect(requestSchema).not.toContain('"transform"');
  });
});
