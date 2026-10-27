import { z } from 'zod';

import { ActionSchema } from './actions';

/**
 * The model's response. This schema is the Structured Outputs contract:
 * it must stay free of transforms/preprocess/refinements.
 */
export const BrainResponseSchema = z.object({
  thoughtProcess: z.string().describe('Brief reasoning about what the user wants'),
  spokenFeedback: z.string().optional().describe('Short confirmation or question to speak via TTS'),
  actions: z.array(ActionSchema),
});

export type BrainResponse = z.infer<typeof BrainResponseSchema>;
