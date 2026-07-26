import { createHash } from 'node:crypto';

export const BRIEF_BLOCKING_CODES = [
  'MISSING_LEGAL_BUSINESS_NAME', 'MISSING_TRADING_NAME', 'MISSING_PUBLIC_CONTACT',
  'NO_VALID_LOCATION', 'NO_VALID_REMOTE_SERVICE_CONFIGURATION', 'NO_BOOKABLE_SERVICE',
  'INVALID_SERVICE_DURATION', 'INVALID_SERVICE_PRICE', 'NO_ELIGIBLE_STAFF',
  'NO_VALID_AVAILABILITY', 'MISSING_BOOKING_POLICY', 'MISSING_REQUIRED_FORM',
  'UNVERIFIED_CREDENTIAL', 'UNVERIFIED_TESTIMONIAL', 'UNVERIFIED_RESULT',
  'MISSING_BRAND_DIRECTION', 'MISSING_REQUIRED_ASSET', 'UNRESOLVED_CLARIFICATION',
  'UNAPPROVED_PUBLIC_FACT', 'UNSAFE_UPLOAD', 'OTHER',
] as const;
export type BriefBlockingCode = typeof BRIEF_BLOCKING_CODES[number];

export interface ProductionBriefReadinessSignals {
  legalBusinessName: boolean;
  tradingName: boolean;
  publicContact: boolean;
  validLocation: boolean;
  validRemoteServiceConfiguration: boolean;
  bookableServiceCount: number;
  invalidServiceDurationCount: number;
  invalidServicePriceCount: number;
  staffRequired: boolean;
  eligibleStaffCount: number;
  validAvailability: boolean;
  bookingPolicyPresent: boolean;
  requiredFormsPresent: boolean;
  unverifiedCredentialCount: number;
  unverifiedTestimonialCount: number;
  unverifiedResultCount: number;
  brandDirectionPresent: boolean;
  requiredAssetMissingCount: number;
  optionalAssetMissingCount: number;
  unresolvedClarificationCount: number;
  unapprovedPublicFactCount: number;
  unsafeUploadCount: number;
  approvedFactCount: number;
  unverifiedFactCount: number;
  answeredQuestionCount: number;
  visibleQuestionCount: number;
}

export function evaluateProductionBriefReadiness(signals: ProductionBriefReadinessSignals) {
  const blockingIssues: BriefBlockingCode[] = [];
  const add = (condition: boolean, code: BriefBlockingCode) => { if (condition) blockingIssues.push(code); };
  add(!signals.legalBusinessName, 'MISSING_LEGAL_BUSINESS_NAME');
  add(!signals.tradingName, 'MISSING_TRADING_NAME');
  add(!signals.publicContact, 'MISSING_PUBLIC_CONTACT');
  add(!signals.validLocation && !signals.validRemoteServiceConfiguration, 'NO_VALID_LOCATION');
  add(signals.bookableServiceCount < 1, 'NO_BOOKABLE_SERVICE');
  add(signals.invalidServiceDurationCount > 0, 'INVALID_SERVICE_DURATION');
  add(signals.invalidServicePriceCount > 0, 'INVALID_SERVICE_PRICE');
  add(signals.staffRequired && signals.eligibleStaffCount < 1, 'NO_ELIGIBLE_STAFF');
  add(!signals.validAvailability, 'NO_VALID_AVAILABILITY');
  add(!signals.bookingPolicyPresent, 'MISSING_BOOKING_POLICY');
  add(!signals.requiredFormsPresent, 'MISSING_REQUIRED_FORM');
  add(signals.unverifiedCredentialCount > 0, 'UNVERIFIED_CREDENTIAL');
  add(signals.unverifiedTestimonialCount > 0, 'UNVERIFIED_TESTIMONIAL');
  add(signals.unverifiedResultCount > 0, 'UNVERIFIED_RESULT');
  add(!signals.brandDirectionPresent, 'MISSING_BRAND_DIRECTION');
  add(signals.requiredAssetMissingCount > 0, 'MISSING_REQUIRED_ASSET');
  add(signals.unresolvedClarificationCount > 0, 'UNRESOLVED_CLARIFICATION');
  add(signals.unapprovedPublicFactCount > 0, 'UNAPPROVED_PUBLIC_FACT');
  add(signals.unsafeUploadCount > 0, 'UNSAFE_UPLOAD');
  const warnings = signals.optionalAssetMissingCount > 0 ? ['OPTIONAL_ASSET_MISSING'] : [];
  const digest = createHash('sha256').update(JSON.stringify({ signals, blockingIssues, warnings })).digest('hex');
  return {
    readyForProvisioning: blockingIssues.length === 0,
    blockingIssues,
    warnings,
    completionPercentage: signals.visibleQuestionCount === 0
      ? 100
      : Math.round((signals.answeredQuestionCount / signals.visibleQuestionCount) * 100),
    approvedFactCount: signals.approvedFactCount,
    unverifiedFactCount: signals.unverifiedFactCount,
    missingAssetCount: signals.requiredAssetMissingCount + signals.optionalAssetMissingCount,
    clarificationCount: signals.unresolvedClarificationCount,
    productionBriefDigest: digest,
  };
}
