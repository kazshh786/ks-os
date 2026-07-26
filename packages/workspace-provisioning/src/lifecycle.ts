import type { ProvisioningRunStatus } from './contracts.js';

export class ProvisioningPolicyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ProvisioningPolicyError';
  }
}

const transitions: Record<ProvisioningRunStatus, readonly ProvisioningRunStatus[]> = {
  QUEUED: ['PROVISIONING_TENANT', 'CANCEL_REQUESTED', 'FAILED'],
  PROVISIONING_TENANT: ['PROVISIONING_BUSINESS', 'PARTIALLY_FAILED', 'FAILED', 'CANCEL_REQUESTED'],
  PROVISIONING_BUSINESS: ['PROVISIONING_SERVICES', 'PARTIALLY_FAILED', 'FAILED', 'CANCEL_REQUESTED'],
  PROVISIONING_SERVICES: ['PROVISIONING_STAFF', 'PARTIALLY_FAILED', 'FAILED', 'CANCEL_REQUESTED'],
  PROVISIONING_STAFF: ['PROVISIONING_AVAILABILITY', 'PARTIALLY_FAILED', 'FAILED', 'CANCEL_REQUESTED'],
  PROVISIONING_AVAILABILITY: ['PROVISIONING_BOOKING', 'PARTIALLY_FAILED', 'FAILED', 'CANCEL_REQUESTED'],
  PROVISIONING_BOOKING: ['PROVISIONING_FORMS', 'PARTIALLY_FAILED', 'FAILED', 'CANCEL_REQUESTED'],
  PROVISIONING_FORMS: ['PROVISIONING_PAYMENTS', 'PARTIALLY_FAILED', 'FAILED', 'CANCEL_REQUESTED'],
  PROVISIONING_PAYMENTS: ['PLANNING_SITE', 'ACTION_REQUIRED', 'PARTIALLY_FAILED', 'FAILED', 'CANCEL_REQUESTED'],
  PLANNING_SITE: ['GENERATING_SITE', 'PARTIALLY_FAILED', 'FAILED', 'CANCEL_REQUESTED'],
  GENERATING_SITE: ['VALIDATING_SITE', 'PARTIALLY_FAILED', 'FAILED', 'CANCEL_REQUESTED'],
  VALIDATING_SITE: ['CREATING_REVIEW', 'PARTIALLY_FAILED', 'FAILED', 'CANCEL_REQUESTED'],
  CREATING_REVIEW: ['READY', 'PARTIALLY_FAILED', 'FAILED', 'CANCEL_REQUESTED'],
  ACTION_REQUIRED: ['QUEUED', 'CANCEL_REQUESTED', 'CANCELLED'],
  PARTIALLY_FAILED: ['QUEUED', 'CANCEL_REQUESTED', 'CANCELLED'],
  FAILED: ['QUEUED', 'CANCELLED'],
  CANCEL_REQUESTED: ['CANCELLED'],
  READY: [],
  CANCELLED: [],
};

export function canTransitionProvisioning(from: ProvisioningRunStatus, to: ProvisioningRunStatus) {
  return transitions[from].includes(to);
}

export function assertProvisioningTransition(from: ProvisioningRunStatus, to: ProvisioningRunStatus) {
  if (!canTransitionProvisioning(from, to)) {
    throw new ProvisioningPolicyError('INVALID_PROVISIONING_TRANSITION', `Provisioning cannot move from ${from} to ${to}.`);
  }
}

export function provisioningIsTerminal(status: ProvisioningRunStatus) {
  return status === 'READY' || status === 'CANCELLED';
}
