import {
  SiteGenerationRunStatusSchema,
  type SiteGenerationRunStatus,
} from './contracts.js';

const TRANSITIONS: Record<SiteGenerationRunStatus, readonly SiteGenerationRunStatus[]> = {
  PENDING: ['PREPARING_CONTEXT', 'CANCEL_REQUESTED', 'CANCELLED', 'FAILED'],
  PREPARING_CONTEXT: ['GENERATING', 'CANCEL_REQUESTED', 'FAILED'],
  GENERATING: ['VALIDATING', 'CANCEL_REQUESTED', 'FAILED'],
  VALIDATING: ['REPAIRING', 'DESIGN_COMPLETE', 'READY_FOR_REVIEW', 'CANCEL_REQUESTED', 'FAILED'],
  REPAIRING: ['GENERATING', 'VALIDATING', 'CANCEL_REQUESTED', 'FAILED'],
  DESIGN_COMPLETE: ['READY_FOR_REVIEW', 'SUPERSEDED'],
  READY_FOR_REVIEW: ['DESIGN_COMPLETE', 'SUPERSEDED'],
  FAILED: ['PENDING', 'SUPERSEDED'],
  CANCEL_REQUESTED: ['CANCELLED', 'FAILED'],
  CANCELLED: ['PENDING', 'SUPERSEDED'],
  SUPERSEDED: [],
};

export const TERMINAL_FAILED_SITE_JOB_STATUSES = ['FAILED', 'DEAD_LETTER'] as const;

const RECONCILABLE_GENERATION_STATUSES = new Set<SiteGenerationRunStatus>([
  'PENDING',
  'PREPARING_CONTEXT',
  'GENERATING',
  'VALIDATING',
  'REPAIRING',
  'CANCEL_REQUESTED',
]);

export interface TerminalGenerationJobState {
  status: string;
  failureCode?: string | null;
  failureMessage?: string | null;
}

export interface TerminalGenerationRunFailure {
  failureCode: string;
  failureMessage: string;
}

/**
 * The durable job is authoritative for infrastructure execution. This pure
 * policy is shared by API repair paths and worker terminal transitions so the
 * observable generation lifecycle cannot develop a second interpretation of
 * terminal failure.
 */
export function terminalGenerationRunFailure(
  runStatus: SiteGenerationRunStatus,
  job: TerminalGenerationJobState,
): TerminalGenerationRunFailure | null {
  if (!RECONCILABLE_GENERATION_STATUSES.has(runStatus)
    || !TERMINAL_FAILED_SITE_JOB_STATUSES.includes(
      job.status as typeof TERMINAL_FAILED_SITE_JOB_STATUSES[number],
    )) return null;
  return {
    failureCode: (job.failureCode || 'TERMINAL_JOB_STATE_RECONCILED').slice(0, 100),
    failureMessage: (
      job.failureMessage
      || 'The durable generation job failed before its run lifecycle was persisted.'
    ).slice(0, 500),
  };
}

export function isTerminalFailedSiteJobStatus(
  status: string,
): status is typeof TERMINAL_FAILED_SITE_JOB_STATUSES[number] {
  return TERMINAL_FAILED_SITE_JOB_STATUSES.includes(
    status as typeof TERMINAL_FAILED_SITE_JOB_STATUSES[number],
  );
}

export interface GenerationRetryIdentity {
  runReference: string;
  versionReference: string;
  jobReference: string;
  idempotencyKey: string;
  sourceDataDigestSha256: string;
  runStatus: SiteGenerationRunStatus;
  jobStatus: string;
}

/**
 * A manual infrastructure retry changes execution state only. The identity of
 * the durable job, governed run and pinned version is preserved.
 */
export function generationRetryProjection(input: GenerationRetryIdentity) {
  if (input.runStatus !== 'FAILED' || !isTerminalFailedSiteJobStatus(input.jobStatus)) {
    return null;
  }
  return {
    runReference: input.runReference,
    versionReference: input.versionReference,
    jobReference: input.jobReference,
    idempotencyKey: input.idempotencyKey,
    sourceDataDigestSha256: input.sourceDataDigestSha256,
    runStatus: 'PENDING' as const,
    versionGenerationStatus: 'INCOMPLETE' as const,
    jobStatus: 'PENDING' as const,
  };
}

export function assertGenerationRunTransition(
  from: SiteGenerationRunStatus,
  to: SiteGenerationRunStatus,
) {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid generation lifecycle transition: ${from} -> ${to}.`);
  }
}

export function isReviewableGenerationStatus(
  status: unknown,
): status is Extract<SiteGenerationRunStatus, 'READY_FOR_REVIEW'> {
  const parsed = SiteGenerationRunStatusSchema.safeParse(status);
  return parsed.success && parsed.data === 'READY_FOR_REVIEW';
}

export function assertGenerationRunTransitionForPipeline(
  from: SiteGenerationRunStatus,
  to: SiteGenerationRunStatus,
  pipelineVersion: 1 | 2,
) {
  assertGenerationRunTransition(from, to);
  if (pipelineVersion === 2 && from === 'VALIDATING' && to === 'READY_FOR_REVIEW') {
    throw new Error('Website Generation V2 must stop at DESIGN_COMPLETE before quality evidence can promote it.');
  }
  if (pipelineVersion === 2 && to === 'READY_FOR_REVIEW' && from !== 'DESIGN_COMPLETE') {
    throw new Error('Website Generation V2 reaches READY_FOR_REVIEW only from DESIGN_COMPLETE.');
  }
}

export function isQualityAuditableGenerationStatus(
  status: unknown,
): status is Extract<SiteGenerationRunStatus, 'DESIGN_COMPLETE' | 'READY_FOR_REVIEW'> {
  const parsed = SiteGenerationRunStatusSchema.safeParse(status);
  return parsed.success && ['DESIGN_COMPLETE', 'READY_FOR_REVIEW'].includes(parsed.data);
}
