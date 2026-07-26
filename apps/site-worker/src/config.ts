import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { parseSiteGenerationConfig } from '@ks-os/site-generation';

const IntegerEnvironmentValue = (minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum);

const BooleanEnvironmentValue = z.enum(['true', 'false'])
  .transform(value => value === 'true');

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
  };
}
