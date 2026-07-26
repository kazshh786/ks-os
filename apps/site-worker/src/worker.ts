import { z } from 'zod';
import {
  DEFAULT_SITE_JOB_RETRY_POLICY,
  RegisteredSiteJobTypeSchema,
  SiteJobExecutionError,
  SiteJobProgressSchema,
  SiteJobResultSchema,
  decideSiteJobRetry,
  safeFailureMessage,
  type SiteJobFailureCode,
  type SiteJobHandler,
  type SiteJobHandlerRegistry,
  type SiteJobLeaseContext,
  type SiteJobRetryPolicy,
} from '@ks-os/site-jobs';
import type { SiteWorkerConfig } from './config.js';
import type { SiteWorkerHealth } from './health.js';
import type { SiteWorkerLogger } from './logger.js';
import {
  type LeasedSiteJob,
  type SiteJobRepository,
  SiteJobLeaseLostError,
} from './repository.types.js';

interface ActiveJob {
  controller: AbortController;
  promise: Promise<void>;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function errorCode(error: unknown): SiteJobFailureCode {
  if (error instanceof SiteJobExecutionError) return error.code;
  if (error instanceof z.ZodError) return 'TERMINAL_VALIDATION_FAILURE';
  return 'UNEXPECTED_HANDLER_FAILURE';
}

export class SiteWorker {
  private readonly activeJobs = new Map<string, ActiveJob>();
  private draining = false;
  private loopPromise: Promise<void> | null = null;
  private pollWakeup: (() => void) | null = null;

  constructor(
    private readonly config: SiteWorkerConfig,
    private readonly repository: SiteJobRepository,
    private readonly registry: SiteJobHandlerRegistry,
    private readonly logger: SiteWorkerLogger,
    private readonly health: SiteWorkerHealth,
  ) {}

  start(): void {
    if (this.loopPromise) throw new Error('The site worker is already running.');
    this.loopPromise = this.pollLoop();
  }

  async waitUntilStopped(): Promise<void> {
    await this.loopPromise;
  }

  async runOnce(): Promise<number> {
    if (this.draining) return 0;
    this.health.markPoll();
    await this.repository.recoverExpiredCancellationRequests();
    await this.repository.recoverExpiredTerminalLeases();
    let claimed = 0;
    while (this.activeJobs.size < this.config.concurrency) {
      const job = await this.repository.claimNext(
        this.config.workerId,
        this.config.leaseSeconds,
      );
      if (!job) break;
      claimed += 1;
      this.startActiveJob(job);
    }
    return claimed;
  }

  async shutdown(): Promise<{ timedOut: boolean; remainingJobs: number }> {
    if (this.draining) {
      return { timedOut: false, remainingJobs: this.activeJobs.size };
    }
    this.draining = true;
    this.health.markDraining();
    this.pollWakeup?.();
    const shutdownReason = new SiteJobExecutionError(
      'WORKER_SHUTDOWN',
      'The site worker is shutting down.',
    );
    for (const active of this.activeJobs.values()) {
      active.controller.abort(shutdownReason);
    }

    const settled = Promise.allSettled(
      [...this.activeJobs.values()].map(active => active.promise),
    ).then(() => false);
    const timeout = wait(this.config.shutdownTimeoutSeconds * 1_000)
      .then(() => true);
    const timedOut = await Promise.race([settled, timeout]);
    const remainingJobs = this.activeJobs.size;
    this.logger.info('Site worker shutdown completed.', {
      workerId: this.config.workerId,
      event: timedOut ? 'shutdown_timeout' : 'shutdown_complete',
    });
    return { timedOut, remainingJobs };
  }

  activeJobCount(): number {
    return this.activeJobs.size;
  }

  isDraining(): boolean {
    return this.draining;
  }

  private async pollLoop(): Promise<void> {
    this.logger.info('Site worker poll loop started.', {
      workerId: this.config.workerId,
      event: 'worker_started',
    });
    while (!this.draining) {
      try {
        await this.runOnce();
      } catch (error) {
        this.logger.error('Site worker poll failed.', {
          workerId: this.config.workerId,
          event: 'poll_failed',
          failureCode: errorCode(error),
        });
      }
      if (!this.draining) await this.waitForNextPoll();
    }
  }

  private waitForNextPoll(): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pollWakeup = null;
        resolve();
      }, this.config.pollIntervalMs);
      this.pollWakeup = () => {
        clearTimeout(timer);
        this.pollWakeup = null;
        resolve();
      };
    });
  }

  private startActiveJob(job: LeasedSiteJob): void {
    const controller = new AbortController();
    const promise = this.processJob(job, controller)
      .finally(() => {
        this.activeJobs.delete(job.publicReference);
        this.health.setActiveJobCount(this.activeJobs.size);
      });
    this.activeJobs.set(job.publicReference, { controller, promise });
    this.health.setActiveJobCount(this.activeJobs.size);
  }

  private async processJob(
    job: LeasedSiteJob,
    controller: AbortController,
  ): Promise<void> {
    const startedAt = Date.now();
    let handler: SiteJobHandler | undefined;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    const logContext = {
      workerId: this.config.workerId,
      jobPublicReference: job.publicReference,
      jobType: job.jobType,
      tenantPublicReference: job.tenantReference,
      sitePublicReference: job.siteReference,
      attemptNumber: job.attemptNumber,
    };
    try {
      await this.repository.start(job);
      const parsedType = RegisteredSiteJobTypeSchema.safeParse(job.jobType);
      if (!parsedType.success) {
        throw new SiteJobExecutionError(
          'TERMINAL_HANDLER_NOT_IMPLEMENTED',
          'The stored site job type is unsupported.',
        );
      }
      handler = this.registry.get(parsedType.data);
      if (!handler) {
        throw new SiteJobExecutionError(
          'TERMINAL_HANDLER_NOT_IMPLEMENTED',
          `No handler is implemented for ${parsedType.data}.`,
        );
      }
      if (handler.payloadSchemaVersion !== job.payloadSchemaVersion) {
        throw new SiteJobExecutionError(
          'TERMINAL_SCHEMA_VERSION_INCOMPATIBLE',
          'The stored payload schema version is not supported.',
        );
      }
      const payload = handler.payloadSchema.parse(job.payload);

      heartbeatTimer = setInterval(() => {
        void this.sendHeartbeat(job, controller);
      }, this.config.heartbeatSeconds * 1_000);
      heartbeatTimer.unref();

      const context: SiteJobLeaseContext = {
        workerId: this.config.workerId,
        jobReference: job.publicReference,
        tenantReference: job.tenantReference,
        siteReference: job.siteReference,
        attemptNumber: job.attemptNumber,
        signal: controller.signal,
        updateProgress: async progress => {
          const validated = SiteJobProgressSchema.parse(progress);
          await this.repository.updateProgress(job, validated);
        },
        isCancellationRequested: () =>
          this.repository.isCancellationRequested(job),
      };

      if (await context.isCancellationRequested()) {
        controller.abort(new SiteJobExecutionError(
          'CANCELLED_BY_USER',
          'Cancellation was requested before the handler started.',
        ));
      }
      const rawResult = await handler.execute(payload, context);
      const handlerResult = handler.resultSchema.parse(rawResult);
      const result = SiteJobResultSchema.parse(handlerResult);
      if (await context.isCancellationRequested()) {
        await this.repository.cancelLeased(
          job,
          'The job completed its atomic work after cancellation was requested.',
        );
      } else {
        await this.repository.complete(job, result);
      }
      this.logger.info('Site job processing finished.', {
        ...logContext,
        durationMs: Date.now() - startedAt,
        event: 'job_finished',
      });
    } catch (error) {
      await this.handleFailure(job, handler, controller, error, startedAt);
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }

  private async sendHeartbeat(
    job: LeasedSiteJob,
    controller: AbortController,
  ): Promise<void> {
    if (controller.signal.aborted || this.draining) return;
    try {
      const heartbeat = await this.repository.heartbeat(
        job,
        this.config.leaseSeconds,
      );
      job.leaseExpiresAt = heartbeat.leaseExpiresAt;
      if (heartbeat.cancellationRequested) {
        controller.abort(new SiteJobExecutionError(
          'CANCELLED_BY_USER',
          'Cancellation was requested by an agency user.',
        ));
      }
    } catch (error) {
      controller.abort(error instanceof Error
        ? error
        : new SiteJobLeaseLostError());
    }
  }

  private async handleFailure(
    job: LeasedSiteJob,
    handler: SiteJobHandler | undefined,
    controller: AbortController,
    error: unknown,
    startedAt: number,
  ): Promise<void> {
    const logContext = {
      workerId: this.config.workerId,
      jobPublicReference: job.publicReference,
      jobType: job.jobType,
      tenantPublicReference: job.tenantReference,
      sitePublicReference: job.siteReference,
      attemptNumber: job.attemptNumber,
      durationMs: Date.now() - startedAt,
    };
    const reason = controller.signal.aborted
      ? controller.signal.reason
      : error;
    if (this.draining
      && reason instanceof SiteJobExecutionError
      && reason.code === 'WORKER_SHUTDOWN') {
      this.logger.info('Site job yielded its lease during shutdown.', {
        ...logContext,
        event: 'job_shutdown_yield',
      });
      return;
    }
    if (reason instanceof SiteJobLeaseLostError
      || error instanceof SiteJobLeaseLostError) {
      this.logger.warn('Site job lease was lost.', {
        ...logContext,
        event: 'lease_lost',
        failureCode: 'LEASE_LOST',
      });
      return;
    }
    const failureCode = errorCode(reason);
    if (failureCode === 'CANCELLED_BY_USER') {
      try {
        await this.repository.cancelLeased(
          job,
          safeFailureMessage(reason),
        );
      } catch (cancelError) {
        if (!(cancelError instanceof SiteJobLeaseLostError)) throw cancelError;
      }
      this.logger.info('Site job was cancelled.', {
        ...logContext,
        event: 'job_cancelled',
        failureCode,
      });
      return;
    }

    const basePolicy = handler?.defaultRetryPolicy
      || DEFAULT_SITE_JOB_RETRY_POLICY;
    const policy: SiteJobRetryPolicy = {
      ...basePolicy,
      maxAttempts: Math.min(job.maxAttempts, basePolicy.maxAttempts),
    };
    const decision = decideSiteJobRetry({
      attemptNumber: job.attemptNumber,
      failureCode,
      policy,
      retryAfterMs: reason instanceof SiteJobExecutionError
        ? reason.retryAfterMs
        : undefined,
    });
    const targetStatus = decision.retry
      ? 'RETRY_DELAY'
      : decision.deadLetter
        ? 'DEAD_LETTER'
        : 'FAILED';
    await this.repository.fail(job, {
      failureCode,
      failureMessage: safeFailureMessage(reason),
      retryable: decision.retry || decision.deadLetter,
      targetStatus,
      availableAt: decision.delayMs === null
        ? undefined
        : new Date(Date.now() + decision.delayMs),
    });
    this.logger.warn('Site job attempt failed.', {
      ...logContext,
      event: targetStatus === 'RETRY_DELAY'
        ? 'job_retry_scheduled'
        : 'job_failed',
      failureCode,
    });
  }
}
