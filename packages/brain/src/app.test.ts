import type { BrainResponse, ProcessCommandRequest } from '@vfe/protocol';
import { checkoutPageState } from '@vfe/protocol/fixtures';
import { describe, expect, it, beforeEach } from 'vitest';

import { createApp } from './app';
import { loadConfig, type BrainConfig } from './config';
import { MockProvider } from './llm/mock';
import { OpenAiProvider } from './llm/openai';
import type { LlmCompleteArgs, LlmProvider, TokenUsage } from './llm/types';
import { createConsoleLogger, silentLogger, type BrainLogger } from './logger';
import { buildSystemPrompt } from './prompt/system';
import { buildUserMessage } from './prompt/user-message';
import { resetBrainState } from './service';

function testConfig(overrides: Record<string, string> = {}): BrainConfig {
  return loadConfig({
    MOCK_LLM: '1',
    RATE_LIMIT_PER_MINUTE: '1000',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

class ScriptedProvider implements LlmProvider {
  readonly name = 'openai';
  readonly model = 'test-model';
  readonly calls: LlmCompleteArgs[] = [];
  private readonly script: unknown[];

  constructor(script: unknown[]) {
    this.script = [...script];
  }

  async complete(args: LlmCompleteArgs): Promise<{ parsed: unknown; usage: TokenUsage }> {
    this.calls.push(args);
    const next = this.script.shift();
    if (next instanceof Error) throw next;
    if (next === 'hang') return new Promise(() => undefined);
    return { parsed: next, usage: { promptTokens: 10, completionTokens: 5 } };
  }
}

const validBrain: BrainResponse = {
  thoughtProcess: 'User wants their first name filled.',
  spokenFeedback: 'Filled in your first name.',
  actions: [{ action: 'FILL', targetId: 'vfe_1', value: 'Alice' }],
};

function request(overrides: Partial<ProcessCommandRequest> = {}): ProcessCommandRequest {
  return {
    pageState: checkoutPageState,
    transcript: 'my name is Alice',
    conversationHistory: [],
    clientContext: {
      client: 'extension',
      clientVersion: '0.1.0',
      protocolVersion: '1.0.0',
      locale: 'en-US',
    },
    ...overrides,
  };
}

function appWith(
  provider?: LlmProvider,
  overrides: Record<string, string> = {},
  logger?: BrainLogger,
) {
  const config = testConfig(overrides);
  return { app: createApp({ config, provider, logger: logger ?? silentLogger }), config };
}

function post(
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request('/api/process-command', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetBrainState();
});

describe('GET /healthz and /api/capabilities', () => {
  it('answers health without auth even when a token is configured', async () => {
    const { app } = appWith(undefined, { BRAIN_AUTH_TOKEN: 'secret' });
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.version).toBe('1.0.0');
  });

  it('advertises the action kinds and protocol version', async () => {
    const { app } = appWith();
    const res = await app.request('/api/capabilities');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.protocolVersion).toBe('1.0.0');
    expect(body.actionKinds).toHaveLength(8);
    expect(body.activeProvider).toBe('mock');
  });

  it('404s unknown routes', async () => {
    const { app } = appWith();
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('POST /api/process-command validation', () => {
  it('rejects malformed bodies with issue paths', async () => {
    const { app, config } = appWith();
    void config;
    const res = await post(app, { transcript: 'hello' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('INVALID_REQUEST');
    expect((body.issues as Array<{ path: string }>)[0]?.path).toContain('pageState');
  });

  it('rejects oversized transcripts', async () => {
    const { app } = appWith();
    const res = await post(app, request({ transcript: 'a'.repeat(2001) }));
    expect(res.status).toBe(400);
  });

  it('rejects non-JSON bodies', async () => {
    const { app } = appWith();
    const res = await app.request('/api/process-command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('returns 409 for an incompatible protocol version', async () => {
    const { app } = appWith();
    const body = request({
      clientContext: { client: 'extension', clientVersion: '0.1.0', protocolVersion: '2.0.0' },
    });
    const res = await post(app, body);
    expect(res.status).toBe(409);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      code: 'UNSUPPORTED_PROTOCOL_VERSION',
      details: { serverProtocolVersion: '1.0.0' },
    });
  });

  it('requires a bearer token when BRAIN_AUTH_TOKEN is set', async () => {
    const { app } = appWith(undefined, { BRAIN_AUTH_TOKEN: 'secret' });
    expect((await post(app, request())).status).toBe(401);
    expect((await post(app, request(), { authorization: 'Bearer secret' })).status).toBe(200);
  });
});

describe('happy path', () => {
  it('returns a schema-valid response from the mock provider', async () => {
    const { app } = appWith();
    const res = await post(app, request());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      brainResponse: BrainResponse;
      meta: { provider: string; model: string; latencyMs: number; promptVersion?: string };
    };
    expect(body.meta.provider).toBe('mock');
    expect(body.meta.promptVersion).toBe('1.0.0');
    expect(body.brainResponse.actions.length).toBeGreaterThan(0);
    expect(typeof body.meta.latencyMs).toBe('number');
  });

  it('keeps handler overhead under 50 ms with the mock provider', async () => {
    const { app } = appWith();
    const started = performance.now();
    const res = await post(app, request());
    const elapsed = performance.now() - started;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(50);
  });

  it('fills from a scripted provider response', async () => {
    const provider = new ScriptedProvider([validBrain]);
    const { app } = appWith(provider);
    const res = await post(app, request());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { brainResponse: BrainResponse };
    expect(body.brainResponse.actions[0]).toEqual({
      action: 'FILL',
      targetId: 'vfe_1',
      value: 'Alice',
    });
    expect(provider.calls).toHaveLength(1);
  });
});

describe('reliability mechanics', () => {
  it('repairs invalid model output with exactly one retry', async () => {
    const provider = new ScriptedProvider([{ thoughtProcess: 'x' }, validBrain]);
    const { app } = appWith(provider);
    const res = await post(app, request());
    expect(res.status).toBe(200);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.messages.at(-1)?.content).toContain('failed validation');
  });

  it('returns 422 when two model attempts are unparseable', async () => {
    const provider = new ScriptedProvider([{ nope: true }, { still: 'wrong' }]);
    const { app } = appWith(provider);
    const res = await post(app, request());
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('UNPROCESSABLE_BRAIN_OUTPUT');
  });

  it('returns 504 when the provider hangs', async () => {
    const provider = new ScriptedProvider(['hang']);
    const { app } = appWith(provider, { LLM_TIMEOUT_MS: '25' });
    const res = await post(app, request());
    expect(res.status).toBe(504);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      code: 'PROVIDER_TIMEOUT',
    });
  });

  it('returns 503 when the provider throws', async () => {
    const provider = new ScriptedProvider([new Error('socket closed')]);
    const { app } = appWith(provider);
    const res = await post(app, request());
    expect(res.status).toBe(503);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('caches identical requests for a single provider call', async () => {
    const provider = new ScriptedProvider([validBrain, validBrain]);
    const { app } = appWith(provider);
    const first = (await (await post(app, request())).json()) as { meta: { cached?: boolean } };
    const second = (await (await post(app, request())).json()) as { meta: { cached?: boolean } };
    expect(first.meta.cached).toBeUndefined();
    expect(second.meta.cached).toBe(true);
    expect(provider.calls).toHaveLength(1);
  });

  it('replays idempotent requests and rejects a body mismatch', async () => {
    const provider = new ScriptedProvider([validBrain, validBrain]);
    const { app } = appWith(provider);
    const headers = { 'idempotency-key': 'key-1' };
    const first = await post(app, request(), headers);
    const replay = await post(app, request(), headers);
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as { meta: { cached?: boolean } };
    expect(replayBody.meta.cached).toBe(true);
    expect(provider.calls).toHaveLength(1);

    const mismatch = await post(app, request({ transcript: 'different' }), headers);
    expect(mismatch.status).toBe(409);
    expect((await mismatch.json()) as Record<string, unknown>).toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
    });
    void first;
  });

  it('rate limits a client after its per-minute budget', async () => {
    const { app } = appWith(undefined, { RATE_LIMIT_PER_MINUTE: '2' });
    expect((await post(app, request())).status).toBe(200);
    expect((await post(app, request({ transcript: 'second' }))).status).toBe(200);
    const limited = await post(app, request({ transcript: 'third' }));
    expect(limited.status).toBe(429);
    expect((await limited.json()) as Record<string, unknown>).toMatchObject({
      code: 'RATE_LIMITED',
    });
  });
});

describe('unknown target guard', () => {
  const hallucinated: BrainResponse = {
    thoughtProcess: 'Guess',
    actions: [{ action: 'FILL', targetId: 'vfe_999', value: 'x' }],
  };

  it('retries once with a correction and then returns 422', async () => {
    const provider = new ScriptedProvider([hallucinated, hallucinated]);
    const { app } = appWith(provider);
    const res = await post(app, request());
    expect(res.status).toBe(422);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      code: 'UNKNOWN_TARGET',
      details: { unknown: ['vfe_999'] },
    });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.messages.at(-1)?.content).toContain('vfe_999');
  });

  it('accepts a corrected response', async () => {
    const provider = new ScriptedProvider([hallucinated, validBrain]);
    const { app } = appWith(provider);
    const res = await post(app, request());
    expect(res.status).toBe(200);
  });
});

describe('privacy', () => {
  it('never logs transcripts or secrets', async () => {
    const lines: string[] = [];
    const logger: BrainLogger = {
      debug: (event) => lines.push(JSON.stringify(event)),
      info: (event) => lines.push(JSON.stringify(event)),
      warn: (event) => lines.push(JSON.stringify(event)),
      error: (event) => lines.push(JSON.stringify(event)),
    };
    const { app } = appWith(new ScriptedProvider([validBrain]), {}, logger);
    await post(app, request({ transcript: 'my password is hunter2' }));
    const joined = lines.join('\n');
    expect(joined).toContain('outcome');
    expect(joined).not.toContain('hunter2');
    expect(joined).not.toContain('password is');
  });

  it('has a console logger that respects levels', () => {
    const logger = createConsoleLogger('error');
    expect(() => logger.debug({ event: 'x' })).not.toThrow();
  });
});

describe('prompt', () => {
  it('matches the reviewed snapshot', () => {
    expect(buildSystemPrompt()).toMatchSnapshot();
  });

  it('documents every hard rule and the normalisation table', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('never invent element IDs');
    expect(prompt).toContain('ASK_CLARIFICATION');
    expect(prompt).toContain('1990-03-05');
    expect(prompt).toContain('john@gmail.com');
    expect(prompt.length).toBeLessThan(12_000);
  });

  it('compacts the page state for the model', () => {
    const userMessage = buildUserMessage(request());
    const parsed = JSON.parse(userMessage.split('\n')[0] ?? '{}') as {
      elements: Array<Record<string, unknown>>;
    };
    expect(parsed.elements[0]).toMatchObject({
      id: 'vfe_1',
      n: 1,
      type: 'text',
      label: 'First Name',
    });
    expect(parsed.elements[0]).not.toHaveProperty('value');
    expect(parsed.elements[0]).not.toHaveProperty('disabled');
    expect(userMessage).not.toContain('"placeholder"');
  });
});

describe('provider adapters', () => {
  it('wires OpenAI Structured Outputs and parses JSON content', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = {
      chat: {
        completions: {
          create: (args: Record<string, unknown>) => {
            calls.push(args);
            return Promise.resolve({
              choices: [{ message: { content: JSON.stringify(validBrain) } }],
              usage: { prompt_tokens: 7, completion_tokens: 3 },
            });
          },
        },
      },
    };
    const provider = new OpenAiProvider({ apiKey: 'sk-test', model: 'gpt-4o-mini' }, client);
    const result = await provider.complete({
      system: 'system',
      messages: [{ role: 'user', content: 'hello' }],
      schema: (await import('./llm/structured')).BrainResponseStructuredSchema,
      schemaName: 'brain_response',
    });
    expect(result.parsed).toEqual(validBrain);
    const args = calls[0] as {
      response_format: { type: string; json_schema: { name: string; strict: boolean } };
      temperature: number;
    };
    expect(args.response_format.type).toBe('json_schema');
    expect(args.response_format.json_schema.name).toBe('brain_response');
    expect(args.response_format.json_schema.strict).toBe(true);
    expect(args.temperature).toBe(0);
    expect(result.usage).toEqual({ promptTokens: 7, completionTokens: 3 });
  });

  it('maps a hanging client to PROVIDER_TIMEOUT', async () => {
    const client = {
      chat: {
        completions: {
          create: () => Promise.reject(new Error('Request timed out.')),
        },
      },
    };
    const provider = new OpenAiProvider({ apiKey: 'sk-test', model: 'gpt-4o-mini' }, client);
    await expect(
      provider.complete({
        system: 's',
        messages: [],
        schema: (await import('./llm/structured')).BrainResponseStructuredSchema,
        schemaName: 'brain_response',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
  });

  it('is deterministic in mock mode', async () => {
    const provider = new MockProvider();
    const args: LlmCompleteArgs = {
      system: 's',
      messages: [{ role: 'user', content: 'PAGE STATE:\n{"elements":[]}\n\nTRANSCRIPT:\nblah' }],
      schema: await import('@vfe/protocol').then((m) => m.BrainResponseSchema),
      schemaName: 'brain_response',
    };
    const first = await provider.complete(args);
    const second = await provider.complete(args);
    expect(first.parsed).toEqual(second.parsed);
  });
});

describe('structured output contract', () => {
  it('normalises a null spokenFeedback into the frozen protocol shape', async () => {
    const provider = new ScriptedProvider([
      {
        thoughtProcess: 'No need to speak.',
        spokenFeedback: null,
        actions: [{ action: 'CLICK', targetId: 'vfe_8' }],
      },
    ]);
    const { app } = appWith(provider);
    const res = await post(app, request());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { brainResponse: BrainResponse };
    expect(body.brainResponse.spokenFeedback).toBeUndefined();
  });

  it('declares every property as required for strict structured outputs', async () => {
    const { BrainResponseStructuredSchema } = await import('./llm/structured');
    const shape = BrainResponseStructuredSchema.shape;
    expect(Object.keys(shape).sort()).toEqual(['actions', 'spokenFeedback', 'thoughtProcess']);
    expect(shape.spokenFeedback.isOptional()).toBe(false);
  });
});

describe('config', () => {
  it('requires a key for a real provider', () => {
    expect(() => loadConfig({ LLM_PROVIDER: 'openai' } as NodeJS.ProcessEnv)).toThrow(
      /OPENAI_API_KEY/,
    );
  });

  it('allows zero-key mock mode', () => {
    const config = loadConfig({ MOCK_LLM: '1' } as NodeJS.ProcessEnv);
    expect(config.mock).toBe(true);
    expect(config.LLM_PROVIDER).toBe('mock');
  });

  it('rejects nonsense numbers with a readable message', () => {
    expect(() =>
      loadConfig({ MOCK_LLM: '1', BRAIN_PORT: 'not-a-number' } as NodeJS.ProcessEnv),
    ).toThrow(/BRAIN_PORT/);
  });
});
