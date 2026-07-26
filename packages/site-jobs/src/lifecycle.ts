import type { SiteJobStatus } from './contracts.js';

const transitions: Readonly<Record<SiteJobStatus, readonly SiteJobStatus[]>> = {
  PENDING: ['LEASED', 'CANCELLED'],
  SCHEDULED: ['LEASED', 'CANCELLED'],
  LEASED: [
    'PROCESSING',
    'LEASED',
    'RETRY_DELAY',
    'FAILED',
    'CANCEL_REQUESTED',
    'CANCELLED',
    'DEAD_LETTER',
  ],
  PROCESSING: [
    'LEASED',
    'COMPLETED',
    'RETRY_DELAY',
    'FAILED',
    'CANCEL_REQUESTED',
    'CANCELLED',
    'DEAD_LETTER',
  ],
  RETRY_DELAY: ['LEASED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: ['PENDING'],
  CANCEL_REQUESTED: ['LEASED', 'CANCELLED', 'COMPLETED', 'FAILED', 'DEAD_LETTER'],
  CANCELLED: [],
  DEAD_LETTER: ['PENDING'],
};

export function canTransitionSiteJob(
  from: SiteJobStatus,
  to: SiteJobStatus,
): boolean {
  return from === to || transitions[from].includes(to);
}

export function assertSiteJobTransition(
  from: SiteJobStatus,
  to: SiteJobStatus,
): void {
  if (!canTransitionSiteJob(from, to)) {
    throw new Error(`Invalid site job transition: ${from} -> ${to}.`);
  }
}

export function listSiteJobTransitions(
  status: SiteJobStatus,
): readonly SiteJobStatus[] {
  return transitions[status];
}
