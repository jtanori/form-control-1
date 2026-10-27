import type { BrainConfig } from '../config';

import { AnthropicProvider } from './anthropic';
import { MockProvider } from './mock';
import { OpenAiProvider } from './openai';
import type { LlmProvider } from './types';

export function createProvider(config: BrainConfig): LlmProvider {
  if (config.mock || config.LLM_PROVIDER === 'mock') return new MockProvider();
  if (config.LLM_PROVIDER === 'anthropic') {
    return new AnthropicProvider({
      apiKey: config.ANTHROPIC_API_KEY ?? '',
      model: config.LLM_MODEL,
    });
  }
  if (config.LLM_PROVIDER === 'groq') {
    return new OpenAiProvider({
      apiKey: config.GROQ_API_KEY ?? '',
      model: config.LLM_MODEL,
      baseURL: config.GROQ_BASE_URL,
      name: 'groq',
    });
  }
  return new OpenAiProvider({
    apiKey: config.OPENAI_API_KEY ?? '',
    model: config.LLM_MODEL,
  });
}
