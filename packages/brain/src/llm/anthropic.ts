import { zodToJsonSchema } from 'zod-to-json-schema';

import { ProviderError, type LlmCompleteArgs, type LlmProvider, type TokenUsage } from './types';

export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface AnthropicResponse {
  content?: Array<{ type: string; input?: unknown; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Anthropic via tool use, with the JSON schema derived from the zod contract. */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly fetchImpl: FetchLike;

  constructor(config: AnthropicProviderConfig, fetchImpl?: FetchLike) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseURL = config.baseURL ?? 'https://api.anthropic.com/v1/messages';
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async complete(
    args: LlmCompleteArgs,
  ): Promise<{ parsed: unknown; usage: TokenUsage; raw?: string }> {
    const schema = zodToJsonSchema(args.schema, {
      $refStrategy: 'none',
      target: 'openApi3',
    }) as Record<string, unknown>;

    let response: Response;
    try {
      response = await this.fetchImpl(this.baseURL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          temperature: args.temperature ?? 0,
          system: args.system,
          messages: args.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          tools: [
            {
              name: args.schemaName,
              description: 'Return the actions to execute.',
              input_schema: schema,
            },
          ],
          tool_choice: { type: 'tool', name: args.schemaName },
        }),
        ...(args.signal ? { signal: args.signal } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider request failed';
      throw new ProviderError(
        /timeout|aborted/i.test(message) ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
        message,
      );
    }

    if (!response.ok) {
      throw new ProviderError('PROVIDER_UNAVAILABLE', `Anthropic returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as AnthropicResponse;
    const toolUse = payload.content?.find((block) => block.type === 'tool_use');
    if (!toolUse || toolUse.input === undefined) {
      throw new ProviderError('PROVIDER_INVALID_OUTPUT', 'Anthropic returned no tool_use block');
    }
    return {
      parsed: toolUse.input,
      raw: JSON.stringify(toolUse.input),
      usage: {
        promptTokens: payload.usage?.input_tokens ?? 0,
        completionTokens: payload.usage?.output_tokens ?? 0,
      },
    };
  }
}
