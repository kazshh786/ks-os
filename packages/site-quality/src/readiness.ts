import type {
  PublicationBlockingCode,
  SiteQualityCategory,
  SiteQualityGateStatus,
} from './contracts.js';
import { isNonWaivableFinding } from './security.js';

export interface PublicationReadinessFinding {
  code: string;
  category: SiteQualityCategory;
  publicationEffect: 'BLOCK' | 'WARNING' | 'RECOMMENDATION';
  waivable: boolean;
  status:
    | 'OPEN'
    | 'ACKNOWLEDGED'
    | 'IN_REMEDIATION'
    | 'RESOLVED'
    | 'WAIVED'
    | 'NOT_APPLICABLE'
    | 'SUPERSEDED';
}

export interface PublicationReadinessInput {
  qualityRunReference?: string;
  qualityRunStatus?: string;
  qualityRunGateStatus?: SiteQualityGateStatus;
  runSiteVersionDigestSha256?: string;
  currentSiteVersionDigestSha256: string;
  siteVersionComplete: boolean;
  siteVersionSuperseded: boolean;
  runStale: boolean;
  agencyApprovalCurrent: boolean;
  clientApprovalRequired: boolean;
  clientApprovalCurrent: boolean;
  approvalFreshness: 'CURRENT' | 'STALE' | 'MISSING';
  qualityPolicyVersion: string;
  knowledgePackVersion: string;
  findings: readonly PublicationReadinessFinding[];
  staleWaiverCount: number;
  unresolvedReviewCount: number;
  unresolvedFactCount: number;
  humanReviewIncompleteCount: number;
  evaluatedAt?: Date;
}

export interface PublicationReadinessResult {
  ready: boolean;
  status: 'BLOCKED' | 'READY_WITH_WARNINGS' | 'READY';
  qualityRunReference: string | null;
  siteVersionDigest: string;
  agencyApprovalStatus: 'CURRENT' | 'MISSING';
  clientApprovalStatus: 'CURRENT' | 'MISSING' | 'NOT_REQUIRED';
  approvalFreshness: 'CURRENT' | 'STALE' | 'MISSING';
  qualityPolicyVersion: string;
  knowledgePackVersion: string;
  openBlockingCount: number;
  openWarningCount: number;
  nonWaivableCount: number;
  waivedCount: number;
  staleWaiverCount: number;
  unresolvedReviewCount: number;
  unresolvedFactCount: number;
  bookingIntegrityStatus: 'BLOCKED' | 'WARNING' | 'READY';
  accessibilityStatus: 'BLOCKED' | 'WARNING' | 'READY';
  seoStatus: 'BLOCKED' | 'WARNING' | 'READY';
  performanceStatus: 'BLOCKED' | 'WARNING' | 'READY';
  contentIntegrityStatus: 'BLOCKED' | 'WARNING' | 'READY';
  assetReadinessStatus: 'BLOCKED' | 'WARNING' | 'READY';
  blockingReasons: Array<{ code: PublicationBlockingCode; message: string }>;
  warnings: string[];
  evaluatedAt: Date;
}

const currentFindingStatuses = new Set([
  'OPEN',
  'ACKNOWLEDGED',
  'IN_REMEDIATION',
]);

const codeMap: Record<string, PublicationBlockingCode> = {
  SITE_VERSION_INCOMPLETE: 'SITE_VERSION_INCOMPLETE',
  SITE_VERSION_SUPERSEDED: 'SITE_VERSION_SUPERSEDED',
  STALE_APPROVAL: 'APPROVAL_STALE',
  MISSING_AGENCY_APPROVAL: 'REVIEW_NOT_APPROVED',
  CLIENT_APPROVAL_REQUIRED: 'CLIENT_APPROVAL_REQUIRED',
  INVALID_NATIVE_BOOKING: 'INVALID_NATIVE_BOOKING',
  UNUSABLE_BOOKING_FLOW: 'INVALID_NATIVE_BOOKING',
  EXTERNAL_BOOKING_DESTINATION: 'EXTERNAL_BOOKING_DESTINATION',
  CROSS_TENANT_REFERENCE: 'CROSS_TENANT_REFERENCE',
  BOOKING_REFERENCE_CROSS_TENANT: 'CROSS_TENANT_REFERENCE',
  UNRESOLVED_PROHIBITED_CLAIM: 'PROHIBITED_CLAIM',
  PROHIBITED_MEDICAL_CLAIM: 'PROHIBITED_CLAIM',
  MISSING_REQUIRED_PAGE: 'MISSING_REQUIRED_PAGE',
  MISSING_REQUIRED_SECTION: 'MISSING_REQUIRED_SECTION',
  CRITICAL_ACCESSIBILITY_FAILURE: 'CRITICAL_ACCESSIBILITY_FAILURE',
  CRITICAL_KEYBOARD_FAILURE: 'CRITICAL_ACCESSIBILITY_FAILURE',
  PRIMARY_JOURNEY_FOCUS_TRAP: 'CRITICAL_ACCESSIBILITY_FAILURE',
  RENDER_FAILURE: 'RENDER_FAILURE',
  CRITICAL_RESOURCE_FAILURE: 'RENDER_FAILURE',
  UNAPPROVED_PUBLIC_ASSET: 'UNAPPROVED_PUBLIC_ASSET',
  INVALID_TEMPLATE_LICENCE: 'INVALID_TEMPLATE_LICENCE',
};

function categoryStatus(
  findings: readonly PublicationReadinessFinding[],
  categories: readonly SiteQualityCategory[],
): 'BLOCKED' | 'WARNING' | 'READY' {
  const selected = findings.filter((finding) =>
    categories.includes(finding.category)
    && (
      currentFindingStatuses.has(finding.status)
      || finding.status === 'WAIVED'
    ));
  if (selected.some((finding) =>
    finding.publicationEffect === 'BLOCK' && finding.status !== 'WAIVED')) {
    return 'BLOCKED';
  }
  if (selected.some((finding) =>
    finding.publicationEffect === 'WARNING'
    || finding.status === 'WAIVED')) {
    return 'WARNING';
  }
  return 'READY';
}

export function evaluatePublicationReadiness(
  input: PublicationReadinessInput,
): PublicationReadinessResult {
  const reasons: PublicationReadinessResult['blockingReasons'] = [];
  const add = (code: PublicationBlockingCode, message: string) => {
    if (!reasons.some((reason) => reason.code === code)) {
      reasons.push({ code, message });
    }
  };
  if (!input.qualityRunReference || input.qualityRunStatus !== 'READY') {
    add('NO_COMPLETED_QUALITY_RUN', 'No completed quality run exists for this version.');
  }
  if (input.runStale || input.qualityRunGateStatus === 'STALE') {
    add('QUALITY_RUN_STALE', 'The latest quality run is stale.');
  }
  if (!input.siteVersionComplete) {
    add('SITE_VERSION_INCOMPLETE', 'The target site version is incomplete.');
  }
  if (input.siteVersionSuperseded) {
    add('SITE_VERSION_SUPERSEDED', 'The target site version is superseded.');
  }
  if (
    input.runSiteVersionDigestSha256
    && input.runSiteVersionDigestSha256 !== input.currentSiteVersionDigestSha256
  ) {
    add('SITE_DIGEST_CHANGED', 'The site-version digest changed after the run.');
  }
  if (!input.agencyApprovalCurrent) {
    add('REVIEW_NOT_APPROVED', 'Current final agency approval is missing.');
  }
  if (input.approvalFreshness !== 'CURRENT') {
    add('APPROVAL_STALE', 'Required approvals are stale or missing.');
  }
  if (input.clientApprovalRequired && !input.clientApprovalCurrent) {
    add('CLIENT_APPROVAL_REQUIRED', 'Current client approval is required.');
  }
  if (input.staleWaiverCount > 0) {
    add('STALE_WAIVER', 'A stale waiver cannot satisfy publication readiness.');
  }
  if (
    input.unresolvedReviewCount > 0
    || input.unresolvedFactCount > 0
    || input.humanReviewIncompleteCount > 0
  ) {
    add('OTHER', 'Required human review or fact verification is incomplete.');
  }

  const open = input.findings.filter((finding) =>
    currentFindingStatuses.has(finding.status));
  for (const finding of open.filter((candidate) =>
    candidate.publicationEffect === 'BLOCK')) {
    add(
      codeMap[finding.code]
        ?? (isNonWaivableFinding(finding.code)
          ? 'NON_WAIVABLE_FINDING'
          : 'OPEN_BLOCKING_FINDING'),
      `An unresolved blocking finding remains: ${finding.code}.`,
    );
  }

  const openWarningCount = open.filter((finding) =>
    finding.publicationEffect === 'WARNING').length;
  const waivedCount = input.findings.filter((finding) =>
    finding.status === 'WAIVED').length;
  const nonWaivableCount = open.filter((finding) =>
    isNonWaivableFinding(finding.code) || !finding.waivable).length;
  const warnings = [
    ...(openWarningCount > 0
      ? [`${openWarningCount} unresolved warning(s) require agency awareness.`]
      : []),
    ...(waivedCount > 0
      ? [`${waivedCount} current waiver(s) are part of this decision.`]
      : []),
  ];
  const status = reasons.length > 0
    ? 'BLOCKED'
    : warnings.length > 0
      ? 'READY_WITH_WARNINGS'
      : 'READY';
  return {
    ready: status !== 'BLOCKED',
    status,
    qualityRunReference: input.qualityRunReference ?? null,
    siteVersionDigest: input.currentSiteVersionDigestSha256,
    agencyApprovalStatus: input.agencyApprovalCurrent ? 'CURRENT' : 'MISSING',
    clientApprovalStatus: input.clientApprovalRequired
      ? input.clientApprovalCurrent ? 'CURRENT' : 'MISSING'
      : 'NOT_REQUIRED',
    approvalFreshness: input.approvalFreshness,
    qualityPolicyVersion: input.qualityPolicyVersion,
    knowledgePackVersion: input.knowledgePackVersion,
    openBlockingCount: open.filter((finding) =>
      finding.publicationEffect === 'BLOCK').length,
    openWarningCount,
    nonWaivableCount,
    waivedCount,
    staleWaiverCount: input.staleWaiverCount,
    unresolvedReviewCount: input.unresolvedReviewCount,
    unresolvedFactCount: input.unresolvedFactCount,
    bookingIntegrityStatus: categoryStatus(input.findings, ['BOOKING_INTEGRITY', 'CONVERSION']),
    accessibilityStatus: categoryStatus(input.findings, ['ACCESSIBILITY']),
    seoStatus: categoryStatus(input.findings, [
      'TECHNICAL_SEO',
      'ON_PAGE_SEO',
      'LOCAL_SEO',
      'STRUCTURED_DATA',
      'INTERNAL_LINKING',
    ]),
    performanceStatus: categoryStatus(input.findings, ['PERFORMANCE']),
    contentIntegrityStatus: categoryStatus(input.findings, [
      'CONTENT_INTEGRITY',
      'TRUST_AND_FACTUAL_INTEGRITY',
    ]),
    assetReadinessStatus: categoryStatus(input.findings, ['ASSET_READINESS']),
    blockingReasons: reasons,
    warnings,
    evaluatedAt: input.evaluatedAt ?? new Date(),
  };
}
