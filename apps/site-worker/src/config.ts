import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { parseSiteGenerationConfig } from '@ks-os/site-generation';

const IntegerEnvironmentValue = (minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum);

const BooleanEnvironmentValue = z.enum(['true', 'false'])
  .transform(value => value === 'true');

const OptionalEnvironmentValue = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(value => value === '' ? undefined : value, schema.optional());

const SiteWorkerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().trim().min(1),
  SITE_WORKER_ID: z.preprocess(
    value => value === '' ? undefined : value,
    z.string()
      .trim()
      .regex(/^[A-Za-z0-9._:-]{1,120}$/)
      .optional(),
  ),
  SITE_WORKER_CONCURRENCY: IntegerEnvironmentValue(1, 32).default(2),
  SITE_WORKER_POLL_INTERVAL_MS: IntegerEnvironmentValue(100, 60_000)
    .default(1_000),
  SITE_WORKER_LEASE_SECONDS: IntegerEnvironmentValue(15, 3_600).default(120),
  SITE_WORKER_HEARTBEAT_SECONDS: IntegerEnvironmentValue(5, 1_200).default(30),
  SITE_WORKER_SHUTDOWN_TIMEOUT_SECONDS: IntegerEnvironmentValue(1, 300)
    .default(30),
  SITE_WORKER_HEALTH_HOST: z.string()
    .trim()
    .regex(/^[A-Za-z0-9.:-]{1,255}$/)
    .default('127.0.0.1'),
  SITE_WORKER_HEALTH_PORT: IntegerEnvironmentValue(0, 65_535).default(8_091),
  SITE_WORKER_LOG_LEVEL: z.enum([
    'debug',
    'info',
    'warn',
    'error',
  ]).default('info'),
  SITE_WORKER_ENABLE_TEST_HANDLERS: BooleanEnvironmentValue.default('false'),
  SITE_QUALITY_ENABLED: BooleanEnvironmentValue.default('false'),
  SITE_QUALITY_BROWSER_ENABLED: BooleanEnvironmentValue.default('false'),
  SITE_QUALITY_BROWSER_CONCURRENCY: IntegerEnvironmentValue(1, 4).default(2),
  SITE_QUALITY_PAGE_TIMEOUT_MS: IntegerEnvironmentValue(1_000, 120_000)
    .default(30_000),
  SITE_QUALITY_RUN_TIMEOUT_MS: IntegerEnvironmentValue(10_000, 3_600_000)
    .default(900_000),
  SITE_QUALITY_PREVIEW_ORIGIN: OptionalEnvironmentValue(
    z.string().url().max(1_000),
  ),
  SITE_PREVIEW_TOKEN_SECRET: OptionalEnvironmentValue(
    z.string().min(32).max(4_096),
  ),
  SITE_QUALITY_AI_ENABLED: BooleanEnvironmentValue.default('false'),
}).passthrough().superRefine((value, context) => {
  if (value.SITE_WORKER_HEARTBEAT_SECONDS
    >= value.SITE_WORKER_LEASE_SECONDS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Heartbeat interval must be shorter than the lease duration.',
      path: ['SITE_WORKER_HEARTBEAT_SECONDS'],
    });
  }
  if (value.NODE_ENV === 'production'
    && value.SITE_WORKER_ENABLE_TEST_HANDLERS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Test handlers cannot be enabled in production.',
      path: ['SITE_WORKER_ENABLE_TEST_HANDLERS'],
    });
  }
  if (value.SITE_QUALITY_BROWSER_ENABLED && !value.SITE_QUALITY_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Browser auditing requires the site-quality worker to be enabled.',
      path: ['SITE_QUALITY_BROWSER_ENABLED'],
    });
  }
  if (value.SITE_QUALITY_BROWSER_ENABLED
    && (!value.SITE_QUALITY_PREVIEW_ORIGIN || !value.SITE_PREVIEW_TOKEN_SECRET)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Browser auditing requires a preview origin and preview-token secret.',
      path: ['SITE_QUALITY_PREVIEW_ORIGIN'],
    });
  }
  if (
    value.NODE_ENV === 'production'
    && value.SITE_QUALITY_BROWSER_ENABLED
    && !value.SITE_QUALITY_PREVIEW_ORIGIN?.startsWith('https://')
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Production quality previews must use HTTPS.',
      path: ['SITE_QUALITY_PREVIEW_ORIGIN'],
    });
  }
  if (value.SITE_QUALITY_AI_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Live AI quality review has no configured provider and must remain disabled.',
      path: ['SITE_QUALITY_AI_ENABLED'],
    });
  }
});

export interface SiteWorkerConfig {
  nodeEnvironment: 'development' | 'test' | 'production';
  databaseUrl: string;
  workerId: string;
  concurrency: number;
  pollIntervalMs: number;
  leaseSeconds: number;
  heartbeatSeconds: number;
  shutdownTimeoutSeconds: number;
  healthHost: string;
  healthPort: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enableTestHandlers: boolean;
  generation: ReturnType<typeof parseSiteGenerationConfig>;
  quality: {
    enabled: boolean;
    browserEnabled: boolean;
    browserConcurrency: number;
    pageTimeoutMs: number;
    runTimeoutMs: number;
    previewOrigin?: string;
    previewTokenSecret?: string;
    aiEnabled: boolean;
  };
}

export function parseSiteWorkerConfig(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): SiteWorkerConfig {
  const parsed = SiteWorkerEnvironmentSchema.parse(environment);
  const generation = parseSiteGenerationConfig(environment);
  const generatedWorkerId = [
    hostname().replace(/[^A-Za-z0-9.-]/g, '-').slice(0, 60),
    process.pid,
    randomBytes(6).toString('hex'),
  ].join(':');
  return {
    nodeEnvironment: parsed.NODE_ENV,
    databaseUrl: parsed.DATABASE_URL,
    workerId: parsed.SITE_WORKER_ID || generatedWorkerId,
    concurrency: parsed.SITE_WORKER_CONCURRENCY,
    pollIntervalMs: parsed.SITE_WORKER_POLL_INTERVAL_MS,
    leaseSeconds: parsed.SITE_WORKER_LEASE_SECONDS,
    heartbeatSeconds: parsed.SITE_WORKER_HEARTBEAT_SECONDS,
    shutdownTimeoutSeconds: parsed.SITE_WORKER_SHUTDOWN_TIMEOUT_SECONDS,
    healthHost: parsed.SITE_WORKER_HEALTH_HOST,
    healthPort: parsed.SITE_WORKER_HEALTH_PORT,
    logLevel: parsed.SITE_WORKER_LOG_LEVEL,
    enableTestHandlers: parsed.SITE_WORKER_ENABLE_TEST_HANDLERS,
    generation,
    quality: {
      enabled: parsed.SITE_QUALITY_ENABLED,
      browserEnabled: parsed.SITE_QUALITY_BROWSER_ENABLED,
      browserConcurrency: parsed.SITE_QUALITY_BROWSER_CONCURRENCY,
      pageTimeoutMs: parsed.SITE_QUALITY_PAGE_TIMEOUT_MS,
      runTimeoutMs: parsed.SITE_QUALITY_RUN_TIMEOUT_MS,
      ...(parsed.SITE_QUALITY_PREVIEW_ORIGIN
        ? { previewOrigin: parsed.SITE_QUALITY_PREVIEW_ORIGIN.replace(/\/+$/, '') }
        : {}),
      ...(parsed.SITE_PREVIEW_TOKEN_SECRET
        ? { previewTokenSecret: parsed.SITE_PREVIEW_TOKEN_SECRET }
        : {}),
      aiEnabled: parsed.SITE_QUALITY_AI_ENABLED,
    },
  };
}
