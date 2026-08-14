import { createHash } from 'node:crypto';
import {
  PublishedSiteSnapshotSchema,
  type PublishedSiteSnapshot,
} from '@ks-os/site-schema';
import {
  BrowserAuditPageResultSchema,
  type BrowserAuditPageResult,
  type SiteQualityCategory,
  type SiteQualityFindingInput,
} from './contracts.js';
import { DEFAULT_SITE_QUALITY_POLICY, qualityCheckById } from './policy.js';
import { isNonWaivableFinding } from './security.js';

const digest = (value: unknown) => createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex');

function finding(
  input: Omit<SiteQualityFindingInput, 'waivable' | 'status'> & {
    waivable?: boolean;
  },
): SiteQualityFindingInput {
  const definition = qualityCheckById(input.checkId);
  const waivable = Boolean(
    input.waivable
    ?? (definition?.waivable && !isNonWaivableFinding(input.code)),
  );
  return {
    ...input,
    waivable,
    status: 'OPEN',
  };
}

function objectValues(value: unknown, path = '$'): Array<{
  path: string;
  value: unknown;
}> {
  const output = [{ path, value }];
  if (Array.isArray(value)) {
    value.forEach((child, index) => output.push(
      ...objectValues(child, `${path}[${index}]`),
    ));
  } else if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) =>
      output.push(...objectValues(child, `${path}.${key}`)));
  }
  return output;
}

function bookingActions(snapshot: PublishedSiteSnapshot) {
  return objectValues(snapshot.pages)
    .map((entry) => ({ ...entry, object: entry.value as Record<string, unknown> }))
    .filter((entry) =>
      entry.value
      && typeof entry.value === 'object'
      && !Array.isArray(entry.value)
      && (
        entry.object.type === 'KS_OS_BOOKING'
        || entry.object.type === 'EXTERNAL_BOOKING'
        || entry.object.type === 'EXTERNAL_URL'
      ));
}

export interface DeterministicQualityInput {
  snapshot: unknown;
  expectedTenantReference: string;
  expectedSiteReference: string;
  expectedVersionReference: string;
  siteVersionStatus: string;
  siteVersionDigestSha256: string;
  activeKnowledgePackCount: number;
  activeKnowledgePackReference?: string;
  activeKnowledgePackDigestSha256?: string;
  unresolvedProhibitedClaimCount: number;
  staleApprovalCount: number;
  agencyApprovalCurrent: boolean;
  clientApprovalRequired: boolean;
  clientApprovalCurrent: boolean;
  requiredPageTypes?: readonly string[];
  requiredSectionTypes?: readonly string[];
  templateLicenceValid: boolean;
}

export interface DeterministicQualityResult {
  validSnapshot: boolean;
  findings: SiteQualityFindingInput[];
  checkResults: ReadonlyMap<string, 'PASS' | 'FAIL' | 'DATA_REQUIRED'>;
  snapshotDigestSha256: string;
}

export function runDeterministicQualityChecks(
  input: DeterministicQualityInput,
): DeterministicQualityResult {
  const findings: SiteQualityFindingInput[] = [];
  const checkResults = new Map<string, 'PASS' | 'FAIL' | 'DATA_REQUIRED'>();
  const parsed = PublishedSiteSnapshotSchema.safeParse(input.snapshot);
  const contentDigest = input.siteVersionDigestSha256;

  if (!parsed.success) {
    findings.push(finding({
      checkId: 'KSQ_PLATFORM_SNAPSHOT_VALID',
      category: 'PUBLICATION_READINESS',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'INVALID_SNAPSHOT_STRUCTURE',
      message: 'The exact site version does not satisfy the public snapshot contract.',
      evidenceSummary: `${parsed.error.issues.length} bounded schema issue(s) were detected.`,
      remediationGuidance: 'Regenerate or repair the structured version through the controlled workflow.',
      ruleIds: ['PLATFORM_SNAPSHOT_STRUCTURE'],
      contentDigestSha256: contentDigest,
    }));
    checkResults.set('KSQ_PLATFORM_SNAPSHOT_VALID', 'FAIL');
    return {
      validSnapshot: false,
      findings,
      checkResults,
      snapshotDigestSha256: digest(input.snapshot),
    };
  }

  const snapshot = parsed.data;
  const snapshotDigestSha256 = digest(snapshot);
  checkResults.set('KSQ_PLATFORM_SNAPSHOT_VALID', 'PASS');

  if (
    snapshot.siteReference !== input.expectedSiteReference
    || snapshot.versionReference !== input.expectedVersionReference
    || snapshot.booking.tenantReference !== input.expectedTenantReference
  ) {
    findings.push(finding({
      checkId: 'KSQ_PLATFORM_TENANT_ISOLATION',
      category: 'PUBLICATION_READINESS',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'CROSS_TENANT_REFERENCE',
      message: 'The version, site, or tenant reference is outside the resolved run scope.',
      evidenceSummary: 'Server-side public-reference ownership comparison failed.',
      remediationGuidance: 'Reject this run and investigate the ownership boundary.',
      ruleIds: ['PLATFORM_TENANT_ISOLATION'],
      contentDigestSha256: contentDigest,
    }));
    checkResults.set('KSQ_PLATFORM_TENANT_ISOLATION', 'FAIL');
  } else {
    checkResults.set('KSQ_PLATFORM_TENANT_ISOLATION', 'PASS');
  }

  if (
    !['DRAFT', 'INTERNAL_REVIEW', 'CLIENT_REVIEW', 'APPROVED'].includes(
      input.siteVersionStatus,
    )
  ) {
    const superseded = input.siteVersionStatus === 'SUPERSEDED';
    findings.push(finding({
      checkId: 'KSQ_PLATFORM_VERSION_COMPLETE',
      category: 'PUBLICATION_READINESS',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: superseded ? 'SITE_VERSION_SUPERSEDED' : 'SITE_VERSION_INCOMPLETE',
      message: superseded
        ? 'The requested site version has been superseded.'
        : 'The requested site version is not complete and reviewable.',
      evidenceSummary: `Resolved version status: ${input.siteVersionStatus}.`,
      remediationGuidance: 'Select the current complete version or complete generation.',
      ruleIds: ['PLATFORM_VERSION_LIFECYCLE'],
      contentDigestSha256: contentDigest,
    }));
    checkResults.set('KSQ_PLATFORM_VERSION_COMPLETE', 'FAIL');
  } else {
    checkResults.set('KSQ_PLATFORM_VERSION_COMPLETE', 'PASS');
  }

  if (
    input.activeKnowledgePackCount !== 1
    || !input.activeKnowledgePackReference
    || !input.activeKnowledgePackDigestSha256
  ) {
    findings.push(finding({
      checkId: 'KSQ_PLATFORM_VERSION_COMPLETE',
      category: 'PUBLICATION_READINESS',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'ACTIVE_KNOWLEDGE_PACK_INVALID',
      message: 'Exactly one approved and active PUBLIC_SITE knowledge pack is required.',
      evidenceSummary: `${input.activeKnowledgePackCount} active pack(s) resolved.`,
      remediationGuidance: 'Restore the governed knowledge-pack activation invariant.',
      ruleIds: ['PLATFORM_KNOWLEDGE_PACK_ACTIVE'],
      contentDigestSha256: contentDigest,
    }));
  }

  const requiredPages = input.requiredPageTypes ?? ['HOME', 'CONTACT', 'POLICIES'];
  for (const required of requiredPages) {
    if (!snapshot.pages.some((page) => page.pageType === required && page.active)) {
      findings.push(finding({
        checkId: 'KSQ_PLATFORM_SNAPSHOT_VALID',
        category: 'PUBLICATION_READINESS',
        severity: 'BLOCKING',
        publicationEffect: 'BLOCK',
        code: 'MISSING_REQUIRED_PAGE',
        message: `The required ${required} page is missing.`,
        evidenceSummary: 'The exact-version page manifest does not contain the required active page.',
        remediationGuidance: 'Add the required page through the blueprint and generation workflow.',
        ruleIds: ['PLATFORM_REQUIRED_PAGE'],
        contentDigestSha256: contentDigest,
      }));
    }
  }

  const requiredSections = input.requiredSectionTypes ?? ['HEADER', 'FOOTER'];
  for (const page of snapshot.pages.filter((candidate) =>
    candidate.active && candidate.pageType !== 'BOOKING')) {
    for (const required of requiredSections) {
      if (!page.sections.some((section) => section.type === required)) {
        findings.push(finding({
          checkId: 'KSQ_PLATFORM_SNAPSHOT_VALID',
          category: 'PUBLICATION_READINESS',
          severity: 'BLOCKING',
          publicationEffect: 'BLOCK',
          pageReference: page.publicReference,
          code: 'MISSING_REQUIRED_SECTION',
          message: `A required ${required} section is missing from the page.`,
          evidenceSummary: 'The exact-version section manifest was checked.',
          remediationGuidance: 'Regenerate the page using its approved layout.',
          ruleIds: ['PLATFORM_REQUIRED_SECTION'],
          contentDigestSha256: contentDigest,
        }));
      }
    }
  }

  for (const entry of objectValues(snapshot.pages)) {
    if (
      typeof entry.value === 'string'
      && /<\s*script|javascript:|on(?:click|load|error)\s*=|<\s*(?:iframe|object|embed)\b/i
        .test(entry.value)
    ) {
      findings.push(finding({
        checkId: 'KSQ_CONTENT_NO_EXECUTABLE',
        category: 'CONTENT_INTEGRITY',
        severity: 'BLOCKING',
        publicationEffect: 'BLOCK',
        fieldPath: entry.path.slice(0, 500),
        code: 'MALICIOUS_EXECUTABLE_CONTENT',
        message: 'Executable or unsupported arbitrary content was detected.',
        evidenceSummary: 'Only the bounded structured field path is retained.',
        remediationGuidance: 'Remove the unsafe content and regenerate through controlled components.',
        ruleIds: ['PLATFORM_NO_EXECUTABLE_CONTENT'],
        contentDigestSha256: contentDigest,
      }));
    }
  }

  const serviceReferences = new Set(snapshot.services.map((value) => value.publicReference));
  const locationReferences = new Set(snapshot.locations.map((value) => value.publicReference));
  const staffReferences = new Set(snapshot.staff.map((value) => value.publicReference));
  const actions = bookingActions(snapshot);
  const conversionPageCount = snapshot.pages.filter((page) =>
    page.active && page.pageType !== 'BOOKING').length;
  if (conversionPageCount > 0 && actions.length === 0) {
    findings.push(finding({
      checkId: 'KSQ_BOOKING_NATIVE_ONLY',
      category: 'BOOKING_INTEGRITY',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'INVALID_NATIVE_BOOKING',
      message: 'No valid KS OS native booking action exists in the site version.',
      evidenceSummary: 'The structured action graph contains no native booking action.',
      remediationGuidance: 'Add a KS OS native booking action through structured generation.',
      ruleIds: ['RUL_NATIVE_BOOKING_DESTINATION'],
      contentDigestSha256: contentDigest,
    }));
    findings.push(finding({
      checkId: 'KSQ_CONVERSION_PRIMARY_ACTION',
      category: 'CONVERSION',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'MISSING_PRIMARY_BOOKING_ACTION',
      message: 'No native primary booking action exists in the conversion journey.',
      evidenceSummary: 'The exact structured action graph contains no native booking action.',
      remediationGuidance: 'Add a KS OS native booking action through structured generation.',
      ruleIds: ['RUL_PRIMARY_CONVERSION_ACTION'],
      contentDigestSha256: contentDigest,
    }));
  }
  for (const action of actions) {
    if (action.object.type !== 'KS_OS_BOOKING') {
      findings.push(finding({
        checkId: 'KSQ_BOOKING_NATIVE_ONLY',
        category: 'BOOKING_INTEGRITY',
        severity: 'BLOCKING',
        publicationEffect: 'BLOCK',
        fieldPath: action.path.slice(0, 500),
        code: 'EXTERNAL_BOOKING_DESTINATION',
        message: 'An external booking destination is prohibited.',
        evidenceSummary: 'The structured action discriminator is not KS_OS_BOOKING.',
        remediationGuidance: 'Replace the destination with a controlled KS OS booking action.',
        ruleIds: ['RUL_NATIVE_BOOKING_DESTINATION'],
        contentDigestSha256: contentDigest,
      }));
      continue;
    }
    const invalidReference = (
      typeof action.object.serviceReference === 'string'
      && !serviceReferences.has(action.object.serviceReference)
    ) || (
      typeof action.object.locationReference === 'string'
      && !locationReferences.has(action.object.locationReference)
    ) || (
      typeof action.object.staffReference === 'string'
      && !staffReferences.has(action.object.staffReference)
    );
    if (invalidReference) {
      findings.push(finding({
        checkId: 'KSQ_BOOKING_CANONICAL_REFERENCES',
        category: 'BOOKING_INTEGRITY',
        severity: 'BLOCKING',
        publicationEffect: 'BLOCK',
        fieldPath: action.path.slice(0, 500),
        code: 'BOOKING_REFERENCE_CROSS_TENANT',
        message: 'A booking action does not resolve within the exact tenant snapshot.',
        evidenceSummary: 'Server-side canonical reference resolution failed.',
        remediationGuidance: 'Correct canonical eligibility or regenerate the action.',
        ruleIds: ['RUL_CANONICAL_BOOKING_RECORDS'],
        contentDigestSha256: contentDigest,
      }));
    }
  }
  checkResults.set(
    'KSQ_BOOKING_NATIVE_ONLY',
    findings.some((item) => item.checkId === 'KSQ_BOOKING_NATIVE_ONLY')
      ? 'FAIL'
      : 'PASS',
  );
  checkResults.set(
    'KSQ_BOOKING_CANONICAL_REFERENCES',
    findings.some((item) => item.checkId === 'KSQ_BOOKING_CANONICAL_REFERENCES')
      ? 'FAIL'
      : 'PASS',
  );

  const unapprovedAssets = snapshot.assets.filter((asset) =>
    asset.publicationStatus !== 'PUBLISHED'
    || !asset.url.startsWith('https://')
    || asset.width < 1
    || asset.height < 1
    || (asset.purpose === 'INFORMATIVE' && asset.alt.trim().length === 0));
  if (unapprovedAssets.length > 0) {
    findings.push(finding({
      checkId: 'KSQ_ASSETS_APPROVED',
      category: 'ASSET_READINESS',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'UNAPPROVED_PUBLIC_ASSET',
      message: 'One or more public assets are unsafe, unapproved, or incomplete.',
      evidenceSummary: `${unapprovedAssets.length} affected asset reference(s).`,
      remediationGuidance: 'Approve, replace, or remove the affected asset.',
      ruleIds: ['RUL_PUBLIC_ASSET_READINESS'],
      contentDigestSha256: contentDigest,
    }));
    checkResults.set('KSQ_ASSETS_APPROVED', 'FAIL');
  } else {
    checkResults.set('KSQ_ASSETS_APPROVED', 'PASS');
  }

  if (input.unresolvedProhibitedClaimCount > 0) {
    findings.push(finding({
      checkId: 'KSQ_CONTENT_CLAIMS_SUPPORTED',
      category: 'TRUST_AND_FACTUAL_INTEGRITY',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'UNRESOLVED_PROHIBITED_CLAIM',
      message: 'The exact version contains an unresolved prohibited or unsupported claim.',
      evidenceSummary: `${input.unresolvedProhibitedClaimCount} unresolved claim(s).`,
      remediationGuidance: 'Remove or verify each claim through the review workflow.',
      ruleIds: ['RUL_CLAIM_SUPPORT'],
      contentDigestSha256: contentDigest,
    }));
    checkResults.set('KSQ_CONTENT_CLAIMS_SUPPORTED', 'FAIL');
  } else {
    checkResults.set('KSQ_CONTENT_CLAIMS_SUPPORTED', 'PASS');
  }

  if (!input.templateLicenceValid) {
    findings.push(finding({
      checkId: 'KSQ_PLATFORM_VERSION_COMPLETE',
      category: 'PUBLICATION_READINESS',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'INVALID_TEMPLATE_LICENCE',
      message: 'The exact version does not have a valid template licence.',
      evidenceSummary: 'Server-side template-licence resolution failed.',
      remediationGuidance: 'Restore an approved template licence for this site.',
      ruleIds: ['PLATFORM_TEMPLATE_LICENCE'],
      contentDigestSha256: contentDigest,
    }));
  }

  if (!input.agencyApprovalCurrent || input.staleApprovalCount > 0) {
    findings.push(finding({
      checkId: 'KSQ_REVIEW_APPROVAL_FRESH',
      category: 'REVIEW_AND_APPROVAL',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: input.staleApprovalCount > 0 ? 'STALE_APPROVAL' : 'MISSING_AGENCY_APPROVAL',
      message: input.staleApprovalCount > 0
        ? 'A required approval does not match the exact content digest.'
        : 'Final agency approval is missing for the exact content digest.',
      evidenceSummary: `${input.staleApprovalCount} stale approval(s) resolved.`,
      remediationGuidance: 'Complete approval for the current digest through the review workflow.',
      ruleIds: ['PLATFORM_APPROVAL_FRESHNESS'],
      contentDigestSha256: contentDigest,
    }));
  }
  if (input.clientApprovalRequired && !input.clientApprovalCurrent) {
    findings.push(finding({
      checkId: 'KSQ_REVIEW_APPROVAL_FRESH',
      category: 'REVIEW_AND_APPROVAL',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'CLIENT_APPROVAL_REQUIRED',
      message: 'Required client approval is missing for the exact content digest.',
      evidenceSummary: 'The active review cycle requires current client approval.',
      remediationGuidance: 'Complete client approval through the controlled review workflow.',
      ruleIds: ['PLATFORM_APPROVAL_FRESHNESS'],
      contentDigestSha256: contentDigest,
    }));
  }
  checkResults.set(
    'KSQ_REVIEW_APPROVAL_FRESH',
    findings.some((item) => item.checkId === 'KSQ_REVIEW_APPROVAL_FRESH')
      ? 'FAIL'
      : 'PASS',
  );

  for (const page of snapshot.pages.filter((candidate) => candidate.active)) {
    if (!page.seo.title.trim() || !page.seo.description.trim()) {
      findings.push(finding({
        checkId: 'KSQ_ONPAGE_TITLE_DESCRIPTION',
        category: 'ON_PAGE_SEO',
        severity: 'WARNING',
        publicationEffect: 'WARNING',
        pageReference: page.publicReference,
        code: 'SEO_METADATA_INCOMPLETE',
        message: 'The page title or meta description is incomplete.',
        evidenceSummary: 'Structured metadata presence check failed.',
        remediationGuidance: 'Regenerate or correct page metadata.',
        ruleIds: ['RUL_PAGE_METADATA'],
        contentDigestSha256: contentDigest,
      }));
    }
  }

  const deterministicAndMixedCheckIds = [
    'KSQ_PLATFORM_SNAPSHOT_VALID',
    'KSQ_PLATFORM_VERSION_COMPLETE',
    'KSQ_PLATFORM_TENANT_ISOLATION',
    'KSQ_TECH_SEO_CANONICAL',
    'KSQ_ONPAGE_TITLE_DESCRIPTION',
    'KSQ_LOCAL_CANONICAL_FACTS',
    'KSQ_STRUCTURED_DATA_VALID',
    'KSQ_A11Y_IMAGE_ALTERNATIVES',
    'KSQ_CONVERSION_PRIMARY_ACTION',
    'KSQ_BOOKING_NATIVE_ONLY',
    'KSQ_BOOKING_CANONICAL_REFERENCES',
    'KSQ_CONTENT_NO_EXECUTABLE',
    'KSQ_CONTENT_CLAIMS_SUPPORTED',
    'KSQ_INTERNAL_LINKS_VALID',
    'KSQ_ASSETS_APPROVED',
    'KSQ_REVIEW_APPROVAL_FRESH',
  ] as const;
  for (const checkId of deterministicAndMixedCheckIds) {
    checkResults.set(
      checkId,
      findings.some((item) => item.checkId === checkId) ? 'FAIL' : 'PASS',
    );
  }

  return {
    validSnapshot: true,
    findings,
    checkResults,
    snapshotDigestSha256,
  };
}

export function findingsFromBrowserResult(
  value: BrowserAuditPageResult,
  contentDigestSha256: string,
): SiteQualityFindingInput[] {
  const result = BrowserAuditPageResultSchema.parse(value);
  const findings: SiteQualityFindingInput[] = [];
  const target = {
    pageReference: result.pageReference,
    contentDigestSha256,
  };
  if (result.httpStatus !== 200 || !result.mainContentPresent) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_TECH_SEO_RENDERABLE',
      category: 'TECHNICAL_SEO',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'RENDER_FAILURE',
      message: 'The page did not render a successful main document.',
      evidenceSummary: `HTTP ${result.httpStatus}; main content ${result.mainContentPresent ? 'present' : 'missing'}.`,
      remediationGuidance: 'Repair the renderer or structured page and rerun.',
      ruleIds: ['RUL_PUBLIC_RENDERABILITY'],
    }));
  }
  if (!result.robots?.toLowerCase().includes('noindex')) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_TECH_SEO_PREVIEW_NOINDEX',
      category: 'TECHNICAL_SEO',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'PREVIEW_INDEXABLE',
      message: 'The secure audit preview is missing noindex.',
      evidenceSummary: 'Rendered robots metadata did not contain noindex.',
      remediationGuidance: 'Repair preview robots metadata and cache controls.',
      ruleIds: ['PLATFORM_SECURE_PREVIEW'],
    }));
  }
  if (
    !result.cacheControl?.toLowerCase().includes('no-store')
    || !result.xRobotsTag?.toLowerCase().includes('noindex')
  ) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_TECH_SEO_PREVIEW_NOINDEX',
      category: 'TECHNICAL_SEO',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'PREVIEW_CACHE_OR_HEADER_UNSAFE',
      message: 'The secure audit preview is missing required no-store or noindex response headers.',
      evidenceSummary: 'Only bounded cache and indexing header status was retained.',
      remediationGuidance: 'Repair preview response cache controls and indexing headers.',
      ruleIds: ['PLATFORM_SECURE_PREVIEW'],
    }));
  }
  let canonicalPathValid = false;
  if (result.canonicalHref) {
    try {
      canonicalPathValid = new URL(result.canonicalHref).pathname === result.path;
    } catch {
      canonicalPathValid = false;
    }
  }
  if (
    !result.canonicalHref
    || !canonicalPathValid
    || result.canonicalUsesPreviewHostname
  ) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_TECH_SEO_CANONICAL',
      category: 'TECHNICAL_SEO',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: result.canonicalUsesPreviewHostname
        ? 'PREVIEW_CANONICAL_LEAK'
        : 'INVALID_CANONICAL_PATH',
      message: 'The rendered canonical URL is missing, invalid, or bound to the preview host.',
      evidenceSummary: 'The canonical host and path were compared without retaining private page content.',
      remediationGuidance: 'Regenerate the canonical metadata from the exact page path and public hostname.',
      ruleIds: ['RUL_CANONICAL_URL'],
    }));
  }
  if (!result.title.trim() || !result.metaDescription?.trim()) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_ONPAGE_TITLE_DESCRIPTION',
      category: 'ON_PAGE_SEO',
      severity: 'WARNING',
      publicationEffect: 'WARNING',
      code: 'RENDERED_SEO_METADATA_INCOMPLETE',
      message: 'Rendered title or description metadata is incomplete.',
      evidenceSummary: 'Rendered head metadata presence was checked.',
      remediationGuidance: 'Regenerate or correct page metadata.',
      ruleIds: ['RUL_PAGE_METADATA'],
      waivable: true,
    }));
  }
  if (result.structuredDataTypes.length === 0) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_STRUCTURED_DATA_VALID',
      category: 'STRUCTURED_DATA',
      severity: 'WARNING',
      publicationEffect: 'WARNING',
      code: 'STRUCTURED_DATA_MISSING',
      message: 'No supported rendered JSON-LD type was detected.',
      evidenceSummary: 'Rendered structured-data type discovery returned no supported type.',
      remediationGuidance: 'Regenerate structured data from canonical records.',
      ruleIds: ['RUL_STRUCTURED_DATA'],
      waivable: true,
    }));
  }
  if (result.h1Count !== 1) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_ONPAGE_SINGLE_H1',
      category: 'ON_PAGE_SEO',
      severity: 'WARNING',
      publicationEffect: 'WARNING',
      code: 'PRIMARY_HEADING_COUNT_INVALID',
      message: 'The page should contain exactly one primary heading.',
      evidenceSummary: `${result.h1Count} h1 element(s) detected.`,
      remediationGuidance: 'Adjust the registered renderer or structured heading.',
      ruleIds: ['RUL_HEADING_HIERARCHY'],
    }));
  }
  const criticalA11y = result.accessibilityViolations.filter((violation) =>
    violation.impact === 'critical' || violation.impact === 'serious');
  if (criticalA11y.length > 0) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_A11Y_AUTOMATED_WCAG22_AA',
      category: 'ACCESSIBILITY',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'CRITICAL_ACCESSIBILITY_FAILURE',
      message: 'Critical or serious automated accessibility failures were detected.',
      evidenceSummary: `${criticalA11y.length} affected accessibility rule(s).`,
      remediationGuidance: 'Correct the component or content accessibility defect.',
      ruleIds: criticalA11y.map((violation) => violation.ruleId).slice(0, 50),
    }));
  } else if (result.accessibilityViolations.length > 0) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_A11Y_AUTOMATED_WCAG22_AA',
      category: 'ACCESSIBILITY',
      severity: 'WARNING',
      publicationEffect: 'WARNING',
      code: 'ACCESSIBILITY_WARNING',
      message: 'Automated accessibility warnings were detected.',
      evidenceSummary: `${result.accessibilityViolations.length} affected accessibility rule(s).`,
      remediationGuidance: 'Review and correct the affected accessible markup.',
      ruleIds: result.accessibilityViolations.map((violation) => violation.ruleId).slice(0, 50),
      waivable: true,
    }));
  }
  if (!result.primaryBookingKeyboardReachable) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_A11Y_PRIMARY_KEYBOARD',
      category: 'ACCESSIBILITY',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'CRITICAL_KEYBOARD_FAILURE',
      message: 'The primary booking action is not keyboard reachable.',
      evidenceSummary: 'Bounded keyboard traversal did not reach the primary booking action.',
      remediationGuidance: 'Repair focus order or keyboard handling.',
      ruleIds: ['WCAG_2_1_1', 'WCAG_2_4_3'],
    }));
  }
  if (result.focusTrapDetected) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_A11Y_PRIMARY_KEYBOARD',
      category: 'ACCESSIBILITY',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'PRIMARY_JOURNEY_FOCUS_TRAP',
      message: 'A focus trap blocks the primary journey.',
      evidenceSummary: 'Bounded keyboard traversal detected a repeated focus cycle.',
      remediationGuidance: 'Repair the focus trap before requesting a rerun.',
      ruleIds: ['WCAG_2_1_2'],
    }));
  }
  if (result.imagesMissingAlt > 0) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_A11Y_IMAGE_ALTERNATIVES',
      category: 'ACCESSIBILITY',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'IMAGE_ALTERNATIVE_MISSING',
      message: 'One or more rendered images are missing an appropriate alternative.',
      evidenceSummary: `${result.imagesMissingAlt} rendered image(s) affected.`,
      remediationGuidance: 'Add a concise alternative or mark the image decorative.',
      ruleIds: ['WCAG_1_1_1'],
    }));
  }
  if (
    result.horizontalOverflowPixels > 0
    || result.clippedInteractiveCount > 0
    || result.obscuredInteractiveCount > 0
  ) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_RESPONSIVE_NO_OVERFLOW',
      category: 'RESPONSIVE_UX',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'RESPONSIVE_LAYOUT_BROKEN',
      message: 'The rendered viewport contains overflow, clipping, or obscured controls.',
      evidenceSummary: `${result.horizontalOverflowPixels}px overflow; ${result.clippedInteractiveCount} clipped; ${result.obscuredInteractiveCount} obscured.`,
      remediationGuidance: 'Repair the component layout at the affected viewport.',
      ruleIds: ['RUL_RESPONSIVE_LAYOUT'],
    }));
  }
  if (result.undersizedTouchTargetCount > 0) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_RESPONSIVE_TOUCH_TARGETS',
      category: 'RESPONSIVE_UX',
      severity: 'WARNING',
      publicationEffect: 'WARNING',
      code: 'TOUCH_TARGETS_UNDERSIZED',
      message: 'One or more touch targets are below the policy minimum.',
      evidenceSummary: `${result.undersizedTouchTargetCount} target(s) affected.`,
      remediationGuidance: 'Increase target size or target spacing.',
      ruleIds: ['WCAG_2_5_8'],
      waivable: true,
    }));
  }
  if (!result.primaryBookingVisible) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_CONVERSION_MOBILE_BOOKING',
      category: 'CONVERSION',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'UNUSABLE_BOOKING_FLOW',
      message: 'The primary booking action is not visible in this viewport.',
      evidenceSummary: `Viewport ${result.viewport} did not expose the primary action.`,
      remediationGuidance: 'Repair responsive action placement.',
      ruleIds: ['RUL_MOBILE_BOOKING_ACTION'],
    }));
  }
  if (result.externalBookingDestinationCount > 0) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_BOOKING_NATIVE_ONLY',
      category: 'BOOKING_INTEGRITY',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'EXTERNAL_BOOKING_DESTINATION',
      message: 'A rendered action targets an external booking system.',
      evidenceSummary: `${result.externalBookingDestinationCount} external destination(s) detected.`,
      remediationGuidance: 'Replace it with a controlled KS OS booking action.',
      ruleIds: ['RUL_NATIVE_BOOKING_DESTINATION'],
    }));
  }
  if (result.brokenInternalLinks.length > 0) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_INTERNAL_LINKS_VALID',
      category: 'INTERNAL_LINKING',
      severity: 'WARNING',
      publicationEffect: 'WARNING',
      code: 'BROKEN_INTERNAL_LINK',
      message: 'One or more internal links do not resolve.',
      evidenceSummary: `${result.brokenInternalLinks.length} broken link(s) detected.`,
      remediationGuidance: 'Update the structured link or navigation target.',
      ruleIds: ['RUL_INTERNAL_LINKS'],
      waivable: true,
    }));
  }
  if (result.failedCriticalResourceCount > 0) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_PERFORMANCE_RENDER',
      category: 'PERFORMANCE',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'CRITICAL_RESOURCE_FAILURE',
      message: 'A critical page resource failed to load.',
      evidenceSummary: `${result.failedCriticalResourceCount} critical resource failure(s).`,
      remediationGuidance: 'Repair the failing renderer resource.',
      ruleIds: ['RUL_CRITICAL_RENDER_PERFORMANCE'],
    }));
  }
  if (result.consoleErrorCount > 0) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_PERFORMANCE_ADVISORY',
      category: 'PERFORMANCE',
      severity: 'WARNING',
      publicationEffect: 'WARNING',
      code: 'CLIENT_SIDE_EXCEPTION',
      message: 'The rendered page emitted one or more client-side exceptions.',
      evidenceSummary: `${result.consoleErrorCount} bounded console error(s) detected.`,
      remediationGuidance: 'Repair the client-side exception and rerun the browser audit.',
      ruleIds: ['RUL_LAB_PERFORMANCE'],
      waivable: true,
    }));
  }
  if (result.oversizedImageCount > 0) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_PERFORMANCE_ADVISORY',
      category: 'PERFORMANCE',
      severity: 'WARNING',
      publicationEffect: 'WARNING',
      code: 'OVERSIZED_IMAGE',
      message: 'One or more rendered images exceed the versioned transfer-size threshold.',
      evidenceSummary: `${result.oversizedImageCount} oversized rendered image(s) detected.`,
      remediationGuidance: 'Resize, compress, or replace the affected image asset.',
      ruleIds: ['RUL_LAB_PERFORMANCE', 'RUL_PUBLIC_ASSET_READINESS'],
      waivable: true,
    }));
  }
  if (result.imagesMissingDimensions > 0) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_PERFORMANCE_ADVISORY',
      category: 'PERFORMANCE',
      severity: 'WARNING',
      publicationEffect: 'WARNING',
      code: 'IMAGE_DIMENSIONS_MISSING',
      message: 'One or more rendered images omit intrinsic width or height metadata.',
      evidenceSummary: `${result.imagesMissingDimensions} rendered image(s) affected.`,
      remediationGuidance: 'Add controlled intrinsic dimensions to reduce layout instability.',
      ruleIds: ['RUL_LAB_PERFORMANCE', 'RUL_PUBLIC_ASSET_READINESS'],
      waivable: true,
    }));
  }
  const blockingCoreWebVitals = result.performanceMetrics.filter((metric) =>
    metric.result === 'BLOCK'
    && [
      'LARGEST_CONTENTFUL_PAINT_MS',
      'INTERACTION_TO_NEXT_PAINT_MS',
      'CUMULATIVE_LAYOUT_SHIFT',
    ].includes(metric.name));
  if (blockingCoreWebVitals.length > 0) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_PERFORMANCE_RENDER',
      category: 'PERFORMANCE',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'CORE_WEB_VITALS_FAILED',
      message: 'One or more lab Core Web Vitals exceed the publication thresholds.',
      evidenceSummary: blockingCoreWebVitals
        .map(metric => `${metric.name} ${metric.value}/${metric.threshold} ${metric.unit} (${metric.measurementMode})`)
        .join('; '),
      remediationGuidance: 'Optimise the affected rendering path and rerun the same viewport audit. Field performance must still be monitored after publication.',
      ruleIds: ['RUL_CORE_WEB_VITALS', 'RUL_LAB_PERFORMANCE'],
    }));
  }
  if (result.lcpImageLoading === 'lazy') {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_PERFORMANCE_RENDER',
      category: 'PERFORMANCE',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'LCP_ELEMENT_LAZY_LOADED',
      message: 'The measured LCP image is unnecessarily lazy-loaded.',
      evidenceSummary: `The ${result.lcpElementTag ?? 'image'} LCP candidate used loading=lazy in ${result.viewport}.`,
      remediationGuidance: 'Load the likely LCP image eagerly and keep it discoverable in the initial server-rendered document.',
      ruleIds: ['RUL_LCP_RESOURCE_PRIORITY'],
    }));
  }
  if (result.lcpResourceFailed || !result.lcpResourceDiscoverable) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_PERFORMANCE_RENDER',
      category: 'PERFORMANCE',
      severity: 'BLOCKING',
      publicationEffect: 'BLOCK',
      code: 'LCP_CRITICAL_RESOURCE_INVALID',
      message: 'The measured LCP resource failed or is not discoverable from the rendered document.',
      evidenceSummary: `Discoverable: ${result.lcpResourceDiscoverable}; failed: ${result.lcpResourceFailed}.`,
      remediationGuidance: 'Expose a valid critical image URL in the initial markup and repair the failed resource.',
      ruleIds: ['RUL_LCP_RESOURCE_PRIORITY', 'RUL_CRITICAL_RENDER_PERFORMANCE'],
    }));
  }
  if (
    result.lcpResourceTransferBytes !== null
    && result.lcpResourceTransferBytes
      > DEFAULT_SITE_QUALITY_POLICY.thresholds.maximumImageTransferBytes
  ) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_PERFORMANCE_ADVISORY',
      category: 'PERFORMANCE',
      severity: 'WARNING',
      publicationEffect: 'WARNING',
      code: 'LCP_ASSET_OVERSIZED',
      message: 'The measured LCP asset exceeds the versioned image transfer threshold.',
      evidenceSummary: `${result.lcpResourceTransferBytes} bytes were transferred for the LCP resource.`,
      remediationGuidance: 'Resize and compress the LCP asset while preserving visual quality.',
      ruleIds: ['RUL_LCP_RESOURCE_PRIORITY', 'RUL_PUBLIC_ASSET_READINESS'],
      waivable: true,
    }));
  }
  if (
    result.lcpElementTag === 'img'
    && (result.lcpImageHasResponsiveSource === false
      || result.lcpImageHasIntrinsicDimensions === false)
  ) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_PERFORMANCE_ADVISORY',
      category: 'PERFORMANCE',
      severity: 'WARNING',
      publicationEffect: 'WARNING',
      code: 'LCP_IMAGE_METADATA_INCOMPLETE',
      message: 'The LCP image lacks responsive source or intrinsic dimension metadata.',
      evidenceSummary: `Responsive source: ${result.lcpImageHasResponsiveSource}; intrinsic dimensions: ${result.lcpImageHasIntrinsicDimensions}.`,
      remediationGuidance: 'Provide responsive sources plus controlled width and height for the LCP image.',
      ruleIds: ['RUL_LCP_RESOURCE_PRIORITY', 'RUL_PUBLIC_ASSET_READINESS'],
      waivable: true,
    }));
  }
  if (result.longMainThreadTaskCount > 0) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_PERFORMANCE_ADVISORY',
      category: 'PERFORMANCE',
      severity: 'WARNING',
      publicationEffect: 'WARNING',
      code: 'MAIN_THREAD_LONG_TASK_RISK',
      message: 'Long main-thread tasks may degrade interaction responsiveness.',
      evidenceSummary: `${result.longMainThreadTaskCount} long task(s), totalling ${Math.round(result.longMainThreadTaskTotalMs)}ms, were observed in the lab run.`,
      remediationGuidance: 'Reduce client-side work, split expensive tasks, and keep public pages primarily server-rendered.',
      ruleIds: ['RUL_INP_INTERACTION_RESPONSIVENESS'],
      waivable: true,
    }));
  }
  if (
    result.renderBlockingStylesheetCount > 2
    || result.parserBlockingScriptCount > 0
    || result.slowFontResourceCount > 0
  ) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_PERFORMANCE_ADVISORY',
      category: 'PERFORMANCE',
      severity: 'WARNING',
      publicationEffect: 'WARNING',
      code: 'RENDER_BLOCKING_RESOURCE_RISK',
      message: 'Potential render-blocking styles, scripts, or slow fonts were observed.',
      evidenceSummary: `${result.renderBlockingStylesheetCount} stylesheet(s); ${result.parserBlockingScriptCount} parser-blocking script(s); ${result.slowFontResourceCount} slow font(s).`,
      remediationGuidance: 'Inline only critical CSS, defer non-critical scripts, and optimise font discovery and loading.',
      ruleIds: ['RUL_LCP_RESOURCE_PRIORITY', 'RUL_LAB_PERFORMANCE'],
      waivable: true,
    }));
  }
  const warningMetrics = result.performanceMetrics.filter((metric) =>
    metric.result === 'WARNING');
  if (warningMetrics.length > 0) {
    findings.push(finding({
      ...target,
      checkId: 'KSQ_PERFORMANCE_ADVISORY',
      category: 'PERFORMANCE',
      severity: 'WARNING',
      publicationEffect: 'WARNING',
      code: 'LAB_PERFORMANCE_WARNING',
      message: 'One or more lab performance metrics exceed advisory thresholds.',
      evidenceSummary: `${warningMetrics.length} advisory metric(s) exceeded.`,
      remediationGuidance: 'Optimise assets, layout, or rendering.',
      ruleIds: ['RUL_LAB_PERFORMANCE'],
      waivable: true,
    }));
  }
  return findings;
}

export function summarizeCategoryFindings(
  findings: readonly SiteQualityFindingInput[],
): Record<SiteQualityCategory, {
  blocking: number;
  warnings: number;
  recommendations: number;
}> {
  const categories = [
    'TECHNICAL_SEO',
    'ON_PAGE_SEO',
    'LOCAL_SEO',
    'STRUCTURED_DATA',
    'ACCESSIBILITY',
    'RESPONSIVE_UX',
    'CONVERSION',
    'BOOKING_INTEGRITY',
    'CONTENT_INTEGRITY',
    'PERFORMANCE',
    'INTERNAL_LINKING',
    'ASSET_READINESS',
    'TRUST_AND_FACTUAL_INTEGRITY',
    'REVIEW_AND_APPROVAL',
    'PUBLICATION_READINESS',
  ] as const;
  return Object.fromEntries(categories.map((category) => {
    const current = findings.filter((finding) => finding.category === category);
    return [category, {
      blocking: current.filter((finding) => finding.publicationEffect === 'BLOCK').length,
      warnings: current.filter((finding) => finding.publicationEffect === 'WARNING').length,
      recommendations: current.filter((finding) =>
        finding.publicationEffect === 'RECOMMENDATION').length,
    }];
  })) as Record<SiteQualityCategory, {
    blocking: number;
    warnings: number;
    recommendations: number;
  }>;
}
