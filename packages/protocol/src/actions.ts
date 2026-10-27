import { z } from 'zod';

/** THE HANDS: every action the executor understands. Discriminated by `action`. */
export const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('FILL'), targetId: z.string(), value: z.string() }),
  z.object({ action: z.literal('SELECT'), targetId: z.string(), value: z.string() }),
  z.object({ action: z.literal('SET_CHECKED'), targetId: z.string(), checked: z.boolean() }),
  z.object({ action: z.literal('CLICK'), targetId: z.string() }),
  z.object({ action: z.literal('FOCUS'), targetId: z.string() }),
  z.object({ action: z.literal('CLEAR'), targetId: z.string() }),
  z.object({ action: z.literal('SCROLL'), direction: z.enum(['up', 'down', 'top', 'bottom']) }),
  z.object({ action: z.literal('ASK_CLARIFICATION'), questionToUser: z.string() }),
]);

export type Action = z.infer<typeof ActionSchema>;
export type ActionKind = Action['action'];
export type ScrollDirection = Extract<Action, { action: 'SCROLL' }>['direction'];

/** Closed set of execution failures surfaced to the HUD and the Brain. */
export const ActionErrorCodeSchema = z.enum([
  'ELEMENT_NOT_FOUND',
  'ELEMENT_DISABLED',
  'ELEMENT_NOT_FILLABLE',
  'OPTION_NOT_FOUND',
  'VALUE_MISMATCH',
  'VALUE_INVALID',
  'TIMEOUT',
  'ABORTED',
]);

export type ActionErrorCode = z.infer<typeof ActionErrorCodeSchema>;

/** Execution result produced by B-3, rendered by E-1/E-2, consumed by INT-2. */
export const ActionResultSchema = z.object({
  action: ActionSchema,
  ok: z.boolean(),
  error: z
    .object({
      code: ActionErrorCodeSchema,
      message: z.string(),
      details: z.record(z.unknown()).optional(),
    })
    .optional(),
  warnings: z.array(z.string()).default([]),
  durationMs: z.number(),
});

export type ActionResult = z.infer<typeof ActionResultSchema>;
