import { PublicReferenceSchema, SitePageTypeSchema } from '@ks-os/contracts';
import { SiteSectionTypeSchema } from '@ks-os/site-schema';
import { z } from 'zod';

export const SITE_QUALITY_ENGINE_VERSION = '15.8.0' as const;
export const SITE_QUALITY_RENDERER_VERSION = 'PUBLIC_SITE_RENDERER_V1' as const;
export const DEFAULT_PUBLICATION_POLICY_VERSION =
  'KS_OS_PUBLICATION_POLICY_V1' as const;

export const SiteQualityAuditTypeSchema = z.enum([
  'FULL_SITE_QUALITY',
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
  'PUBLICATION_READINESS',
]);
export type SiteQualityAuditType = z.infer<typeof SiteQualityAuditTypeSchema>;

export const SiteQualityCategorySchema = z.enum([
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
]);
export type SiteQualityCategory = z.infer<typeof SiteQualityCategorySchema>;

export const SiteQualityValidationMethodSchema = z.enum([
  'DETERMINISTIC',
  'RENDERED_BROWSER',
  'AI_REVIEW',
  'HUMAN_REVIEW',
  'DATA_REQUIRED',
  'MIXED',
]);
export type SiteQualityValidationMethod = z.infer<
  typeof SiteQualityValidationMethodSchema
>;

export const SiteQualitySeveritySchema = z.enum([
  'INFO',
  'WARNING',
  'BLOCKING',
]);
export type SiteQualitySeverity = z.infer<typeof SiteQualitySeveritySchema>;

export const SiteQualityPublicationEffectSchema = z.enum([
  'BLOCK',
  'WARNING',
  'RECOMMENDATION',
]);
export type SiteQualityPublicationEffect = z.infer<
  typeof SiteQualityPublicationEffectSchema
>;

export const SiteQualityRunStatusSchema = z.enum([
  'PENDING',
  'PREPARING',
  'RENDERING',
  'RUNNING_DETERMINISTIC_CHECKS',
  'RUNNING_BROWSER_CHECKS',
  'RUNNING_AI_REVIEW',
  'EVALUATING',
  'READY',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'SUPERSEDED',
]);
export type SiteQualityRunStatus = z.infer<typeof SiteQualityRunStatusSchema>;

export const SiteQualityGateStatusSchema = z.enum([
  'NOT_EVALUATED',
  'BLOCKED',
  'READY_WITH_WARNINGS',
  'READY',
  'STALE',
]);
export type SiteQualityGateStatus = z.infer<
  typeof SiteQualityGateStatusSchema
>;

export const SiteQualityFindingStatusSchema = z.enum([
  'OPEN',
  'ACKNOWLEDGED',
  'IN_REMEDIATION',
  'RESOLVED',
  'WAIVED',
  'NOT_APPLICABLE',
  'SUPERSEDED',
]);
export type SiteQualityFindingStatus = z.infer<
  typeof SiteQualityFindingStatusSchema
>;

export const SiteQualityCheckResultSchema = z.enum([
  'PASS',
  'FAIL',
  'WARNING',
  'NOT_APPLICABLE',
  'DATA_REQUIRED',
  'ERROR',
]);
export type SiteQualityCheckResult = z.infer<
  typeof SiteQualityCheckResultSchema
>;

export const SiteQualityAuditReasonSchema = z.enum([
  'PRE_INTERNAL_REVIEW',
  'PRE_CLIENT_REVIEW',
  'PRE_PUBLICATION',
  'MANUAL_RECHECK',
  'POST_REMEDIATION',
]);
export type SiteQualityAuditReason = z.infer<
  typeof SiteQualityAuditReasonSchema
>;

export const SiteQualityEvidenceTypeSchema = z.enum([
  'STRUCTURED_RESULT',
  'BROWSER_SUMMARY',
  'SCREENSHOT_REFERENCE',
  'ACCESSIBILITY_RESULT',
  'PERFORMANCE_METRIC',
  'BOOKING_RESULT',
  'HUMAN_DECISION',
  'AI_REVIEW_RESULT',
]);
export type SiteQualityEvidenceType = z.infer<
  typeof SiteQualityEvidenceTypeSchema
>;

export const SiteQualityViewportKeySchema = z.enum([
  'SMALL_MOBILE',
  'STANDARD_MOBILE',
  'TABLET_PORTRAIT',
  'DESKTOP',
  'WIDE_DESKTOP',
]);
export type SiteQualityViewportKey = z.infer<
  typeof SiteQualityViewportKeySchema
>;

export const SiteQualityViewportSchema = z.object({
  key: SiteQualityViewportKeySchema,
  width: z.number().int().min(240).max(5_000),
  height: z.number().int().min(320).max(5_000),
  deviceScaleFactor: z.number().min(1).max(4),
  mobile: z.boolean(),
  touch: z.boolean(),
}).strict();
export type SiteQualityViewport = z.infer<typeof SiteQualityViewportSchema>;

export const SITE_QUALITY_VIEWPORTS = [
  {
    key: 'SMALL_MOBILE',
    width: 320,
    height: 568,
    deviceScaleFactor: 1,
    mobile: true,
    touch: true,
  },
  {
    key: 'STANDARD_MOBILE',
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
    touch: true,
  },
  {
    key: 'TABLET_PORTRAIT',
    width: 768,
    height: 1024,
    deviceScaleFactor: 1,
    mobile: true,
    touch: true,
  },
  {
    key: 'DESKTOP',
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
    touch: false,
  },
  {
    key: 'WIDE_DESKTOP',
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
    touch: false,
  },
] as const satisfies readonly SiteQualityViewport[];

export const SiteQualityCheckDefinitionSchema = z.object({
  checkId: z.string().regex(/^KSQ_[A-Z0-9_]{3,100}$/),
  category: SiteQualityCategorySchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(1_000),
  validationMethod: SiteQualityValidationMethodSchema,
  ruleIds: z.array(z.string().trim().min(1).max(120)).max(50),
  applicablePageTypes: z.array(SitePageTypeSchema).max(30),
  applicableSectionTypes: z.array(SiteSectionTypeSchema).max(30),
  severity: SiteQualitySeveritySchema,
  publicationEffect: SiteQualityPublicationEffectSchema,
  waivable: z.boolean(),
  evidenceRequirements: z.array(z.string().trim().min(1).max(240)).max(20),
  remediationGuidance: z.string().trim().min(1).max(1_000),
  engineVersion: z.string().trim().min(1).max(80),
}).strict();
export type SiteQualityCheckDefinition = z.infer<
  typeof SiteQualityCheckDefinitionSchema
>;

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const SafeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,100}$/);

export const SiteQualityFindingInputSchema = z.object({
  checkId: z.string().regex(/^KSQ_[A-Z0-9_]{3,100}$/),
  category: SiteQualityCategorySchema,
  severity: SiteQualitySeveritySchema,
  publicationEffect: SiteQualityPublicationEffectSchema,
  waivable: z.boolean(),
  pageReference: PublicReferenceSchema.optional(),
  sectionReference: PublicReferenceSchema.optional(),
  fieldPath: z.string().trim().min(1).max(500).optional(),
  bookingActionReference: PublicReferenceSchema.optional(),
  ruleIds: z.array(z.string().trim().min(1).max(120)).max(50),
  code: SafeCodeSchema,
  message: z.string().trim().min(1).max(1_000),
  evidenceSummary: z.string().trim().min(1).max(1_000),
  remediationGuidance: z.string().trim().min(1).max(1_000),
  status: SiteQualityFindingStatusSchema.default('OPEN'),
  contentDigestSha256: DigestSchema,
}).strict();
export type SiteQualityFindingInput = z.infer<
  typeof SiteQualityFindingInputSchema
>;

export const SiteQualityEvidenceInputSchema = z.object({
  checkId: z.string().regex(/^KSQ_[A-Z0-9_]{3,100}$/),
  evidenceType: SiteQualityEvidenceTypeSchema,
  pageReference: PublicReferenceSchema.optional(),
  viewport: SiteQualityViewportKeySchema.optional(),
  contentDigestSha256: DigestSchema,
  evidenceDigestSha256: DigestSchema,
  safeSummary: z.string().trim().min(1).max(1_000),
  safeMetadata: z.record(z.union([
    z.string().max(500),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(z.string().max(200)).max(50),
  ])).default({}),
  storageReference: z.string().trim().min(1).max(1_000).optional(),
  toolVersion: z.string().trim().min(1).max(120).optional(),
  capturedAt: z.coerce.date(),
}).strict();
export type SiteQualityEvidenceInput = z.infer<
  typeof SiteQualityEvidenceInputSchema
>;

export const CreateSiteQualityRunSchema = z.object({
  siteVersionReference: PublicReferenceSchema,
  auditType: SiteQualityAuditTypeSchema.default('FULL_SITE_QUALITY'),
  reason: SiteQualityAuditReasonSchema,
}).strict();
export type CreateSiteQualityRunInput = z.infer<
  typeof CreateSiteQualityRunSchema
>;

export const SiteQualityRunJobPayloadBaseSchema = z.object({
  siteReference: PublicReferenceSchema,
  siteVersionReference: PublicReferenceSchema,
  qualityRunReference: PublicReferenceSchema,
  requestedByAgencyUserReference: PublicReferenceSchema,
  reason: SiteQualityAuditReasonSchema,
}).strict();

export const SiteQualityWaiverDecisionSchema = z.object({
  reason: z.string().trim().min(20).max(2_000),
  riskAcceptance: z.string().trim().min(20).max(2_000),
  expiresAt: z.coerce.date().optional(),
}).strict();
export type SiteQualityWaiverDecision = z.infer<
  typeof SiteQualityWaiverDecisionSchema
>;

export const SiteQualityHumanReviewDecisionSchema = z.object({
  decision: z.enum(['PASS', 'FAIL', 'DATA_REQUIRED']),
  notes: z.string().trim().min(8).max(2_000),
}).strict();

export const PublicationBlockingCodeSchema = z.enum([
  'NO_COMPLETED_QUALITY_RUN',
  'QUALITY_RUN_STALE',
  'SITE_VERSION_INCOMPLETE',
  'SITE_VERSION_SUPERSEDED',
  'SITE_DIGEST_CHANGED',
  'REVIEW_NOT_APPROVED',
  'APPROVAL_STALE',
  'CLIENT_APPROVAL_REQUIRED',
  'OPEN_BLOCKING_FINDING',
  'NON_WAIVABLE_FINDING',
  'STALE_WAIVER',
  'INVALID_NATIVE_BOOKING',
  'EXTERNAL_BOOKING_DESTINATION',
  'CROSS_TENANT_REFERENCE',
  'PROHIBITED_CLAIM',
  'MISSING_REQUIRED_PAGE',
  'MISSING_REQUIRED_SECTION',
  'CRITICAL_ACCESSIBILITY_FAILURE',
  'RENDER_FAILURE',
  'UNAPPROVED_PUBLIC_ASSET',
  'INVALID_TEMPLATE_LICENCE',
  'OTHER',
]);
export type PublicationBlockingCode = z.infer<
  typeof PublicationBlockingCodeSchema
>;

export const SiteQualityFailureCodeSchema = z.enum([
  'QUALITY_PRECONDITION_FAILED',
  'QUALITY_VERSION_STALE',
  'QUALITY_SECURE_PREVIEW_UNAVAILABLE',
  'QUALITY_BROWSER_UNAVAILABLE',
  'QUALITY_RENDER_FAILED',
  'QUALITY_CATEGORY_PARTIAL_FAILURE',
  'QUALITY_CANCELLED',
  'QUALITY_UNEXPECTED_FAILURE',
]);
export type SiteQualityFailureCode = z.infer<
  typeof SiteQualityFailureCodeSchema
>;

export const SiteQualityPerformanceMetricSchema = z.object({
  name: z.enum([
    'PAGE_LOAD_MS',
    'MAIN_CONTENT_MS',
    'CUMULATIVE_LAYOUT_SHIFT',
    'TRANSFER_BYTES',
    'FAILED_CRITICAL_RESOURCES',
  ]),
  value: z.number().finite().nonnegative(),
  unit: z.enum(['MILLISECONDS', 'SCORE', 'BYTES', 'COUNT']),
  viewport: SiteQualityViewportKeySchema,
  threshold: z.number().finite().nonnegative(),
  result: z.enum(['PASS', 'WARNING', 'BLOCK']),
  evidenceTimestamp: z.coerce.date(),
  toolVersion: z.string().trim().min(1).max(120),
}).strict();
export type SiteQualityPerformanceMetric = z.infer<
  typeof SiteQualityPerformanceMetricSchema
>;

export const BrowserAuditPageResultSchema = z.object({
  pageReference: PublicReferenceSchema,
  path: z.string().startsWith('/').max(500),
  viewport: SiteQualityViewportKeySchema,
  httpStatus: z.number().int().min(100).max(599),
  title: z.string().max(500),
  metaDescription: z.string().max(1_000).nullable(),
  canonicalHref: z.string().max(2_000).nullable(),
  robots: z.string().max(500).nullable(),
  cacheControl: z.string().max(500).nullable(),
  xRobotsTag: z.string().max(500).nullable(),
  canonicalUsesPreviewHostname: z.boolean(),
  htmlLanguage: z.string().max(40).nullable(),
  h1Count: z.number().int().nonnegative(),
  mainContentPresent: z.boolean(),
  structuredDataTypes: z.array(z.string().max(120)).max(100),
  internalLinks: z.array(z.string().max(1_000)).max(2_000),
  brokenInternalLinks: z.array(z.string().max(1_000)).max(2_000),
  imageCount: z.number().int().nonnegative(),
  imagesMissingAlt: z.number().int().nonnegative(),
  imagesMissingDimensions: z.number().int().nonnegative(),
  oversizedImageCount: z.number().int().nonnegative(),
  horizontalOverflowPixels: z.number().int().nonnegative(),
  clippedInteractiveCount: z.number().int().nonnegative(),
  obscuredInteractiveCount: z.number().int().nonnegative(),
  undersizedTouchTargetCount: z.number().int().nonnegative(),
  primaryBookingVisible: z.boolean(),
  primaryBookingKeyboardReachable: z.boolean(),
  focusTrapDetected: z.boolean(),
  externalBookingDestinationCount: z.number().int().nonnegative(),
  consoleErrorCount: z.number().int().nonnegative(),
  failedCriticalResourceCount: z.number().int().nonnegative(),
  accessibilityViolations: z.array(z.object({
    ruleId: z.string().trim().min(1).max(160),
    impact: z.enum(['minor', 'moderate', 'serious', 'critical']).nullable(),
    nodeCount: z.number().int().positive(),
    helpUrl: z.string().url().max(1_000).optional(),
  }).strict()).max(1_000),
  performanceMetrics: z.array(SiteQualityPerformanceMetricSchema).max(20),
  screenshotReference: z.string().trim().min(1).max(1_000).optional(),
  evidenceDigestSha256: DigestSchema,
  browserVersion: z.string().trim().min(1).max(120),
  capturedAt: z.coerce.date(),
}).strict();
export type BrowserAuditPageResult = z.infer<
  typeof BrowserAuditPageResultSchema
>;
