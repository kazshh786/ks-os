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
