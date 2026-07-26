import type { SitePageType } from '@ks-os/contracts';

export const BLUEPRINT_SCORE_WEIGHTS = {
  REQUIRED_BASELINE: 1_000,
  CORE_BOOKING_JOURNEY: 300,
  REAL_ACTIVE_SUBJECT: 250,
  BOOKING_ELIGIBLE: 180,
  AGENCY_PRIORITY: 140,
  COMPLETE_COMMERCIAL_DATA: 90,
  COMPATIBLE_LAYOUT: 80,
  NAVIGATION_ROLE: 60,
  OBJECTION_HANDLING: 50,
  DUPLICATION_RISK: -500,
  MISSING_REQUIRED_DATA: -1_000,
  MISSING_LAYOUT: -1_000,
  THIN_CONTENT_RISK: -200,
} as const;

export interface BlueprintScore {
  score: number;
  reasons: string[];
}

export function scorePageOpportunity(input: {
  pageType: SitePageType;
  requiredBaseline?: boolean;
  realActiveSubject?: boolean;
  bookingEligible?: boolean;
  agencyPriority?: boolean;
  completeCommercialData?: boolean;
  compatibleLayout?: boolean;
  fillsNavigationRole?: boolean;
  handlesObjection?: boolean;
  duplicationRisk?: boolean;
  missingRequiredData?: boolean;
  thinContentRisk?: boolean;
}): BlueprintScore {
  const reasons: string[] = [];
  let score = 0;
  const add = (condition: boolean | undefined, reason: keyof typeof BLUEPRINT_SCORE_WEIGHTS) => {
    if (!condition) return;
    score += BLUEPRINT_SCORE_WEIGHTS[reason];
    reasons.push(reason);
  };
  add(input.requiredBaseline, 'REQUIRED_BASELINE');
  add(
    ['HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'BOOKING'].includes(input.pageType),
    'CORE_BOOKING_JOURNEY',
  );
  add(input.realActiveSubject, 'REAL_ACTIVE_SUBJECT');
  add(input.bookingEligible, 'BOOKING_ELIGIBLE');
  add(input.agencyPriority, 'AGENCY_PRIORITY');
  add(input.completeCommercialData, 'COMPLETE_COMMERCIAL_DATA');
  add(input.compatibleLayout, 'COMPATIBLE_LAYOUT');
  add(input.fillsNavigationRole, 'NAVIGATION_ROLE');
  add(input.handlesObjection, 'OBJECTION_HANDLING');
  add(input.duplicationRisk, 'DUPLICATION_RISK');
  add(input.missingRequiredData, 'MISSING_REQUIRED_DATA');
  add(input.compatibleLayout === false, 'MISSING_LAYOUT');
  add(input.thinContentRisk, 'THIN_CONTENT_RISK');
  return { score, reasons };
}
