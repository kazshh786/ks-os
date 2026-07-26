import type { SiteGenerationRunStatus } from './contracts.js';

const TRANSITIONS: Record<SiteGenerationRunStatus, readonly SiteGenerationRunStatus[]> = {
  PENDING: ['PREPARING_CONTEXT', 'CANCEL_REQUESTED', 'CANCELLED', 'FAILED'],
  PREPARING_CONTEXT: ['GENERATING', 'CANCEL_REQUESTED', 'FAILED'],
  GENERATING: ['VALIDATING', 'CANCEL_REQUESTED', 'FAILED'],
  VALIDATING: ['REPAIRING', 'READY_FOR_REVIEW', 'CANCEL_REQUESTED', 'FAILED'],
  REPAIRING: ['GENERATING', 'VALIDATING', 'CANCEL_REQUESTED', 'FAILED'],
  READY_FOR_REVIEW: ['SUPERSEDED'],
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

export function isReviewableGenerationStatus(status: SiteGenerationRunStatus) {
  return status === 'READY_FOR_REVIEW';
}
