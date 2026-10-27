import { z } from 'zod';

export const EdgeConfigSchema = z.object({
  EDGE_PORT: z.coerce.number().int().positive().default(8788),
  BRAIN_URL: z.string().default('http://localhost:8787'),
  BRAIN_AUTH_TOKEN: z.string().optional(),
  EDGE_BRAIN_URL: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  STT_PROVIDER: z.enum(['groq', 'deepgram']).default('groq'),
  EDGE_SESSION_SECRET: z.string().optional(),
  ALLOWED_EXTENSION_IDS: z.string().default(''),
  MAX_AUDIO_SECONDS: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),
  STT_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(20),
  MOCK_STT: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional(),
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface EdgeConfig extends Omit<z.infer<typeof EdgeConfigSchema>, 'MOCK_STT'> {
  mockStt: boolean;
  brainUrl: string;
  allowedExtensionIds: string[];
  configured: boolean;
  sessionSecret: string;
  sttApiKey: string;
}

/**
 * Edge config never throws for missing secrets: the proxy must boot, report
 * `/healthz`, and fail closed (503) on `/v1/*` instead of forwarding without
 * auth or a provider key.
 */
export function loadEdgeConfig(env: NodeJS.ProcessEnv = process.env): EdgeConfig {
  const parsed = EdgeConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid edge configuration:\n${parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    );
  }
  const data = parsed.data;
  const mockStt = data.MOCK_STT === '1' || data.MOCK_STT === 'true';
  const allowedExtensionIds = data.ALLOWED_EXTENSION_IDS.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const sttApiKey =
    data.STT_PROVIDER === 'groq' ? (data.GROQ_API_KEY ?? '') : (data.DEEPGRAM_API_KEY ?? '');
  const sessionSecret = data.EDGE_SESSION_SECRET ?? '';
  return {
    ...data,
    mockStt,
    brainUrl: data.EDGE_BRAIN_URL ?? data.BRAIN_URL,
    allowedExtensionIds,
    sessionSecret,
    sttApiKey,
    configured: sessionSecret.length >= 16 && (mockStt || sttApiKey.length > 0),
  };
}
