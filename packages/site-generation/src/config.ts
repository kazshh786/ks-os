import { z } from 'zod';

const BooleanValue = z.enum(['true', 'false']).transform(value => value === 'true');

const SiteGenerationEnvironmentSchema = z.object({
  SITE_AI_GENERATION_ENABLED: BooleanValue.default('false'),
  SITE_AI_PROVIDER: z.enum(['gemini']).default('gemini'),
  SITE_AI_MODEL: z.string().trim().max(160).optional(),
  SITE_AI_API_KEY: z.string().trim().optional(),
  SITE_AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
  SITE_AI_MAX_REPAIR_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(2),
  SITE_AI_MAX_OUTPUT_CHARACTERS: z.coerce.number().int().min(1_000).max(2_000_000).default(250_000),
  SITE_AI_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(16).default(2),
  SITE_AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  SITE_AI_GENERATOR_VERSION: z.string().trim().min(1).max(80).default('1.0.0'),
}).passthrough().superRefine((value, context) => {
  if (!value.SITE_AI_GENERATION_ENABLED) return;
  if (!value.SITE_AI_MODEL) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SITE_AI_MODEL'],
      message: 'A server-side model is required when generation is enabled.',
    });
  }
  if (!value.SITE_AI_API_KEY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SITE_AI_API_KEY'],
      message: 'A server-side provider credential is required when generation is enabled.',
    });
  }
});

export function parseSiteGenerationConfig(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
) {
  const value = SiteGenerationEnvironmentSchema.parse(environment);
  return {
    enabled: value.SITE_AI_GENERATION_ENABLED,
    provider: value.SITE_AI_PROVIDER,
    model: value.SITE_AI_MODEL,
    apiKey: value.SITE_AI_API_KEY,
    requestTimeoutMs: value.SITE_AI_REQUEST_TIMEOUT_MS,
    maxRepairAttempts: value.SITE_AI_MAX_REPAIR_ATTEMPTS,
    maxOutputCharacters: value.SITE_AI_MAX_OUTPUT_CHARACTERS,
    maxConcurrentRequests: value.SITE_AI_MAX_CONCURRENT_REQUESTS,
    temperature: value.SITE_AI_TEMPERATURE,
    generatorVersion: value.SITE_AI_GENERATOR_VERSION,
  };
}
