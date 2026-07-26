import type {
  SiteJobFailureCode,
  SiteJobProgress,
  SiteJobResult,
} from '@ks-os/site-jobs';

export interface LeasedSiteJob {
  id: string;
  publicReference: string;
  tenantId: string;
  tenantReference: string;
  siteId: string;
  siteReference: string;
  versionReference: string | null;
  blueprintReference: string | null;
  jobType: string;
  payload: unknown;
  payloadSchemaVersion: number;
  attemptNumber: number;
  maxAttempts: number;
  workerId: string;
  leaseToken: string;
  leaseExpiresAt: Date;
}

export interface SiteJobFailureUpdate {
  failureCode: SiteJobFailureCode;
  failureMessage: string;
  retryable: boolean;
  targetStatus: 'RETRY_DELAY' | 'FAILED' | 'DEAD_LETTER';
  availableAt?: Date;
}

export interface SiteJobRepositoryHealth {
  databaseAvailable: boolean;
  schemaCompatible: boolean;
}

export type SiteJobCompletionOutcome = 'COMPLETED' | 'CANCELLED';

export interface SiteJobRepository {
  claimNext(workerId: string, leaseSeconds: number): Promise<LeasedSiteJob | null>;
  start(job: LeasedSiteJob): Promise<void>;
  heartbeat(
    job: LeasedSiteJob,
    leaseSeconds: number,
  ): Promise<{ cancellationRequested: boolean; leaseExpiresAt: Date }>;
  updateProgress(job: LeasedSiteJob, progress: SiteJobProgress): Promise<void>;
  isCancellationRequested(job: LeasedSiteJob): Promise<boolean>;
  complete(
    job: LeasedSiteJob,
    result: SiteJobResult,
  ): Promise<SiteJobCompletionOutcome>;
  fail(job: LeasedSiteJob, update: SiteJobFailureUpdate): Promise<void>;
  cancelLeased(job: LeasedSiteJob, message: string): Promise<void>;
  recoverExpiredCancellationRequests(limit?: number): Promise<number>;
  recoverExpiredTerminalLeases(limit?: number): Promise<number>;
  health(): Promise<SiteJobRepositoryHealth>;
}

export class SiteJobLeaseLostError extends Error {
  constructor() {
    super('The site job lease is no longer owned by this worker.');
    this.name = 'SiteJobLeaseLostError';
  }
}
