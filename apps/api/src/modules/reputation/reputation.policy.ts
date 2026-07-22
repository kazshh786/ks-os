import type { ReviewInvitationChannel, ReviewProviderMode } from '@ks-os/contracts';

export type ReviewEligibilityInput = {
  status: string;
  tenantActive: boolean;
  hasClient: boolean;
  isTest: boolean;
  isInternal: boolean;
  explicitlyExcluded: boolean;
  channel: ReviewInvitationChannel;
  hasEmail: boolean;
  hasSms: boolean;
  smsMarketingStatus?: string | null;
  smsTransactionalStatus?: string | null;
  hasCustomerPortal: boolean;
};

export function evaluateReviewEligibility(input: ReviewEligibilityInput) {
  if (input.status !== 'COMPLETED') return { eligible: false, reason: 'APPOINTMENT_NOT_COMPLETED' } as const;
  if (!input.tenantActive) return { eligible: false, reason: 'TENANT_INACTIVE' } as const;
  if (!input.hasClient) return { eligible: false, reason: 'CLIENT_NOT_FOUND' } as const;
  if (input.isTest) return { eligible: false, reason: 'TEST_APPOINTMENT' } as const;
  if (input.isInternal) return { eligible: false, reason: 'INTERNAL_APPOINTMENT' } as const;
  if (input.explicitlyExcluded) return { eligible: false, reason: 'NEUTRAL_OPERATIONAL_EXCLUSION' } as const;
  if (input.channel === 'EMAIL' && !input.hasEmail) return { eligible: false, reason: 'EMAIL_UNAVAILABLE' } as const;
  if (input.channel === 'SMS' && (!input.hasSms || input.smsMarketingStatus !== 'OPTED_IN' || ['OPTED_OUT', 'SUPPRESSED'].includes(input.smsTransactionalStatus ?? ''))) {
    return { eligible: false, reason: 'SMS_NOT_OPTED_IN' } as const;
  }
  if (input.channel === 'CUSTOMER_PORTAL' && !input.hasCustomerPortal) return { eligible: false, reason: 'CUSTOMER_PORTAL_UNAVAILABLE' } as const;
  return { eligible: true, reason: null } as const;
}

export function providersForMode(mode: ReviewProviderMode): readonly ('GOOGLE' | 'TRUSTPILOT')[] {
  return mode === 'BOTH' ? ['GOOGLE', 'TRUSTPILOT'] : [mode];
}

export function reviewInvitationIdempotencyKey(tenantId: string, appointmentId: string, providerMode: ReviewProviderMode, ruleVersion: number) {
  return [tenantId, appointmentId, providerMode, 'v' + ruleVersion].join(':');
}

export function selectScopedConfiguration<T extends { locationId: string | null }>(rows: T[], appointmentLocationId: string | null) {
  if (appointmentLocationId) {
    const exact = rows.find((row) => row.locationId === appointmentLocationId);
    if (exact) return exact;
  }
  return rows.find((row) => row.locationId === null) ?? null;
}

