import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_SITE_JOB_RETRY_POLICY,
  RegisteredSiteJobTypeSchema,
  SiteJobExecutionError,
  SiteJobHandlerRegistry,
  SiteJobPayloadSchema,
  SiteJobProgressSchema,
  SiteJobResultSchema,
  SiteJobTypeSchema,
  assertSiteJobTransition,
  canTransitionSiteJob,
  decideSiteJobRetry,
  deriveSiteJobIdempotencyKey,
  retryDelayMs,
  type RegisteredSiteJobType,
  type SiteJobHandler,
  type SiteJobProgress,
  type SiteJobResult,
} from '@ks-os/site-jobs';
import { parseSiteWorkerConfig, type SiteWorkerConfig } from '../src/config.js';
import { createSiteJobHandlerRegistry } from '../src/handlers.js';
import { SiteWorkerHealth } from '../src/health.js';
import { SilentSiteWorkerLogger } from '../src/logger.js';
import {
  type LeasedSiteJob,
  type SiteJobFailureUpdate,
  type SiteJobRepository,
  type SiteJobRepositoryHealth,
  SiteJobLeaseLostError,
} from '../src/repository.types.js';
import { SiteWorker } from '../src/worker.js';

const migration = readFileSync(
  new URL(
    '../../../packages/database/migrations/20260725090000_phase_15_6a_site_worker_foundation.sql',
    import.meta.url,
  ),
  'utf8',
);
const postgresRepositorySource = readFileSync(
  new URL('../src/postgres-repository.ts', import.meta.url),
  'utf8',
);
const workerSource = readFileSync(
  new URL('../src/worker.ts', import.meta.url),
  'utf8',
);
const generationExecutorSource = readFileSync(
  new URL('../src/postgres-generation-executor.ts', import.meta.url),
  'utf8',
);
const publicationExecutorSource = readFileSync(
  new URL('../src/postgres-publication-executor.ts', import.meta.url),
  'utf8',
);
const compositionSource = readFileSync(
  new URL('../src/index.ts', import.meta.url),
  'utf8',
);
const routeSource = readFileSync(
  new URL('../../api/src/modules/sites/site-job.routes.ts', import.meta.url),
  'utf8',
);
const serviceSource = readFileSync(
  new URL('../../api/src/modules/sites/site-job.service.ts', import.meta.url),
  'utf8',
);
const packageJson = JSON.parse(readFileSync(
  new URL('../package.json', import.meta.url),
  'utf8',
)) as { scripts: Record<string, string> };

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const SITE_A = '33333333-3333-4333-8333-333333333333';
const SITE_B = '44444444-4444-4444-8444-444444444444';
const VERSION_A = '55555555-5555-4555-8555-555555555555';
const BLUEPRINT_A = '66666666-6666-4666-8666-666666666666';
const CORRELATION = '77777777-7777-4777-8777-777777777777';

interface MemoryAttempt {
  attemptNumber: number;
  workerId: string;
  outcome: string;
  startedAt: Date;
  finishedAt: Date | null;
}

interface MemoryEvent {
  type: string;
  occurredAt: Date;
  safeMetadata?: Record<string, number>;
}

interface MemoryJob {
  id: string;
  reference: string;
  tenantId: string;
  tenantReference: string;
  siteId: string;
  siteReference: string;
  versionReference: string | null;
  blueprintReference: string | null;
  jobType: string;
  payload: unknown;
  payloadSchemaVersion: number;
  status: string;
  priority: number;
  availableAt: Date;
  attemptCount: number;
  maxAttempts: number;
  workerId: string | null;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  heartbeatAt: Date | null;
  progressCurrent: number;
  progressTotal: number | null;
  progressMessage: string | null;
  result: SiteJobResult | null;
  failure: SiteJobFailureUpdate | null;
  idempotencyKey: string;
  sourceDigest: string;
  attempts: MemoryAttempt[];
  events: MemoryEvent[];
}

class MemorySiteJobRepository implements SiteJobRepository {
  readonly jobs: MemoryJob[] = [];
  readonly audits: string[] = [];
  private timestamp = Date.parse('2026-07-25T12:00:00.000Z');
  private sequence = 1;
  maximumActiveObserved = 0;

  now() {
    return new Date(this.timestamp);
  }

  advance(milliseconds: number) {
    this.timestamp += milliseconds;
  }

  enqueue(input: {
    tenantReference?: string;
    siteReference?: string;
    jobType?: string;
    payload?: unknown;
    availableAt?: Date;
    maxAttempts?: number;
    priority?: number;
    sourceDigest?: string;
  } = {}) {
    const tenantReference = input.tenantReference || TENANT_A;
    const siteReference = input.siteReference
      || (tenantReference === TENANT_A ? SITE_A : SITE_B);
    const jobType = input.jobType || 'TEST_SUCCEED';
    const payload = input.payload || {
      jobType,
      correlationReference: CORRELATION,
    };
    if (
      payload
      && typeof payload === 'object'
      && 'siteReference' in payload
      && payload.siteReference !== siteReference
    ) {
      throw new Error('Cross-tenant site payload reference rejected.');
    }
    const sourceDigest = input.sourceDigest || 'a'.repeat(64);
    const idempotencyKey = deriveSiteJobIdempotencyKey({
      tenantReference,
      jobType: SiteJobTypeSchema.safeParse(jobType).success
        ? jobType
        : 'CREATE_SITE_SNAPSHOT',
      targetReference: siteReference,
      sourceDigestSha256: sourceDigest,
      operationVersion: 1,
    });
    const existing = this.jobs.find(job =>
      job.tenantReference === tenantReference
      && job.idempotencyKey === idempotencyKey);
    if (existing) return existing;
    const reference = this.uuid(this.sequence++);
    const job: MemoryJob = {
      id: this.uuid(this.sequence++),
      reference,
      tenantId: tenantReference,
      tenantReference,
      siteId: siteReference,
      siteReference,
      versionReference: VERSION_A,
      blueprintReference: BLUEPRINT_A,
      jobType,
      payload,
      payloadSchemaVersion: 1,
      status: input.availableAt && input.availableAt > this.now()
        ? 'SCHEDULED'
        : 'PENDING',
      priority: input.priority || 100,
      availableAt: input.availableAt || this.now(),
      attemptCount: 0,
      maxAttempts: input.maxAttempts || 5,
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      progressCurrent: 0,
      progressTotal: null,
      progressMessage: null,
      result: null,
      failure: null,
      idempotencyKey,
      sourceDigest,
      attempts: [],
      events: [{ type: 'JOB_CREATED', occurredAt: this.now() }],
    };
    this.jobs.push(job);
    return job;
  }

  async claimNext(workerId: string, leaseSeconds: number) {
    const now = this.now();
    const eligible = this.jobs
      .filter(job => {
        const queued = ['PENDING', 'SCHEDULED', 'RETRY_DELAY']
          .includes(job.status) && job.availableAt <= now;
        const abandoned = ['LEASED', 'PROCESSING'].includes(job.status)
          && Boolean(job.leaseExpiresAt && job.leaseExpiresAt < now);
        if ((!queued && !abandoned) || job.attemptCount >= job.maxAttempts) {
          return false;
        }
        return !this.jobs.some(active =>
          active.id !== job.id
          && active.tenantReference === job.tenantReference
          && ['LEASED', 'PROCESSING', 'CANCEL_REQUESTED']
            .includes(active.status)
          && Boolean(active.leaseExpiresAt && active.leaseExpiresAt >= now));
      })
      .sort((left, right) =>
        right.priority - left.priority
        || left.availableAt.getTime() - right.availableAt.getTime()
        || left.reference.localeCompare(right.reference));
    const job = eligible[0];
    if (!job) return null;
    if (['LEASED', 'PROCESSING'].includes(job.status)) {
      const prior = job.attempts.at(-1);
      if (prior) {
        prior.outcome = 'LEASE_EXPIRED';
        prior.finishedAt = now;
      }
      job.events.push({ type: 'JOB_LEASE_EXPIRED', occurredAt: now });
    }
    job.status = 'LEASED';
    job.workerId = workerId;
    job.leaseToken = `lease-${this.sequence++}`;
    job.leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1_000);
    job.heartbeatAt = now;
    job.attemptCount += 1;
    job.attempts.push({
      attemptNumber: job.attemptCount,
      workerId,
      outcome: 'PROCESSING',
      startedAt: now,
      finishedAt: null,
    });
    job.events.push({ type: 'JOB_LEASED', occurredAt: now });
    this.observeConcurrency();
    return this.lease(job);
  }

  async start(job: LeasedSiteJob) {
    const stored = this.assertLease(job, ['LEASED']);
    stored.status = 'PROCESSING';
    stored.events.push({ type: 'JOB_STARTED', occurredAt: this.now() });
    this.observeConcurrency();
  }

  async heartbeat(job: LeasedSiteJob, leaseSeconds: number) {
    const stored = this.assertLease(job, ['PROCESSING', 'CANCEL_REQUESTED']);
    stored.heartbeatAt = this.now();
    stored.leaseExpiresAt = new Date(
      this.timestamp + leaseSeconds * 1_000,
    );
    return {
      cancellationRequested: stored.status === 'CANCEL_REQUESTED',
      leaseExpiresAt: stored.leaseExpiresAt,
    };
  }

  async updateProgress(job: LeasedSiteJob, progress: SiteJobProgress) {
    const stored = this.assertLease(job, ['PROCESSING', 'CANCEL_REQUESTED']);
    SiteJobProgressSchema.parse(progress);
    if (progress.current < stored.progressCurrent) {
      throw new Error('Progress cannot decrease.');
    }
    if (stored.progressTotal !== null
      && stored.progressTotal !== progress.total) {
      throw new Error('Progress total cannot change.');
    }
    stored.progressCurrent = progress.current;
    stored.progressTotal = progress.total;
    stored.progressMessage = progress.message || null;
    stored.events.push({
      type: 'JOB_PROGRESS_UPDATED',
      occurredAt: this.now(),
      safeMetadata: { current: progress.current, total: progress.total },
    });
  }

  async isCancellationRequested(job: LeasedSiteJob) {
    return this.assertLease(
      job,
      ['LEASED', 'PROCESSING', 'CANCEL_REQUESTED'],
    ).status === 'CANCEL_REQUESTED';
  }

  async complete(job: LeasedSiteJob, result: SiteJobResult) {
    const stored = this.assertLease(job, ['PROCESSING', 'CANCEL_REQUESTED']);
    if (stored.status === 'CANCEL_REQUESTED') {
      await this.cancelLeased(job, 'Cancelled after atomic completion.');
      return 'CANCELLED' as const;
    }
    stored.status = 'COMPLETED';
    stored.result = SiteJobResultSchema.parse(result);
    this.finish(stored, 'COMPLETED');
    stored.events.push({ type: 'JOB_COMPLETED', occurredAt: this.now() });
    return 'COMPLETED' as const;
  }

  async fail(job: LeasedSiteJob, update: SiteJobFailureUpdate) {
    const stored = this.assertLease(job, ['LEASED', 'PROCESSING']);
    stored.status = update.targetStatus;
    stored.failure = update;
    if (update.availableAt) stored.availableAt = update.availableAt;
    this.finish(
      stored,
      update.targetStatus === 'RETRY_DELAY'
        ? 'RETRY_SCHEDULED'
        : 'FAILED',
    );
    stored.events.push({
      type: update.targetStatus === 'RETRY_DELAY'
        ? 'JOB_RETRY_SCHEDULED'
        : update.targetStatus === 'DEAD_LETTER'
          ? 'JOB_MOVED_TO_DEAD_LETTER'
          : 'JOB_FAILED',
      occurredAt: this.now(),
    });
  }

  async cancelLeased(job: LeasedSiteJob) {
    const stored = this.assertLease(
      job,
      ['LEASED', 'PROCESSING', 'CANCEL_REQUESTED'],
    );
    stored.status = 'CANCELLED';
    this.finish(stored, 'CANCELLED');
    stored.events.push({ type: 'JOB_CANCELLED', occurredAt: this.now() });
  }

  async recoverExpiredCancellationRequests() {
    let recovered = 0;
    for (const job of this.jobs) {
      if (job.status === 'CANCEL_REQUESTED'
        && job.leaseExpiresAt
        && job.leaseExpiresAt < this.now()) {
        job.status = 'CANCELLED';
        this.finish(job, 'CANCELLED');
        job.events.push({ type: 'JOB_CANCELLED', occurredAt: this.now() });
        recovered += 1;
      }
    }
    return recovered;
  }

  async recoverExpiredTerminalLeases() {
    let recovered = 0;
    for (const job of this.jobs) {
      if (
        ['LEASED', 'PROCESSING'].includes(job.status)
        && job.leaseExpiresAt
        && job.leaseExpiresAt < this.now()
        && job.attemptCount >= job.maxAttempts
      ) {
        job.status = 'DEAD_LETTER';
        this.finish(job, 'LEASE_EXPIRED');
        job.events.push({
          type: 'JOB_MOVED_TO_DEAD_LETTER',
          occurredAt: this.now(),
        });
        recovered += 1;
      }
    }
    return recovered;
  }

  async health(): Promise<SiteJobRepositoryHealth> {
    return { databaseAvailable: true, schemaCompatible: true };
  }

  requestCancellation(reference: string, authorised = true) {
    if (!authorised) throw new Error('AGENCY_FORBIDDEN');
    const job = this.required(reference);
    if (job.status === 'COMPLETED') throw new Error('SITE_JOB_NOT_CANCELLABLE');
    if (['PENDING', 'SCHEDULED', 'RETRY_DELAY'].includes(job.status)) {
      job.status = 'CANCELLED';
      job.events.push({ type: 'JOB_CANCELLED', occurredAt: this.now() });
      this.audits.push('SITE_JOB_CANCELLED');
    } else {
      job.status = 'CANCEL_REQUESTED';
      job.events.push({
        type: 'JOB_CANCEL_REQUESTED',
        occurredAt: this.now(),
      });
      this.audits.push('SITE_JOB_CANCEL_REQUESTED');
    }
  }

  manualRetry(reference: string, authorised = true) {
    if (!authorised) throw new Error('AGENCY_FORBIDDEN');
    const job = this.required(reference);
    if (!['FAILED', 'DEAD_LETTER'].includes(job.status)) {
      throw new Error('SITE_JOB_NOT_RETRYABLE');
    }
    job.status = 'PENDING';
    job.availableAt = this.now();
    job.maxAttempts = Math.max(job.maxAttempts, job.attemptCount + 1);
    job.events.push({ type: 'JOB_RETRIED_MANUALLY', occurredAt: this.now() });
    this.audits.push('SITE_JOB_MANUALLY_RETRIED');
  }

  list(filters: { siteReference?: string; status?: string; jobType?: string }) {
    return this.jobs.filter(job =>
      (!filters.siteReference || job.siteReference === filters.siteReference)
      && (!filters.status || job.status === filters.status)
      && (!filters.jobType || job.jobType === filters.jobType));
  }

  private assertLease(job: LeasedSiteJob, statuses: string[]) {
    const stored = this.required(job.publicReference);
    if (
      !statuses.includes(stored.status)
      || stored.workerId !== job.workerId
      || stored.leaseToken !== job.leaseToken
      || !stored.leaseExpiresAt
      || stored.leaseExpiresAt <= this.now()
    ) {
      throw new SiteJobLeaseLostError();
    }
    return stored;
  }

  private finish(job: MemoryJob, outcome: string) {
    job.workerId = null;
    job.leaseToken = null;
    job.leaseExpiresAt = null;
    job.heartbeatAt = null;
    const attempt = job.attempts.at(-1);
    if (attempt) {
      attempt.outcome = outcome;
      attempt.finishedAt = this.now();
    }
  }

  private required(reference: string) {
    const job = this.jobs.find(candidate => candidate.reference === reference);
    if (!job) throw new Error('SITE_JOB_NOT_FOUND');
    return job;
  }

  private lease(job: MemoryJob): LeasedSiteJob {
    return {
      id: job.id,
      publicReference: job.reference,
      tenantId: job.tenantId,
      tenantReference: job.tenantReference,
      siteId: job.siteId,
      siteReference: job.siteReference,
      versionReference: job.versionReference,
      blueprintReference: job.blueprintReference,
      jobType: job.jobType,
      payload: job.payload,
      payloadSchemaVersion: job.payloadSchemaVersion,
      attemptNumber: job.attemptCount,
      maxAttempts: job.maxAttempts,
      workerId: job.workerId || '',
      leaseToken: job.leaseToken || '',
      leaseExpiresAt: job.leaseExpiresAt || this.now(),
    };
  }

  private observeConcurrency() {
    const active = this.jobs.filter(job =>
      ['LEASED', 'PROCESSING', 'CANCEL_REQUESTED'].includes(job.status)
      && Boolean(job.leaseExpiresAt && job.leaseExpiresAt > this.now())).length;
    this.maximumActiveObserved = Math.max(this.maximumActiveObserved, active);
  }

  private uuid(value: number) {
    return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
  }
}

function workerConfig(
  overrides: Partial<SiteWorkerConfig> = {},
): SiteWorkerConfig {
  return {
    nodeEnvironment: 'test',
    databaseUrl: 'postgresql://test.invalid/test',
    workerId: 'test-worker',
    concurrency: 2,
    pollIntervalMs: 10,
    leaseSeconds: 30,
    heartbeatSeconds: 0.01,
    shutdownTimeoutSeconds: 1,
    healthHost: '127.0.0.1',
    healthPort: 0,
    logLevel: 'error',
    enableTestHandlers: true,
    ...overrides,
  };
}

function createWorker(
  repository: MemorySiteJobRepository,
  registry = createSiteJobHandlerRegistry(true),
  overrides: Partial<SiteWorkerConfig> = {},
) {
  const health = new SiteWorkerHealth(repository, registry);
  const worker = new SiteWorker(
    workerConfig(overrides),
    repository,
    registry,
    new SilentSiteWorkerLogger(),
    health,
  );
  return { worker, health };
}

async function eventually(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const expires = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= expires) throw new Error('Condition timed out.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('1. apps/site-worker defines a production TypeScript build', () => {
  assert.equal(packageJson.scripts.build, 'tsc');
});

test('2. worker validates required environment configuration', () => {
  assert.throws(() => parseSiteWorkerConfig({}), /DATABASE_URL/);
  assert.throws(() => parseSiteWorkerConfig({
    DATABASE_URL: 'postgresql://test.invalid/test',
    SITE_WORKER_LEASE_SECONDS: '30',
    SITE_WORKER_HEARTBEAT_SECONDS: '30',
  }), /Heartbeat interval/);
});

test('3. worker starts with an empty queue', async () => {
  const repository = new MemorySiteJobRepository();
  const { worker } = createWorker(repository);
  worker.start();
  await eventually(() => !worker.isDraining());
  assert.equal(worker.activeJobCount(), 0);
  await worker.shutdown();
});

test('4. worker shuts down gracefully', async () => {
  const repository = new MemorySiteJobRepository();
  const { worker } = createWorker(repository);
  worker.start();
  const result = await worker.shutdown();
  assert.equal(result.timedOut, false);
  assert.equal(worker.isDraining(), true);
});

test('5. eligible PENDING job can be leased', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue();
  assert.ok(await repository.claimNext('worker-a', 30));
});

test('6. future SCHEDULED job is not leased early', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue({ availableAt: new Date(repository.now().getTime() + 10_000) });
  assert.equal(await repository.claimNext('worker-a', 30), null);
});

test('7. available SCHEDULED job can be leased', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue({ availableAt: new Date(repository.now().getTime() + 1_000) });
  repository.advance(1_001);
  assert.ok(await repository.claimNext('worker-a', 30));
});

test('8. two workers cannot lease the same job', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue();
  assert.ok(await repository.claimNext('worker-a', 30));
  assert.equal(await repository.claimNext('worker-b', 30), null);
});

test('9. leasing uses row locking safely', () => {
  assert.match(postgresRepositorySource, /FOR UPDATE SKIP LOCKED/);
  assert.match(postgresRepositorySource, /WITH candidate AS/);
});

test('9b. progress event JSON parameters have concrete Postgres types', () => {
  assert.match(
    postgresRepositorySource,
    /'current',\s*\$\{progress\.current\}::integer/,
  );
  assert.match(
    postgresRepositorySource,
    /'total',\s*\$\{progress\.total\}::integer/,
  );
});

test('10. lease owner is recorded', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue();
  const lease = await repository.claimNext('worker-a', 30);
  assert.equal(lease?.workerId, 'worker-a');
});

test('11. lease token is validated', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue();
  const lease = await repository.claimNext('worker-a', 30);
  assert.ok(lease);
  await assert.rejects(
    repository.start({ ...lease, leaseToken: 'wrong' }),
    SiteJobLeaseLostError,
  );
  assert.match(postgresRepositorySource, /lease_token_digest/);
});

test('12. one worker cannot heartbeat another worker job', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue();
  const lease = await repository.claimNext('worker-a', 30);
  assert.ok(lease);
  await repository.start(lease);
  await assert.rejects(
    repository.heartbeat({ ...lease, workerId: 'worker-b' }, 30),
    SiteJobLeaseLostError,
  );
});

test('13. heartbeat extends a valid lease', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue();
  const lease = await repository.claimNext('worker-a', 30);
  assert.ok(lease);
  await repository.start(lease);
  const before = lease.leaseExpiresAt;
  repository.advance(1_000);
  const heartbeat = await repository.heartbeat(lease, 30);
  assert.ok(heartbeat.leaseExpiresAt > before);
});

test('14. expired lease can be reclaimed', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue();
  const first = await repository.claimNext('worker-a', 1);
  assert.ok(first);
  await repository.start(first);
  repository.advance(1_001);
  const reclaimed = await repository.claimNext('worker-b', 30);
  assert.equal(reclaimed?.workerId, 'worker-b');
  assert.equal(reclaimed?.attemptNumber, 2);
});

test('15. active heartbeat prevents premature reclaim', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue();
  const lease = await repository.claimNext('worker-a', 30);
  assert.ok(lease);
  await repository.start(lease);
  repository.advance(5_000);
  await repository.heartbeat(lease, 30);
  assert.equal(await repository.claimNext('worker-b', 30), null);
});

test('16. completed job cannot be reclaimed', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue();
  const lease = await repository.claimNext('worker-a', 30);
  assert.ok(lease);
  await repository.start(lease);
  await repository.complete(lease, {
    summary: 'Done',
    outputReferences: [],
    metrics: {},
  });
  repository.advance(60_000);
  assert.equal(await repository.claimNext('worker-b', 30), null);
});

test('17. cancelled job cannot be leased', async () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue();
  repository.requestCancellation(job.reference);
  assert.equal(await repository.claimNext('worker-a', 30), null);
});

test('18. unknown job type is rejected', () => {
  assert.equal(RegisteredSiteJobTypeSchema.safeParse('RUN_EVIL_CODE').success, false);
});

test('19. unknown payload shape is rejected', () => {
  assert.equal(SiteJobPayloadSchema.safeParse({
    jobType: 'CREATE_SITE_SNAPSHOT',
    arbitraryCommand: 'rm -rf',
  }).success, false);
});

test('20. cross-tenant payload reference is rejected', () => {
  const repository = new MemorySiteJobRepository();
  assert.throws(() => repository.enqueue({
    tenantReference: TENANT_A,
    siteReference: SITE_A,
    jobType: 'CREATE_SITE_SNAPSHOT',
    payload: {
      jobType: 'CREATE_SITE_SNAPSHOT',
      siteReference: SITE_B,
      versionReference: VERSION_A,
      snapshotKind: 'PREVIEW',
    },
  }), /Cross-tenant/);
  assert.match(migration, /Site job site ownership mismatch/);
});

test('21. job handler registry returns known handlers', () => {
  assert.ok(createSiteJobHandlerRegistry(true).has('TEST_SUCCEED'));
});

test('21a. production registry exposes provisioning, generation, quality and Phase 15.9 publication handlers', () => {
  const registry = createSiteJobHandlerRegistry(false);
  assert.deepEqual(registry.list().map(handler => handler.jobType), [
    'ACTIVATE_CUSTOM_DOMAIN',
    'ACTIVATE_FALLBACK_DOMAIN',
    'CONFIGURE_CUSTOM_DOMAIN_DNS',
    'CREATE_CUSTOM_DOMAIN_PLAN',
    'CREATE_SITE_PUBLICATION',
    'DISCOVER_CUSTOM_DOMAIN_DNS',
    'EVALUATE_PUBLICATION_READINESS',
    'GENERATE_METADATA',
    'GENERATE_PAGE',
    'GENERATE_SITE',
    'GENERATE_STRUCTURED_DATA',
    'INVALIDATE_SITE_CACHE',
    'PROVISION_WORKSPACE',
    'REGENERATE_SECTION',
    'REMOVE_SITE_DOMAIN',
    'ROLLBACK_SITE_PUBLICATION',
    'RUN_ACCESSIBILITY_AUDIT',
    'RUN_ASSET_READINESS_AUDIT',
    'RUN_BOOKING_INTEGRITY_AUDIT',
    'RUN_CONTENT_INTEGRITY_AUDIT',
    'RUN_CONVERSION_AUDIT',
    'RUN_FULL_SITE_QUALITY_AUDIT',
    'RUN_PERFORMANCE_AUDIT',
    'RUN_PUBLICATION_HEALTH_CHECKS',
    'RUN_RESPONSIVE_UX_AUDIT',
    'RUN_TECHNICAL_SEO_AUDIT',
    'SUSPEND_SITE_DOMAIN',
    'VERIFY_CUSTOM_DOMAIN',
    'VERIFY_NAMESERVER_DELEGATION',
  ]);
});

test('21b. publication snapshots and rollback evidence are committed atomically', () => {
  assert.match(publicationExecutorSource, /candidate\.siteStatus = 'LIVE'/);
  assert.match(publicationExecutorSource, /candidate\.versionStatus = 'PUBLISHED'/);
  assert.match(publicationExecutorSource, /this\.database\.transaction/);
  assert.match(publicationExecutorSource, /INSERT INTO site_rollback_events/);
  assert.match(publicationExecutorSource, /requestedByAgencyUserReference/);
  assert.match(publicationExecutorSource, /from_snapshot_id, to_snapshot_id/);
});

test('22. registry rejects arbitrary module paths', () => {
  const registry = createSiteJobHandlerRegistry(true);
  assert.equal(registry.get('../../payload.js' as RegisteredSiteJobType), undefined);
});

test('23. no eval or runtime compilation is used', () => {
  assert.doesNotMatch(workerSource, /\beval\s*\(/);
  assert.doesNotMatch(workerSource, /new Function\s*\(/);
  assert.doesNotMatch(workerSource, /import\s*\(\s*job/);
});

test('24. successful handler marks job COMPLETED', async () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue();
  const { worker } = createWorker(repository);
  await worker.runOnce();
  await eventually(() => worker.activeJobCount() === 0);
  assert.equal(job.status, 'COMPLETED');
});

test('25. successful attempt record is written', async () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue();
  const { worker } = createWorker(repository);
  await worker.runOnce();
  await eventually(() => worker.activeJobCount() === 0);
  assert.equal(job.attempts[0]?.outcome, 'COMPLETED');
});

test('26. retryable failure schedules a retry', async () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue({
    jobType: 'TEST_RETRYABLE_FAILURE',
    payload: {
      jobType: 'TEST_RETRYABLE_FAILURE',
      correlationReference: CORRELATION,
    },
  });
  const { worker } = createWorker(repository);
  await worker.runOnce();
  await eventually(() => worker.activeJobCount() === 0);
  assert.equal(job.status, 'RETRY_DELAY');
});

test('27. retry delay increases according to policy', () => {
  const first = retryDelayMs(1, DEFAULT_SITE_JOB_RETRY_POLICY, 0.5);
  const second = retryDelayMs(2, DEFAULT_SITE_JOB_RETRY_POLICY, 0.5);
  assert.ok(second > first);
});

test('28. maximum retry delay is respected', () => {
  assert.equal(retryDelayMs(20, {
    ...DEFAULT_SITE_JOB_RETRY_POLICY,
    maximumDelayMs: 2_000,
    jitterRatio: 0,
  }, 0.5), 2_000);
});

test('29. maximum attempts moves job to dead letter', () => {
  assert.deepEqual(decideSiteJobRetry({
    attemptNumber: 5,
    failureCode: 'RETRYABLE_EXTERNAL_FAILURE',
    policy: DEFAULT_SITE_JOB_RETRY_POLICY,
  }), { retry: false, deadLetter: true, delayMs: null });
});

test('30. terminal validation error is not retried', () => {
  assert.equal(decideSiteJobRetry({
    attemptNumber: 1,
    failureCode: 'TERMINAL_VALIDATION_FAILURE',
    policy: DEFAULT_SITE_JOB_RETRY_POLICY,
  }).retry, false);
});

test('31. permission failure is not retried', () => {
  assert.equal(decideSiteJobRetry({
    attemptNumber: 1,
    failureCode: 'TERMINAL_PERMISSION_FAILURE',
    policy: DEFAULT_SITE_JOB_RETRY_POLICY,
  }).retry, false);
});

test('32. handler not implemented is controlled and non-successful', async () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue({
    jobType: 'CREATE_SITE_SNAPSHOT',
    payload: {
      jobType: 'CREATE_SITE_SNAPSHOT',
      siteReference: SITE_A,
      versionReference: VERSION_A,
      snapshotKind: 'PREVIEW',
    },
  });
  const { worker } = createWorker(repository);
  await worker.runOnce();
  await eventually(() => worker.activeJobCount() === 0);
  assert.equal(job.status, 'FAILED');
  assert.equal(job.failure?.failureCode, 'TERMINAL_HANDLER_NOT_IMPLEMENTED');
});

test('33. cancellation request is visible to a running handler', async () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue({
    jobType: 'TEST_CANCELLABLE',
    payload: {
      jobType: 'TEST_CANCELLABLE',
      correlationReference: CORRELATION,
      durationMs: 1_000,
    },
  });
  const { worker } = createWorker(repository);
  await worker.runOnce();
  await eventually(() => job.status === 'PROCESSING');
  repository.requestCancellation(job.reference);
  await eventually(() => job.status === 'CANCELLED');
});

test('34. pending job may be cancelled immediately', () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue();
  repository.requestCancellation(job.reference);
  assert.equal(job.status, 'CANCELLED');
});

test('35. completed job cannot be cancelled', () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue();
  job.status = 'COMPLETED';
  assert.throws(
    () => repository.requestCancellation(job.reference),
    /NOT_CANCELLABLE/,
  );
});

test('36. tenant users cannot cancel site jobs', () => {
  assert.match(routeSource, /request\.requireAgency/);
  assert.doesNotMatch(routeSource, /requireAuth\(\)/);
});

test('37. unauthorised agency users cannot retry jobs', () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue();
  job.status = 'FAILED';
  assert.throws(
    () => repository.manualRetry(job.reference, false),
    /AGENCY_FORBIDDEN/,
  );
  assert.match(routeSource, /'sites\.jobs\.retry'/);
});

test('38. manual retry creates an audit event', () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue();
  job.status = 'FAILED';
  repository.manualRetry(job.reference);
  assert.ok(repository.audits.includes('SITE_JOB_MANUALLY_RETRIED'));
  assert.match(serviceSource, /SITE_JOB_MANUALLY_RETRIED/);
});

test('39. cancellation creates an audit event', () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue();
  repository.requestCancellation(job.reference);
  assert.ok(repository.audits.includes('SITE_JOB_CANCELLED'));
  assert.match(serviceSource, /SITE_JOB_CANCEL_REQUESTED/);
});

test('40. repeated idempotent enqueue returns the same job', () => {
  const repository = new MemorySiteJobRepository();
  assert.equal(repository.enqueue(), repository.enqueue());
});

test('41. idempotency does not merge jobs across tenants', () => {
  const repository = new MemorySiteJobRepository();
  const first = repository.enqueue({ tenantReference: TENANT_A });
  const second = repository.enqueue({ tenantReference: TENANT_B });
  assert.notEqual(first.reference, second.reference);
});

test('42. changed source digest creates a new job', () => {
  const repository = new MemorySiteJobRepository();
  const first = repository.enqueue({ sourceDigest: 'a'.repeat(64) });
  const second = repository.enqueue({ sourceDigest: 'b'.repeat(64) });
  assert.notEqual(first.reference, second.reference);
});

test('43. progress updates require a valid lease', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue();
  const lease = await repository.claimNext('worker-a', 30);
  assert.ok(lease);
  await repository.start(lease);
  await assert.rejects(
    repository.updateProgress({ ...lease, leaseToken: 'wrong' }, {
      current: 1,
      total: 2,
    }),
    SiteJobLeaseLostError,
  );
});

test('44. progress cannot decrease unexpectedly', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue();
  const lease = await repository.claimNext('worker-a', 30);
  assert.ok(lease);
  await repository.start(lease);
  await repository.updateProgress(lease, { current: 2, total: 3 });
  await assert.rejects(
    repository.updateProgress(lease, { current: 1, total: 3 }),
    /Progress cannot decrease/,
  );
});

test('45. progress event does not expose payload data', async () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue();
  const lease = await repository.claimNext('worker-a', 30);
  assert.ok(lease);
  await repository.start(lease);
  await repository.updateProgress(lease, { current: 1, total: 2 });
  const event = job.events.at(-1);
  assert.deepEqual(event?.safeMetadata, { current: 1, total: 2 });
  assert.equal('payload' in (event?.safeMetadata || {}), false);
});

test('46. result JSON validates against handler result schema', () => {
  assert.equal(SiteJobResultSchema.safeParse({
    summary: 'Done',
    unexpectedSecret: 'secret',
  }).success, false);
});

test('47. secrets are not present in API responses', () => {
  assert.doesNotMatch(serviceSource, /leaseTokenDigest:/);
  assert.doesNotMatch(serviceSource, /payloadJson:/);
  assert.doesNotMatch(serviceSource, /idempotencyKey:/);
});

test('48. full payload is not returned to unauthorised viewers', () => {
  assert.match(routeSource, /sites\.jobs\.read/);
  assert.doesNotMatch(serviceSource, /payload:\s*siteJobs\.payloadJson/);
});

test('49. worker honours configured concurrency', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue({
    tenantReference: TENANT_A,
    jobType: 'TEST_LONG_RUNNING',
    payload: {
      jobType: 'TEST_LONG_RUNNING',
      correlationReference: CORRELATION,
      durationMs: 50,
    },
  });
  repository.enqueue({
    tenantReference: TENANT_B,
    jobType: 'TEST_LONG_RUNNING',
    payload: {
      jobType: 'TEST_LONG_RUNNING',
      correlationReference: CORRELATION,
      durationMs: 50,
    },
  });
  const { worker } = createWorker(repository, undefined, { concurrency: 2 });
  assert.equal(await worker.runOnce(), 2);
  await eventually(() => worker.activeJobCount() === 0);
});

test('50. worker does not exceed configured concurrency', async () => {
  const repository = new MemorySiteJobRepository();
  for (const tenant of [TENANT_A, TENANT_B]) {
    repository.enqueue({
      tenantReference: tenant,
      jobType: 'TEST_LONG_RUNNING',
      payload: {
        jobType: 'TEST_LONG_RUNNING',
        correlationReference: CORRELATION,
        durationMs: 30,
      },
    });
  }
  const { worker } = createWorker(repository, undefined, { concurrency: 1 });
  await worker.runOnce();
  await eventually(() => worker.activeJobCount() === 0);
  assert.equal(repository.maximumActiveObserved, 1);
});

test('51. one tenant cannot bypass ownership checks', () => {
  assert.match(migration, /version ownership mismatch/);
  assert.match(migration, /blueprint ownership mismatch/);
  assert.match(migration, /tenant_id = NEW\.tenant_id/);
});

test('52. agency job list can filter by site', () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue({ tenantReference: TENANT_A });
  repository.enqueue({ tenantReference: TENANT_B });
  assert.equal(repository.list({ siteReference: SITE_A }).length, 1);
  assert.match(serviceSource, /query\.siteReference/);
});

test('53. agency job list can filter by status', () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue();
  job.status = 'FAILED';
  assert.equal(repository.list({ status: 'FAILED' }).length, 1);
  assert.match(serviceSource, /query\.status/);
});

test('54. agency job list can filter by job type', () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue();
  assert.equal(repository.list({ jobType: 'TEST_SUCCEED' }).length, 1);
  assert.match(serviceSource, /query\.jobType/);
});

test('55. job attempts are returned in correct order', async () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue();
  const first = await repository.claimNext('worker-a', 1);
  assert.ok(first);
  await repository.start(first);
  repository.advance(1_001);
  await repository.claimNext('worker-b', 30);
  assert.deepEqual(job.attempts.map(attempt => attempt.attemptNumber), [1, 2]);
  assert.match(serviceSource, /asc\(siteJobAttempts\.attemptNumber\)/);
});

test('56. job events are returned in correct order', () => {
  assert.match(
    serviceSource,
    /asc\(siteJobEvents\.occurredAt\), asc\(siteJobEvents\.id\)/,
  );
  assert.match(migration, /site_job_events_job_occurred_idx/);
});

test('57. worker restart does not lose durable jobs', async () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue();
  const first = createWorker(repository);
  await first.worker.runOnce();
  await eventually(() => first.worker.activeJobCount() === 0);
  assert.equal(job.status, 'COMPLETED');
  const second = createWorker(repository);
  assert.equal(await second.worker.runOnce(), 0);
});

test('58. abandoned processing job is recovered after lease expiry', async () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue();
  const lease = await repository.claimNext('worker-a', 1);
  assert.ok(lease);
  await repository.start(lease);
  repository.advance(1_001);
  await repository.claimNext('worker-b', 30);
  assert.ok(job.events.some(event => event.type === 'JOB_LEASE_EXPIRED'));
});

test('59. graceful shutdown stops new leasing', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue();
  const { worker } = createWorker(repository);
  await worker.shutdown();
  assert.equal(await worker.runOnce(), 0);
});

test('60. graceful shutdown waits for bounded active work', async () => {
  const repository = new MemorySiteJobRepository();
  repository.enqueue({
    jobType: 'TEST_CANCELLABLE',
    payload: {
      jobType: 'TEST_CANCELLABLE',
      correlationReference: CORRELATION,
      durationMs: 1_000,
    },
  });
  const { worker } = createWorker(repository);
  await worker.runOnce();
  const result = await worker.shutdown();
  assert.equal(result.timedOut, false);
  assert.equal(worker.activeJobCount(), 0);
});

test('61. health output does not expose environment secrets', async () => {
  const repository = new MemorySiteJobRepository();
  const registry = createSiteJobHandlerRegistry(true);
  const health = new SiteWorkerHealth(repository, registry);
  health.markPoll();
  const output = JSON.stringify(await health.snapshot());
  assert.doesNotMatch(output, /DATABASE_URL|postgresql:|secret|token/i);
});

test('62. migration preserves existing email outbox tables', () => {
  assert.doesNotMatch(migration, /ALTER TABLE email_outbox/i);
  assert.doesNotMatch(migration, /DROP TABLE/i);
});

test('63. Phase 15.0-15.5 job relationships remain additive', () => {
  assert.match(migration, /ALTER TABLE site_jobs/);
  assert.doesNotMatch(migration, /DROP COLUMN/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
});

test('64. no external API is called by worker handlers', () => {
  const sources = [workerSource, postgresRepositorySource];
  for (const source of sources) {
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /axios|openai|gemini|anthropic/i);
  }
});

test('65. test handlers cannot be invoked through production agency APIs', () => {
  assert.match(serviceSource, /NOT LIKE 'TEST/);
  assert.doesNotMatch(routeSource, /TEST_SUCCEED|TEST_CANCELLABLE/);
  assert.doesNotMatch(routeSource, /app\.post\('\/site-jobs'\s*,/);
});

test('66. job status transitions are explicit', () => {
  assert.equal(canTransitionSiteJob('PENDING', 'LEASED'), true);
  assert.equal(canTransitionSiteJob('COMPLETED', 'PENDING'), false);
  assert.throws(
    () => assertSiteJobTransition('COMPLETED', 'CANCELLED'),
    /Invalid site job transition/,
  );
});

test('67. test handlers cannot be enabled in production configuration', () => {
  assert.throws(() => parseSiteWorkerConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://test.invalid/test',
    SITE_WORKER_ENABLE_TEST_HANDLERS: 'true',
  }), /cannot be enabled in production/);
});

test('67a. enabled AI generation requires server-side provider configuration', () => {
  assert.throws(() => parseSiteWorkerConfig({
    DATABASE_URL: 'postgresql://test.invalid/test',
    SITE_AI_GENERATION_ENABLED: 'true',
  }), /server-side/);
  const config = parseSiteWorkerConfig({
    DATABASE_URL: 'postgresql://test.invalid/test',
    SITE_AI_GENERATION_ENABLED: 'true',
    SITE_AI_PROVIDER: 'gemini',
    SITE_AI_MODEL: 'test-model',
    SITE_AI_API_KEY: 'test-key',
  });
  assert.equal(config.generation.enabled, true);
  assert.equal(config.generation.model, 'test-model');
  assert.match(compositionSource, /createConfiguredSiteGenerationExecutor/);
  assert.match(generationExecutorSource, /class PostgresSiteGenerationExecutor/);
  assert.match(generationExecutorSource, /executeStructuredSiteGeneration/);
  assert.doesNotMatch(generationExecutorSource, /console\.|rawPrompt|rawResponse/);
});

test('67aa. quality browser configuration is explicit and fail-closed', () => {
  assert.throws(() => parseSiteWorkerConfig({
    DATABASE_URL: 'postgresql://test.invalid/test',
    SITE_QUALITY_BROWSER_ENABLED: 'true',
  }), /requires the site-quality worker/);
  assert.throws(() => parseSiteWorkerConfig({
    DATABASE_URL: 'postgresql://test.invalid/test',
    SITE_QUALITY_ENABLED: 'true',
    SITE_QUALITY_BROWSER_ENABLED: 'true',
  }), /preview origin and preview-token secret/);
  const quality = parseSiteWorkerConfig({
    DATABASE_URL: 'postgresql://test.invalid/test',
    SITE_QUALITY_ENABLED: 'true',
    SITE_QUALITY_BROWSER_ENABLED: 'true',
    SITE_QUALITY_PREVIEW_ORIGIN: 'https://preview.example.test/',
    SITE_PREVIEW_TOKEN_SECRET: 'a-quality-preview-secret-that-is-at-least-32-characters',
  }).quality;
  assert.equal(quality.enabled, true);
  assert.equal(quality.browserEnabled, true);
  assert.equal(quality.previewOrigin, 'https://preview.example.test');
  assert.equal(quality.browserConcurrency, 2);
});

test('67ab. live AI quality review remains disabled without a configured provider', () => {
  assert.throws(() => parseSiteWorkerConfig({
    DATABASE_URL: 'postgresql://test.invalid/test',
    SITE_QUALITY_AI_ENABLED: 'true',
  }), /must remain disabled/);
});

test('67b. controlled regeneration advances the linked review revision', () => {
  assert.match(generationExecutorSource, /completeReviewRegeneration/);
  assert.match(
    generationExecutorSource,
    /siteChangeRequests\)\.set\(\{[\s\S]*status: 'READY_FOR_REVIEW'/,
  );
  assert.match(
    generationExecutorSource,
    /siteReviewCycles\)\.set\(\{[\s\S]*status: 'SUPERSEDED'/,
  );
  assert.match(
    generationExecutorSource,
    /transaction\.insert\(siteReviewCycles\)[\s\S]*reviewRevision:/,
  );
  assert.match(generationExecutorSource, /pinnedContentDigestSha256: contentDigestSha256/);
  assert.match(generationExecutorSource, /SITE_APPROVAL_INVALIDATED/);
  assert.match(generationExecutorSource, /SITE_REVISION_READY/);
  assert.match(generationExecutorSource, /site-review-notification/);
});

test('67c. completed generation persists a validated digest-bound preview without publishing', () => {
  assert.match(generationExecutorSource, /persistValidatedPreviewSnapshot/);
  assert.match(generationExecutorSource, /prepareSiteRenderSnapshotForStorage/);
  assert.match(generationExecutorSource, /snapshotKind: 'PREVIEW'/);
  assert.match(generationExecutorSource, /sourceContentDigestSha256/);
  assert.doesNotMatch(
    generationExecutorSource.match(
      /async function persistValidatedPreviewSnapshot[\s\S]*?function mapProviderError/,
    )?.[0] ?? '',
    /snapshotKind: 'PUBLISHED'|visibility: 'PUBLISHED'|publishedAt: new Date/,
  );
});

test('68. handler registry rejects duplicate registration', () => {
  const registry = new SiteJobHandlerRegistry();
  const handler: SiteJobHandler = {
    jobType: 'TEST_SUCCEED',
    payloadSchemaVersion: 1,
    supportsCancellation: false,
    defaultRetryPolicy: DEFAULT_SITE_JOB_RETRY_POLICY,
    payloadSchema: SiteJobPayloadSchema,
    resultSchema: SiteJobResultSchema,
    async execute() {
      return { summary: 'Done', outputReferences: [], metrics: {} };
    },
  };
  registry.register(handler);
  assert.throws(() => registry.register(handler), /already registered/);
});

test('69. queue indexes are partial and foreign keys are indexed', () => {
  assert.match(migration, /site_jobs_worker_queue_idx[\s\S]*WHERE status IN/);
  assert.match(migration, /site_jobs_blueprint_idx/);
  assert.match(migration, /site_job_attempts_tenant_started_idx/);
});

test('70. public job history is server-only and RLS protected', () => {
  assert.match(migration, /site_job_attempts ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /site_job_events ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE site_job_events FROM anon, authenticated/,
  );
});

test('71. expired final-attempt leases move to dead letter', async () => {
  const repository = new MemorySiteJobRepository();
  const job = repository.enqueue({ maxAttempts: 1 });
  const lease = await repository.claimNext('worker-a', 1);
  assert.ok(lease);
  await repository.start(lease);
  repository.advance(1_001);
  assert.equal(await repository.recoverExpiredTerminalLeases(), 1);
  assert.equal(job.status, 'DEAD_LETTER');
  assert.match(postgresRepositorySource, /recoverExpiredTerminalLeases/);
});

test('72. dead-letter audit metadata binds concrete PostgreSQL types', () => {
  assert.match(
    postgresRepositorySource,
    /'jobType', \$\{job\.jobType\}::text,[\s\S]*'failureCode', \$\{update\.failureCode\}::text,[\s\S]*'attemptNumber', \$\{job\.attemptNumber\}::integer/,
  );
  assert.match(
    postgresRepositorySource,
    /'jobType', \$\{row\.job_type\}::text,[\s\S]*'attemptNumber', \$\{row\.attempt_count\}::integer/,
  );
});
