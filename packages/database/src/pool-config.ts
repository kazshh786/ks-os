const DEVELOPMENT_POOL_MAX = 10;
const PRODUCTION_POOL_MAX = 3;

export function resolveDatabasePoolMax(environment: {
  configuredMax?: string;
  nodeEnvironment?: string;
} = {
  configuredMax: process.env.DATABASE_POOL_MAX,
  nodeEnvironment: process.env.NODE_ENV,
}): number {
  const configuredMax = environment.configuredMax?.trim();
  if (!configuredMax) {
    // Production services share a bounded Supavisor session pool. Keeping each
    // process to three connections leaves capacity for workers and operations.
    return environment.nodeEnvironment === 'production'
      ? PRODUCTION_POOL_MAX
      : DEVELOPMENT_POOL_MAX;
  }

  if (!/^\d+$/.test(configuredMax)) {
    throw new Error('DATABASE_POOL_MAX must be a positive integer.');
  }

  const poolMax = Number(configuredMax);
  if (!Number.isSafeInteger(poolMax) || poolMax < 1) {
    throw new Error('DATABASE_POOL_MAX must be a positive integer.');
  }

  return poolMax;
}
