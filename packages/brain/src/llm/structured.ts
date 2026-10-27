import { ActionSchema } from '@vfe/protocol';
import { z } from 'zod';

/**
 * OpenAI Structured Outputs requires every property to be listed in
 * `required`; optionality is expressed with `null`. The frozen protocol schema
 * uses `.optional()`, so the model contract is derived here and normalised
 * back into `BrainResponseSchema` before it leaves the service.
 */
export const BrainResponseStructuredSchema = z.object({
  thoughtProcess: z.string().describe('Brief reasoning about what the user wants'),
  spokenFeedback: z
    .string()
    .nullable()
    .describe('Short confirmation or question to speak via TTS; null for silence'),
  actions: z.array(ActionSchema),
});

export type BrainResponseStructured = z.infer<typeof BrainResponseStructuredSchema>;

/** Convert `spokenFeedback: null` into an omitted field for the protocol schema. */
export function normaliseStructuredResponse(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  if (record.spokenFeedback !== null) return raw;
  const rest = { ...record };
  delete rest.spokenFeedback;
  return rest;
}
