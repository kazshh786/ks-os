import type {
  ApprovalLevelSchema,
  ReviewReadiness,
  ReviewReadinessBlockingCode,
} from './contracts.js';
import type { z } from 'zod';
import { SiteReviewPolicyError } from './lifecycle.js';

export type ApprovalLevel = z.infer<typeof ApprovalLevelSchema>;
export type MaterialChangeKind =
  | 'SECTION_CONTENT'
  | 'PAGE_METADATA'
  | 'NAVIGATION'
  | 'BOOKING_ACTION'
  | 'VERIFIED_FACT'
  | 'ASSET_REFERENCE'
  | 'OPERATIONAL_ONLY';

export interface ApprovalScope {
  level: ApprovalLevel;
  pageReference?: string;
  itemReference?: string;
}

export function invalidatedApprovalScopes(input: {
  changeKind: MaterialChangeKind;
  pageReference?: string;
  itemReference?: string;
}): ApprovalScope[] {
  const fullSite: ApprovalScope[] = [
    { level: 'FULL_SITE' },
    { level: 'CLIENT_FINAL' },
    { level: 'AGENCY_FINAL' },
  ];
  switch (input.changeKind) {
    case 'SECTION_CONTENT':
      return [
        ...(input.itemReference ? [{ level: 'ITEM' as const, itemReference: input.itemReference }] : []),
        ...(input.pageReference ? [{ level: 'PAGE' as const, pageReference: input.pageReference }] : []),
        ...fullSite,
      ];
    case 'PAGE_METADATA':
    case 'BOOKING_ACTION':
    case 'ASSET_REFERENCE':
      return [
        ...(input.pageReference ? [{ level: 'PAGE' as const, pageReference: input.pageReference }] : []),
        ...fullSite,
      ];
    case 'NAVIGATION':
      return fullSite;
    case 'VERIFIED_FACT':
      return [
        ...(input.itemReference ? [{ level: 'ITEM' as const, itemReference: input.itemReference }] : []),
        ...(input.pageReference ? [{ level: 'PAGE' as const, pageReference: input.pageReference }] : []),
        ...fullSite,
      ];
    case 'OPERATIONAL_ONLY':
      return [];
  }
}

export interface ReadinessSignals {
  versionComplete: boolean;
  versionSuperseded: boolean;
  generationFailed: boolean;
  openBlockingFindingCount: number;
  prohibitedClaimCount: number;
  invalidBookingActionCount: number;
  externalBookingActionCount: number;
  missingRequiredPageCount: number;
  missingRequiredSectionCount: number;
  disputedRequiredFactCount: number;
  unverifiedRequiredFactCount: number;
  openRequiredChangeRequestCount: number;
  staleApprovalCount: number;
  clientApproverPresent: boolean;
  agencyApproverPresent: boolean;
  previewAvailable: boolean;
  crossTenantReferenceCount: number;
  openCommentCount: number;
  openChangeRequestCount: number;
  disputedFactCount: number;
  unresolvedFindingCount: number;
  contentDigest: string;
  clientApprovalRequired?: boolean;
  agencyApprovalRequired?: boolean;
}

export function evaluateReviewReadiness(signals: ReadinessSignals): ReviewReadiness {
  const blockingReasons: ReviewReadinessBlockingCode[] = [];
  if (!signals.versionComplete) blockingReasons.push('VERSION_INCOMPLETE');
  if (signals.versionSuperseded) blockingReasons.push('VERSION_SUPERSEDED');
  if (signals.generationFailed) blockingReasons.push('GENERATION_FAILED');
  if (signals.openBlockingFindingCount > 0) blockingReasons.push('OPEN_BLOCKING_FINDING');
  if (signals.prohibitedClaimCount > 0) blockingReasons.push('PROHIBITED_CLAIM');
  if (signals.invalidBookingActionCount > 0) blockingReasons.push('INVALID_BOOKING_ACTION');
  if (signals.externalBookingActionCount > 0) blockingReasons.push('EXTERNAL_BOOKING_ACTION');
  if (signals.missingRequiredPageCount > 0) blockingReasons.push('MISSING_REQUIRED_PAGE');
  if (signals.missingRequiredSectionCount > 0) blockingReasons.push('MISSING_REQUIRED_SECTION');
  if (signals.disputedRequiredFactCount > 0) blockingReasons.push('DISPUTED_REQUIRED_FACT');
  if (signals.unverifiedRequiredFactCount > 0) blockingReasons.push('UNVERIFIED_REQUIRED_FACT');
  if (signals.openRequiredChangeRequestCount > 0) blockingReasons.push('OPEN_REQUIRED_CHANGE_REQUEST');
  if (signals.staleApprovalCount > 0) blockingReasons.push('STALE_APPROVAL');
  if ((signals.clientApprovalRequired ?? true) && !signals.clientApproverPresent) {
    blockingReasons.push('MISSING_CLIENT_APPROVER');
  }
  if ((signals.agencyApprovalRequired ?? true) && !signals.agencyApproverPresent) {
    blockingReasons.push('MISSING_AGENCY_APPROVER');
  }
  if (!signals.previewAvailable) blockingReasons.push('PREVIEW_UNAVAILABLE');
  if (signals.crossTenantReferenceCount > 0) blockingReasons.push('CROSS_TENANT_REFERENCE');

  return {
    ready: blockingReasons.length === 0,
    blockingReasons,
    warningReasons: signals.openCommentCount > 0 ? ['OPEN_COMMENTS'] : [],
    openBlockingItemCount:
      signals.openBlockingFindingCount
      + signals.prohibitedClaimCount
      + signals.invalidBookingActionCount
      + signals.externalBookingActionCount
      + signals.missingRequiredPageCount
      + signals.missingRequiredSectionCount
      + signals.disputedRequiredFactCount
      + signals.unverifiedRequiredFactCount
      + signals.openRequiredChangeRequestCount
      + signals.staleApprovalCount
      + signals.crossTenantReferenceCount
      + (((signals.clientApprovalRequired ?? true) && !signals.clientApproverPresent) ? 1 : 0)
      + (((signals.agencyApprovalRequired ?? true) && !signals.agencyApproverPresent) ? 1 : 0)
      + (signals.previewAvailable ? 0 : 1)
      + (signals.versionComplete ? 0 : 1)
      + (signals.versionSuperseded ? 1 : 0)
      + (signals.generationFailed ? 1 : 0),
    openCommentCount: signals.openCommentCount,
    openChangeRequestCount: signals.openChangeRequestCount,
    disputedFactCount: signals.disputedFactCount,
    unresolvedFindingCount: signals.unresolvedFindingCount,
    invalidBookingActionCount: signals.invalidBookingActionCount,
    staleApprovalCount: signals.staleApprovalCount,
    participantStatus: {
      clientApproverPresent: signals.clientApproverPresent,
      agencyApproverPresent: signals.agencyApproverPresent,
    },
    versionCompleteness: signals.versionSuperseded
      ? 'SUPERSEDED'
      : signals.versionComplete ? 'COMPLETE' : 'INCOMPLETE',
    contentDigest: signals.contentDigest,
  };
}

export function assertReadyForApproval(readiness: ReviewReadiness): void {
  if (!readiness.ready) {
    throw new SiteReviewPolicyError(
      'SITE_REVIEW_NOT_READY',
      `Review is blocked: ${readiness.blockingReasons.join(', ')}.`,
    );
  }
}
