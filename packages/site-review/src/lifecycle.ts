import {
  type ReviewCycleStatus,
  type ReviewParticipantRole,
  ReviewTransitionActionSchema,
} from './contracts.js';

export class SiteReviewPolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SiteReviewPolicyError';
  }
}

export const REVIEW_TRANSITIONS: Readonly<Record<ReviewCycleStatus, readonly ReviewCycleStatus[]>> = {
  DRAFT: ['INTERNAL_REVIEW', 'CANCELLED', 'SUPERSEDED'],
  INTERNAL_REVIEW: ['INTERNAL_CHANGES_REQUIRED', 'READY_FOR_CLIENT_REVIEW', 'REJECTED', 'CANCELLED', 'SUPERSEDED'],
  INTERNAL_CHANGES_REQUIRED: ['INTERNAL_REVIEW', 'REJECTED', 'CANCELLED', 'SUPERSEDED'],
  READY_FOR_CLIENT_REVIEW: ['CLIENT_REVIEW', 'AGENCY_FINAL_REVIEW', 'INTERNAL_CHANGES_REQUIRED', 'CANCELLED', 'SUPERSEDED'],
  CLIENT_REVIEW: ['CLIENT_CHANGES_REQUESTED', 'CLIENT_APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'],
  CLIENT_CHANGES_REQUESTED: ['INTERNAL_REVIEW', 'CLIENT_REVIEW', 'REJECTED', 'CANCELLED', 'SUPERSEDED'],
  CLIENT_APPROVED: ['AGENCY_FINAL_REVIEW', 'CLIENT_CHANGES_REQUESTED', 'CANCELLED', 'SUPERSEDED'],
  AGENCY_FINAL_REVIEW: ['AGENCY_APPROVED', 'INTERNAL_CHANGES_REQUIRED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'],
  AGENCY_APPROVED: ['SUPERSEDED'],
  REJECTED: ['SUPERSEDED'],
  CANCELLED: ['SUPERSEDED'],
  SUPERSEDED: [],
};

export function assertReviewTransition(from: ReviewCycleStatus, to: ReviewCycleStatus): void {
  if (!REVIEW_TRANSITIONS[from].includes(to)) {
    throw new SiteReviewPolicyError(
      'SITE_REVIEW_TRANSITION_INVALID',
      `Review cycle cannot transition from ${from} to ${to}.`,
    );
  }
}

const ACTION_TARGET = {
  OPEN_INTERNAL_REVIEW: 'INTERNAL_REVIEW',
  REQUEST_INTERNAL_CHANGES: 'INTERNAL_CHANGES_REQUIRED',
  MARK_READY_FOR_CLIENT: 'READY_FOR_CLIENT_REVIEW',
  START_CLIENT_REVIEW: 'CLIENT_REVIEW',
  REQUEST_CLIENT_CHANGES: 'CLIENT_CHANGES_REQUESTED',
  MARK_CLIENT_APPROVED: 'CLIENT_APPROVED',
  START_AGENCY_FINAL_REVIEW: 'AGENCY_FINAL_REVIEW',
  MARK_AGENCY_APPROVED: 'AGENCY_APPROVED',
  REJECT: 'REJECTED',
  CANCEL: 'CANCELLED',
  SUPERSEDE: 'SUPERSEDED',
} as const;

export function reviewTransitionTarget(action: unknown): ReviewCycleStatus {
  return ACTION_TARGET[ReviewTransitionActionSchema.parse(action)];
}

const PARTICIPANT_PERMISSIONS = {
  AGENCY_OWNER: ['READ', 'COMMENT', 'RESOLVE', 'CHANGE_REQUEST', 'FACT', 'CLIENT_APPROVE', 'AGENCY_APPROVE'],
  AGENCY_REVIEWER: ['READ', 'COMMENT', 'RESOLVE', 'CHANGE_REQUEST', 'FACT'],
  CLIENT_APPROVER: ['READ', 'COMMENT', 'RESOLVE_OWN', 'CHANGE_REQUEST', 'FACT', 'CLIENT_APPROVE'],
  CLIENT_REVIEWER: ['READ', 'COMMENT', 'RESOLVE_OWN', 'CHANGE_REQUEST', 'FACT'],
  FACT_VERIFIER: ['READ', 'COMMENT', 'FACT'],
  VIEW_ONLY: ['READ'],
} as const satisfies Record<ReviewParticipantRole, readonly string[]>;

export type ReviewParticipantPermission =
  | 'READ'
  | 'COMMENT'
  | 'RESOLVE'
  | 'RESOLVE_OWN'
  | 'CHANGE_REQUEST'
  | 'FACT'
  | 'CLIENT_APPROVE'
  | 'AGENCY_APPROVE';

export function participantCan(
  role: ReviewParticipantRole,
  permission: ReviewParticipantPermission,
): boolean {
  return (PARTICIPANT_PERMISSIONS[role] as readonly string[]).includes(permission);
}

export function assertParticipantCan(
  role: ReviewParticipantRole,
  permission: ReviewParticipantPermission,
): void {
  if (!participantCan(role, permission)) {
    throw new SiteReviewPolicyError(
      'SITE_REVIEW_PARTICIPANT_FORBIDDEN',
      `The ${role} role cannot perform this review action.`,
    );
  }
}
