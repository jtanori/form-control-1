import { z } from 'zod';

import { FormElementSchema } from './element';

/**
 * THE EYES: a pure snapshot of the actionable parts of a page.
 * Produced by `distillPage()` (A-3), consumed by the Brain (C-1).
 */
export const PageStateSchema = z.object({
  urlOrAppTitle: z.string(),
  elements: z.array(FormElementSchema),
  globalErrors: z.array(z.string()).optional(),
});

export type PageState = z.infer<typeof PageStateSchema>;
