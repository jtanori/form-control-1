import { z } from 'zod';

import { BrainResponseSchema } from './brain';
import { PageStateSchema } from './page-state';

/** One turn of the conversation, oldest first. */
export const ConversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(4000),
  at: z.number().int().describe('epoch ms'),
});

export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

/** Everything the client knows, so desktop/mobile clients reuse the contract. */
export const ClientContextSchema = z.object({
  client: z.enum(['extension', 'desktop', 'mobile', 'testbed']),
  clientVersion: z.string(),
  protocolVersion: z.string(),
  locale: z.string().optional(),
  timezone: z.string().optional(),
});

export type ClientContext = z.infer<typeof ClientContextSchema>;

/** Envelope sent by the client to `POST /api/process-command`. */
export const ProcessCommandRequestSchema = z
  .object({
    pageState: PageStateSchema,
    transcript: z.string().min(1).max(2000),
    conversationHistory: z.array(ConversationTurnSchema).max(20).default([]),
    clientContext: ClientContextSchema.optional(),
  })
  .strict();

export type ProcessCommandRequest = z.infer<typeof ProcessCommandRequestSchema>;
export type ProcessCommandRequestInput = z.input<typeof ProcessCommandRequestSchema>;

/** Envelope returned by the Brain. */
export const ProcessCommandResponseSchema = z.object({
  brainResponse: BrainResponseSchema,
  meta: z.object({
    provider: z.string(),
    model: z.string(),
    latencyMs: z.number(),
    requestId: z.string(),
    cached: z.boolean().optional(),
    promptVersion: z.string().optional(),
  }),
});

export type ProcessCommandResponse = z.infer<typeof ProcessCommandResponseSchema>;

/** Shared HUD/agent state (E-1, INT-1, INT-2). */
export const AgentStatusSchema = z.enum([
  'idle',
  'listening',
  'thinking',
  'executing',
  'clarifying',
  'error',
]);

export type AgentStatus = z.infer<typeof AgentStatusSchema>;
