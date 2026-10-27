import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';

import { ProviderError, type LlmCompleteArgs, type LlmProvider, type TokenUsage } from './types';

interface ChatClientLike {
  chat: {
    completions: {
      create: (
        args: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
  };
}

interface CompletionLike {
  choices?: Array<{
    message?: { content?: string | null; refusal?: string | null };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAiProviderConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  name?: string;
}

/**
 * OpenAI-compatible provider (also used for Groq). Structured Outputs are
 * enforced through `zodResponseFormat`, never by parsing prose.
 */
export class OpenAiProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  private readonly client: ChatClientLike;

  constructor(config: OpenAiProviderConfig, client?: unknown) {
    this.name = config.name ?? 'openai';
    this.model = config.model;
    this.client =
      (client as ChatClientLike | undefined) ??
      (new OpenAI({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      }) as unknown as ChatClientLike);
  }

  async complete(
    args: LlmCompleteArgs,
  ): Promise<{ parsed: unknown; usage: TokenUsage; raw?: string }> {
    let completion: unknown;
    try {
      completion = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: [
            { role: 'system', content: args.system },
            ...args.messages.map((message) => ({ role: message.role, content: message.content })),
          ],
          response_format: zodResponseFormat(args.schema, args.schemaName),
          temperature: args.temperature ?? 0,
          seed: 0,
        },
        {
          ...(args.timeoutMs ? { timeout: args.timeoutMs } : {}),
          ...(args.signal ? { signal: args.signal } : {}),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider request failed';
      if (/time\s?out|timed out|aborted|ETIMEDOUT|ECONNRESET/i.test(message)) {
        throw new ProviderError('PROVIDER_TIMEOUT', message);
      }
      throw new ProviderError('PROVIDER_UNAVAILABLE', message);
    }

    const result = completion as CompletionLike;
    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      throw new ProviderError('PROVIDER_INVALID_OUTPUT', 'Provider returned empty content');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new ProviderError('PROVIDER_INVALID_OUTPUT', 'Provider returned non-JSON content');
    }
    return {
      parsed,
      raw: content,
      usage: {
        promptTokens: result.usage?.prompt_tokens ?? 0,
        completionTokens: result.usage?.completion_tokens ?? 0,
      },
    };
  }
}
