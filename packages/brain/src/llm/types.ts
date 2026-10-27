import type { z } from 'zod';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmCompleteArgs {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  schema: z.ZodTypeAny;
  schemaName: string;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(args: LlmCompleteArgs): Promise<{ parsed: unknown; usage: TokenUsage; raw?: string }>;
}

export class ProviderError extends Error {
  readonly code: 'PROVIDER_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'PROVIDER_INVALID_OUTPUT';

  constructor(
    code: 'PROVIDER_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'PROVIDER_INVALID_OUTPUT',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

export function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    (error.code === 'PROVIDER_TIMEOUT' || /time\s?out|aborted/i.test(error.message))
  );
}
