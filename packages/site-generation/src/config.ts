import { z } from 'zod';
import { SITE_GENERATOR_VERSION } from './contracts.js';

const BooleanValue = z.enum(['true', 'false']).transform(value => value === 'true');

export const SITE_BASELINE_GENERATOR_VERSION = 'baseline-1' as const;
export const SITE_GENERATION_MODES = ['ai-composition', 'baseline'] as const;
export type SiteGenerationMode = typeof SITE_GENERATION_MODES[number];

const SiteGenerationEnvironmentSchema = z.object({
  SITE_AI_GENERATION_ENABLED: BooleanValue.default('false'),
  SITE_AI_GENERATION_MODE: z.enum(SITE_GENERATION_MODES).default('ai-composition'),
  SITE_AI_PROVIDER: z.enum(['gemini', 'vertex-gemini', 'openai']).default('gemini'),
  SITE_AI_MODEL: z.string().trim().max(160).optional(),
  SITE_AI_API_KEY: z.string().trim().optional(),
  OPENAI_API_KEY: z.string().trim().optional(),
  SITE_AI_OPENAI_BASE_URL: z.string().trim().url().max(1_000).default('https://api.openai.com/v1'),
  GOOGLE_CLOUD_PROJECT: z.string().trim().max(255).optional(),
  GOOGLE_CLOUD_LOCATION: z.string().trim().max(100).optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().trim().max(1_024).optional(),
  SITE_AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
  SITE_AI_MAX_REPAIR_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(2),
  SITE_AI_MAX_OUTPUT_CHARACTERS: z.coerce.number().int().min(1_000).max(2_000_000).default(250_000),
  SITE_AI_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(16).default(2),
  SITE_AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  SITE_AI_GENERATOR_VERSION: z.string().trim().min(1).max(80).default(SITE_GENERATOR_VERSION),
}).passthrough().superRefine((value, context) => {
  if (!value.SITE_AI_GENERATION_ENABLED) return;
  if (!value.SITE_AI_MODEL) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SITE_AI_MODEL'],
      message: 'A server-side model is required when generation is enabled.',
    });
  }
  if (value.SITE_AI_PROVIDER === 'gemini') {
    if (!value.SITE_AI_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SITE_AI_API_KEY'],
        message: 'A server-side provider credential is required when generation is enabled.',
      });
    }
  } else if (value.SITE_AI_PROVIDER === 'openai') {
    if (!value.SITE_AI_API_KEY && !value.OPENAI_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY or SITE_AI_API_KEY is required when generation is enabled with openai.',
      });
    }
  } else if (value.SITE_AI_PROVIDER === 'vertex-gemini') {
    if (!value.GOOGLE_CLOUD_PROJECT) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_CLOUD_PROJECT'],
        message: 'GOOGLE_CLOUD_PROJECT is required when generation is enabled with vertex-gemini.',
      });
    }
    if (!value.GOOGLE_CLOUD_LOCATION) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_CLOUD_LOCATION'],
        message: 'GOOGLE_CLOUD_LOCATION is required when generation is enabled with vertex-gemini.',
      });
    }
    if (!value.GOOGLE_APPLICATION_CREDENTIALS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_APPLICATION_CREDENTIALS'],
        message: 'GOOGLE_APPLICATION_CREDENTIALS is required when generation is enabled with vertex-gemini.',
      });
    }
  }
});

export function parseSiteGenerationConfig(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
) {
  const value = SiteGenerationEnvironmentSchema.parse(environment);
  return {
    enabled: value.SITE_AI_GENERATION_ENABLED,
    generationMode: value.SITE_AI_GENERATION_MODE,
    provider: value.SITE_AI_PROVIDER,
    model: value.SITE_AI_MODEL,
    apiKey: value.SITE_AI_PROVIDER === 'openai'
      ? value.SITE_AI_API_KEY ?? value.OPENAI_API_KEY
      : value.SITE_AI_API_KEY,
    openAiBaseUrl: value.SITE_AI_OPENAI_BASE_URL.replace(/\/+$/, ''),
    googleCloudProject: value.GOOGLE_CLOUD_PROJECT,
    googleCloudLocation: value.GOOGLE_CLOUD_LOCATION,
    googleApplicationCredentials: value.GOOGLE_APPLICATION_CREDENTIALS,
    requestTimeoutMs: value.SITE_AI_REQUEST_TIMEOUT_MS,
    maxRepairAttempts: value.SITE_AI_MAX_REPAIR_ATTEMPTS,
    maxOutputCharacters: value.SITE_AI_MAX_OUTPUT_CHARACTERS,
    maxConcurrentRequests: value.SITE_AI_MAX_CONCURRENT_REQUESTS,
    temperature: value.SITE_AI_TEMPERATURE,
    generatorVersion: value.SITE_AI_GENERATION_MODE === 'baseline'
      ? SITE_BASELINE_GENERATOR_VERSION
      : value.SITE_AI_GENERATOR_VERSION,
  };
}

export type SiteGenerationConfig = ReturnType<typeof parseSiteGenerationConfig>;

/**
 * Shared readiness check for every server-side generation entry point.
 * Disabled configurations are intentionally never considered ready.
 */
export function isSiteGenerationProviderReady(config: SiteGenerationConfig): boolean {
  if (!config.enabled || !config.model) return false;

  if (config.provider === 'vertex-gemini') {
    return Boolean(config.googleCloudProject && config.googleCloudLocation && config.googleApplicationCredentials);
  }

  return Boolean(config.apiKey);
}
