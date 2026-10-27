import { z } from 'zod';

/**
 * The closed set of control types the engine understands. Anything a page
 * renders as one of these can be discovered (Track A) and acted on (Track B).
 */
export const FormElementTypeSchema = z.enum([
  'text',
  'email',
  'password',
  'number',
  'tel',
  'date',
  'textarea',
  'select',
  'checkbox',
  'radio',
  'button',
  'combobox',
]);

/**
 * THE EYES: one interactive control, as the LLM sees it.
 *
 * `value` semantics per type (see A-3):
 * - text-like: the current string (`''` when empty)
 * - checkbox/radio: `boolean`
 * - multi-select: `string[]`
 * - password: always `'<redacted>'`
 */
export const FormElementSchema = z.object({
  id: z.string().describe("Unique generated ID, e.g., 'vfe_1'"),
  badgeIndex: z.number().describe('Visual number shown to user, e.g., 1'),
  type: FormElementTypeSchema,
  label: z.string().describe('Resolved human-readable label'),
  placeholder: z.string().optional(),
  value: z.union([z.string(), z.boolean(), z.array(z.string())]),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  required: z.boolean(),
  disabled: z.boolean(),
  focused: z.boolean(),
  validationError: z.string().optional().describe('Visible error message attached to field'),
  groupLabel: z
    .string()
    .optional()
    .describe("Fieldset legend or section header, e.g., 'Shipping Address'"),
});

export type FormElement = z.infer<typeof FormElementSchema>;
export type FormElementType = z.infer<typeof FormElementTypeSchema>;
export type FormElementOption = NonNullable<FormElement['options']>[number];
