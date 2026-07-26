export interface ProvisioningReadinessSignals {
  productionBriefLocked: boolean;
  productionBriefReady: boolean;
  planResolved: boolean;
  entitlementPageLimit: number;
  requestedMarketingPageCount: number;
  approvedTemplate: boolean;
  templateLicensed: boolean;
  locationCount: number;
  approvedRemoteServiceConfiguration: boolean;
  bookableServiceCount: number;
  eligibleStaffCount: number;
  staffRequired: boolean;
  validAvailability: boolean;
  bookingConfigurationPresent: boolean;
  nativeBookingOnly: boolean;
  validBookingPath: boolean;
  requiredFormsPresent: boolean;
  paymentStatus: 'NOT_STARTED' | 'ACTION_REQUIRED' | 'ONBOARDING_STARTED' | 'READY' | 'RESTRICTED' | 'DISABLED';
  payLaterAllowed: boolean;
}

export function evaluateProvisioningReadiness(signals: ProvisioningReadinessSignals) {
  const blockingIssues: Array<{ code: string; area: string; message: string }> = [];
  const warnings: Array<{ code: string; area: string; message: string }> = [];
  const block = (condition: boolean, code: string, area: string, message: string) => {
    if (condition) blockingIssues.push({ code, area, message });
  };
  block(!signals.productionBriefLocked, 'PRODUCTION_BRIEF_NOT_LOCKED', 'WORKSPACE', 'Approve and lock the production brief before provisioning.');
  block(!signals.productionBriefReady, 'PRODUCTION_BRIEF_NOT_READY', 'WORKSPACE', 'The production brief has unresolved blocking issues.');
  block(!signals.planResolved, 'PLAN_NOT_RESOLVED', 'WORKSPACE', 'An active server-resolved plan is required.');
  block(signals.requestedMarketingPageCount > signals.entitlementPageLimit, 'PAGE_ENTITLEMENT_EXCEEDED', 'WEBSITE', 'The marketing page plan exceeds the selected entitlement.');
  block(!signals.approvedTemplate, 'TEMPLATE_NOT_APPROVED', 'WEBSITE', 'The selected template version is not approved.');
  block(!signals.templateLicensed, 'TEMPLATE_LICENCE_INVALID', 'WEBSITE', 'The selected template is not licensed for this workspace.');
  block(signals.locationCount < 1 && !signals.approvedRemoteServiceConfiguration, 'NO_VALID_LOCATION', 'BOOKING', 'A location or approved remote-service configuration is required.');
  block(signals.bookableServiceCount < 1, 'NO_BOOKABLE_SERVICE', 'BOOKING', 'At least one active bookable service is required.');
  block(signals.staffRequired && signals.eligibleStaffCount < 1, 'NO_ELIGIBLE_STAFF', 'BOOKING', 'At least one eligible staff member is required.');
  block(!signals.validAvailability, 'NO_VALID_AVAILABILITY', 'BOOKING', 'Representative booking availability could not be resolved.');
  block(!signals.bookingConfigurationPresent, 'BOOKING_CONFIGURATION_MISSING', 'BOOKING', 'Native booking configuration is required.');
  block(!signals.nativeBookingOnly, 'EXTERNAL_BOOKING_FORBIDDEN', 'BOOKING', 'All booking actions must use KS_OS_BOOKING.');
  block(!signals.validBookingPath, 'BOOKING_PATH_INVALID', 'BOOKING', 'A server-resolved native booking path is required.');
  block(!signals.requiredFormsPresent, 'REQUIRED_FORM_MISSING', 'BOOKING', 'A required form is missing.');
  block(['RESTRICTED', 'DISABLED'].includes(signals.paymentStatus) && !signals.payLaterAllowed, 'PAYMENT_NOT_READY', 'PAYMENTS', 'Payments are unavailable and pay-later is not enabled.');
  if (signals.paymentStatus !== 'READY' && signals.payLaterAllowed) warnings.push({ code: 'PAYMENT_ACTION_REQUIRED', area: 'PAYMENTS', message: 'Workspace provisioning can continue with pay-later while payment onboarding remains outstanding.' });
  return { ready: blockingIssues.length === 0, blockingIssues, warnings };
}

export function combinedReadiness(input: {
  workspaceReady: boolean;
  bookingReady: boolean;
  websiteReady: boolean;
  reviewReady: boolean;
  paymentStatus: string;
  blockingIssues: Array<{ code: string; area: 'WORKSPACE' | 'BOOKING' | 'WEBSITE' | 'REVIEW' | 'PAYMENTS'; message: string }>;
  warnings: Array<{ code: string; area: 'WORKSPACE' | 'BOOKING' | 'WEBSITE' | 'REVIEW' | 'PAYMENTS'; message: string }>;
}) {
  return {
    workspace: input.workspaceReady ? 'READY' : 'BLOCKING',
    booking: input.bookingReady ? 'READY' : 'BLOCKING',
    website: input.websiteReady ? 'READY' : 'ACTION_REQUIRED',
    review: input.reviewReady ? 'READY' : 'NOT_STARTED',
    payments: input.paymentStatus === 'READY' ? 'READY' : 'ACTION_REQUIRED',
    publication: 'NOT_AVAILABLE_UNTIL_PHASE_15_9' as const,
    blockingIssues: input.blockingIssues,
    warnings: input.warnings,
    ready: input.workspaceReady && input.bookingReady && input.websiteReady && input.reviewReady,
  };
}
