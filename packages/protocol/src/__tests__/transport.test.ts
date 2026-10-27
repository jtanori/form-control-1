import { describe, expect, it } from 'vitest';

import { checkoutPageState } from '../fixtures';
import {
  AgentStatusSchema,
  ConversationTurnSchema,
  ProcessCommandRequestSchema,
  ProcessCommandResponseSchema,
} from '../transport';

const request = {
  pageState: checkoutPageState,
  transcript: 'my name is Alice',
};

describe('ProcessCommandRequestSchema', () => {
  it('defaults conversationHistory to an empty array', () => {
    expect(ProcessCommandRequestSchema.parse(request).conversationHistory).toEqual([]);
  });

  it('accepts a full envelope', () => {
    const parsed = ProcessCommandRequestSchema.parse({
      ...request,
      conversationHistory: [{ role: 'user', text: 'hi', at: 1730000000000 }],
      clientContext: {
        client: 'extension',
        clientVersion: '0.1.0',
        protocolVersion: '1.0.0',
        locale: 'en-US',
        timezone: 'America/Phoenix',
      },
    });
    expect(parsed.clientContext?.client).toBe('extension');
  });

  it('rejects unknown top-level keys', () => {
    expect(ProcessCommandRequestSchema.safeParse({ ...request, extra: true }).success).toBe(false);
  });

  it('rejects an empty transcript', () => {
    expect(ProcessCommandRequestSchema.safeParse({ ...request, transcript: '' }).success).toBe(
      false,
    );
  });

  it('rejects a transcript longer than 2000 chars', () => {
    expect(
      ProcessCommandRequestSchema.safeParse({ ...request, transcript: 'a'.repeat(2001) }).success,
    ).toBe(false);
  });

  it('rejects more than 20 history turns', () => {
    const history = Array.from({ length: 21 }, () => ({
      role: 'user' as const,
      text: 'hi',
      at: 1,
    }));
    expect(
      ProcessCommandRequestSchema.safeParse({ ...request, conversationHistory: history }).success,
    ).toBe(false);
  });

  it('rejects an unknown client kind', () => {
    expect(
      ProcessCommandRequestSchema.safeParse({
        ...request,
        clientContext: { client: 'tv', clientVersion: '1', protocolVersion: '1.0.0' },
      }).success,
    ).toBe(false);
  });

  it('rejects a missing page state', () => {
    const result = ProcessCommandRequestSchema.safeParse({ transcript: 'x' });
    expect(result.success).toBe(false);
  });
});

describe('ProcessCommandResponseSchema', () => {
  it('parses a full response', () => {
    const response = {
      brainResponse: { thoughtProcess: 'ok', actions: [] },
      meta: { provider: 'openai', model: 'gpt-4o-mini', latencyMs: 812, requestId: 'req_1' },
    };
    expect(ProcessCommandResponseSchema.parse(response)).toEqual(response);
  });

  it('rejects a response without meta', () => {
    expect(
      ProcessCommandResponseSchema.safeParse({
        brainResponse: { thoughtProcess: 'ok', actions: [] },
      }).success,
    ).toBe(false);
  });
});

describe('ConversationTurnSchema', () => {
  it('accepts both roles', () => {
    for (const role of ['user', 'assistant'] as const) {
      expect(ConversationTurnSchema.parse({ role, text: 'x', at: 1 }).role).toBe(role);
    }
  });

  it('rejects a non-integer timestamp', () => {
    expect(ConversationTurnSchema.safeParse({ role: 'user', text: 'x', at: 1.5 }).success).toBe(
      false,
    );
  });

  it('rejects an unknown role', () => {
    expect(ConversationTurnSchema.safeParse({ role: 'system', text: 'x', at: 1 }).success).toBe(
      false,
    );
  });

  it('rejects text longer than 4000 chars', () => {
    expect(
      ConversationTurnSchema.safeParse({ role: 'user', text: 'a'.repeat(4001), at: 1 }).success,
    ).toBe(false);
  });
});

describe('AgentStatusSchema', () => {
  it('declares the six statuses used by the HUD and the loop', () => {
    expect(AgentStatusSchema.options).toEqual([
      'idle',
      'listening',
      'thinking',
      'executing',
      'clarifying',
      'error',
    ]);
  });
});
