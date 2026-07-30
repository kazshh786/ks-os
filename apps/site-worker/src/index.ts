import { closeDatabase, getDatabase } from '@ks-os/database';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSiteWorkerConfig } from './config.js';
import { SiteWorkerHealth, SiteWorkerHealthServer } from './health.js';
import {
  createSiteJobHandlerRegistry,
  type SiteGenerationJobExecutor,
} from './handlers.js';
import { JsonSiteWorkerLogger } from './logger.js';
import { PostgresSiteJobRepository } from './postgres-repository.js';
import { createConfiguredSiteGenerationExecutor } from './postgres-generation-executor.js';
import { UnifiedWorkspaceProvisioningExecutor } from './unified-provisioning-executor.js';
import { ProductionPlaywrightQualityAdapter } from './playwright-quality-adapter.js';
import { PostgresSiteQualityExecutor } from './postgres-quality-executor.js';
import { PostgresSitePublicationExecutor } from './postgres-publication-executor.js';
import { SiteWorker } from './worker.js';

export async function startSiteWorker(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>
    = process.env,
  generationExecutor?: SiteGenerationJobExecutor,
) {
  const config = parseSiteWorkerConfig(environment);
  const database = getDatabase(config.databaseUrl);
  const resolvedGenerationExecutor = generationExecutor
    ?? (config.generation.enabled
      ? createConfiguredSiteGenerationExecutor(database, config.generation)
      : undefined);
  const repository = new PostgresSiteJobRepository(database);
  const qualityExecutor = new PostgresSiteQualityExecutor(
    database,
    config.quality,
    new ProductionPlaywrightQualityAdapter({
      pageTimeoutMs: config.quality.pageTimeoutMs,
    }),
    config.nodeEnvironment,
  );
  const registry = createSiteJobHandlerRegistry(
    config.enableTestHandlers,
    resolvedGenerationExecutor,
    new UnifiedWorkspaceProvisioningExecutor(database, config.generation),
    qualityExecutor,
    new PostgresSitePublicationExecutor(database),
  );
  const logger = new JsonSiteWorkerLogger(config.logLevel);
  const health = new SiteWorkerHealth(repository, registry);
  const healthServer = new SiteWorkerHealthServer(
    health,
    config.healthHost,
    config.healthPort,
  );
  const worker = new SiteWorker(
    config,
    repository,
    registry,
    logger,
    health,
  );
  const healthPort = await healthServer.start();
  worker.start();

  let stopping: Promise<void> | null = null;
  const stop = () => {
    if (stopping) return stopping;
    stopping = (async () => {
      await worker.shutdown();
      await healthServer.stop();
      await qualityExecutor.close();
      await closeDatabase();
    })();
    return stopping;
  };
  const handleSignal = () => {
    void stop().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  return {
    config,
    worker,
    health,
    healthPort,
    stop,
  };
}

const executedDirectly = Boolean(
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url,
);

if (executedDirectly) {
  startSiteWorker()
    .then(runtime => runtime.worker.waitUntilStopped())
    .catch(error => {
      const message = error instanceof Error
        ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[REDACTED]')
        : 'Site worker failed to start.';
      console.error(JSON.stringify({
        level: 'error',
        service: 'site-worker',
        message,
      }));
      process.exitCode = 1;
    });
}

export * from './config.js';
export * from './handlers.js';
export * from './health.js';
export * from './logger.js';
export * from './postgres-repository.js';
export * from './postgres-generation-executor.js';
export * from './postgres-provisioning-executor.js';
export * from './unified-provisioning-executor.js';
export * from './postgres-quality-executor.js';
export * from './postgres-publication-executor.js';
export * from './playwright-quality-adapter.js';
export * from './provisioning-finalization.js';
export * from './repository.types.js';
export * from './worker.js';
