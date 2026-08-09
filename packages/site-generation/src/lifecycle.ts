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

export function isQualityAuditableGenerationStatus(
  status: unknown,
): status is Extract<SiteGenerationRunStatus, 'DESIGN_COMPLETE' | 'READY_FOR_REVIEW'> {
  const parsed = SiteGenerationRunStatusSchema.safeParse(status);
  return parsed.success && ['DESIGN_COMPLETE', 'READY_FOR_REVIEW'].includes(parsed.data);
}
