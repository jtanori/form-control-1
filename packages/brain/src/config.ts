import { z } from 'zod';

export const BrainConfigSchema = z.object({
  LLM_PROVIDER: z.enum(['openai', 'groq', 'anthropic', 'mock']).default('openai'),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  BRAIN_PORT: z.coerce.number().int().positive().default(8787),
  BRAIN_AUTH_TOKEN: z.string().optional(),
  CACHE_TTL_MS: z.coerce.number().int().positive().default(600_000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MOCK_LLM: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional(),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.string().default('https://api.groq.com/openai/v1'),
});

export type BrainConfig = z.infer<typeof BrainConfigSchema> & { mock: boolean };

/** Validate the environment at boot and fail fast with a readable message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BrainConfig {
  const parsed = BrainConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid brain configuration:\n${parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    );
  }
  const mock = parsed.data.MOCK_LLM === '1' || parsed.data.MOCK_LLM === 'true';
  const provider = mock ? 'mock' : parsed.data.LLM_PROVIDER;
  if (provider === 'openai' && !parsed.data.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai (or set MOCK_LLM=1)');
  }
  if (provider === 'groq' && !parsed.data.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is required when LLM_PROVIDER=groq (or set MOCK_LLM=1)');
  }
  if (provider === 'anthropic' && !parsed.data.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic (or set MOCK_LLM=1)',
    );
  }
  return { ...parsed.data, LLM_PROVIDER: provider, mock };
}
