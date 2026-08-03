import { z } from 'zod';
import {
  ActivateCustomDomainPayloadSchema,
  ActivateFallbackDomainPayloadSchema,
  ConfigureCustomDomainDnsPayloadSchema,
  CreateCustomDomainPlanPayloadSchema,
  CreateSitePublicationPayloadSchema,
  DiscoverCustomDomainDnsPayloadSchema,
  InvalidateSiteCachePayloadSchema,
  RemoveSiteDomainPayloadSchema,
  RollbackSitePublicationPayloadSchema,
  RunPublicationHealthChecksPayloadSchema,
  SuspendSiteDomainPayloadSchema,
  VerifyCustomDomainPayloadSchema,
  VerifyNameserverDelegationPayloadSchema,
} from '@ks-os/site-publishing';

export {
  ActivateCustomDomainPayloadSchema,
  ActivateFallbackDomainPayloadSchema,
  ConfigureCustomDomainDnsPayloadSchema,
  CreateCustomDomainPlanPayloadSchema,
  CreateSitePublicationPayloadSchema,
  DiscoverCustomDomainDnsPayloadSchema,
  InvalidateSiteCachePayloadSchema,
  RemoveSiteDomainPayloadSchema,
  RollbackSitePublicationPayloadSchema,
  RunPublicationHealthChecksPayloadSchema,
  SuspendSiteDomainPayloadSchema,
  VerifyCustomDomainPayloadSchema,
  VerifyNameserverDelegationPayloadSchema,
} from '@ks-os/site-publishing';

export const SITE_JOB_PAYLOAD_SCHEMA_VERSION = 1 as const;

export const SiteJobTypeSchema = z.enum([
  'PROVISION_WORKSPACE',
  'IMPORT_TEMPLATE',
  'CLASSIFY_TEMPLATE',
  'CREATE_BLUEPRINT',
  'GENERATE_SITE',
  'GENERATE_PAGE',
  'REGENERATE_SECTION',
  'GENERATE_METADATA',
  'GENERATE_STRUCTURED_DATA',
  'OPTIMISE_IMAGE',
  'RUN_SEO_AUDIT',
  'RUN_UX_AUDIT',
  'RUN_ACCESSIBILITY_AUDIT',
  'RUN_CONVERSION_AUDIT',
  'RUN_FULL_SITE_QUALITY_AUDIT',
  'RUN_TECHNICAL_SEO_AUDIT',
  'RUN_RESPONSIVE_UX_AUDIT',
  'RUN_BOOKING_INTEGRITY_AUDIT',
  'RUN_PERFORMANCE_AUDIT',
  'RUN_CONTENT_INTEGRITY_AUDIT',
  'RUN_ASSET_READINESS_AUDIT',
  'EVALUATE_PUBLICATION_READINESS',
  'CREATE_SITE_SNAPSHOT',
  'PREPARE_PUBLICATION',
  'VERIFY_DOMAIN',
  'SYNC_ANALYTICS',
  'CHECK_BOOKING_LINKS',
  'GENERATE_MONTHLY_PAGE_OPPORTUNITIES',
  'GENERATE_MONTHLY_PAGE',
  'CREATE_SITE_PUBLICATION',
  'ACTIVATE_FALLBACK_DOMAIN',
  'CREATE_CUSTOM_DOMAIN_PLAN',
  'DISCOVER_CUSTOM_DOMAIN_DNS',
  'VERIFY_NAMESERVER_DELEGATION',
  'CONFIGURE_CUSTOM_DOMAIN_DNS',
  'VERIFY_CUSTOM_DOMAIN',
  'ACTIVATE_CUSTOM_DOMAIN',
  'RUN_PUBLICATION_HEALTH_CHECKS',
  'ROLLBACK_SITE_PUBLICATION',
  'SUSPEND_SITE_DOMAIN',
  'REMOVE_SITE_DOMAIN',
  'INVALIDATE_SITE_CACHE',
]);
export type SiteJobType = z.infer<typeof SiteJobTypeSchema>;

export const TestSiteJobTypeSchema = z.enum([
  'TEST_SUCCEED',
  'TEST_RETRYABLE_FAILURE',
  'TEST_TERMINAL_FAILURE',
  'TEST_LONG_RUNNING',
  'TEST_CANCELLABLE',
]);
export type TestSiteJobType = z.infer<typeof TestSiteJobTypeSchema>;

export const RegisteredSiteJobTypeSchema = z.union([
  SiteJobTypeSchema,
  TestSiteJobTypeSchema,
]);
export type RegisteredSiteJobType = z.infer<typeof RegisteredSiteJobTypeSchema>;

export const SiteJobStatusSchema = z.enum([
  'PENDING',
  'SCHEDULED',
  'LEASED',
  'PROCESSING',
  'RETRY_DELAY',
  'COMPLETED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'DEAD_LETTER',
]);
export type SiteJobStatus = z.infer<typeof SiteJobStatusSchema>;

export const SiteJobFailureCodeSchema = z.enum([
  'RETRYABLE_EXTERNAL_FAILURE',
  'RETRYABLE_DATABASE_CONTENTION',
  'RETRYABLE_RATE_LIMIT',
  'TERMINAL_VALIDATION_FAILURE',
  'TERMINAL_PERMISSION_FAILURE',
  'TERMINAL_DATA_MISSING',
  'TERMINAL_HANDLER_NOT_IMPLEMENTED',
  'TERMINAL_SCHEMA_VERSION_INCOMPATIBLE',
  'CANCELLED_BY_USER',
  'LEASE_LOST',
  'WORKER_SHUTDOWN',
  'UNEXPECTED_HANDLER_FAILURE',
]);
export type SiteJobFailureCode = z.infer<typeof SiteJobFailureCodeSchema>;

export const SiteJobEventTypeSchema = z.enum([
  'JOB_CREATED',
  'JOB_SCHEDULED',
  'JOB_LEASED',
  'JOB_STARTED',
  'JOB_PROGRESS_UPDATED',
  'JOB_HEARTBEAT',
  'JOB_RETRY_SCHEDULED',
  'JOB_COMPLETED',
  'JOB_FAILED',
  'JOB_CANCEL_REQUESTED',
  'JOB_CANCELLED',
  'JOB_RETRIED_MANUALLY',
  'JOB_LEASE_EXPIRED',
  'JOB_MOVED_TO_DEAD_LETTER',
]);
export type SiteJobEventType = z.infer<typeof SiteJobEventTypeSchema>;

export const SiteJobAttemptOutcomeSchema = z.enum([
  'PROCESSING',
  'COMPLETED',
  'RETRY_SCHEDULED',
  'FAILED',
  'CANCELLED',
  'LEASE_EXPIRED',
]);
export type SiteJobAttemptOutcome = z.infer<typeof SiteJobAttemptOutcomeSchema>;

const PublicReferenceSchema = z.string().uuid();
const SourceDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const PeriodSchema = z.string().regex(/^\d{4}-\d{2}$/);
const SafeRegenerationInstructionSchema = z.string().trim().min(8).max(1_000)
  .refine(value => !/(?:https?:\/\/|external\s+booking|calendly|fresha|invent|fabricat|fake\s+(?:review|testimonial)|ignore\s+(?:rules|instructions)|<\s*script|javascript:)/i.test(value), {
    message: 'The regeneration instruction conflicts with generation safety rules.',
  });

const SitePayloadBase = z.object({
  siteReference: PublicReferenceSchema,
}).strict();

export const ProvisionWorkspacePayloadSchema = SitePayloadBase.extend({
  jobType: z.literal('PROVISION_WORKSPACE'),
  provisioningRunReference: PublicReferenceSchema,
  provisioningDraftReference: PublicReferenceSchema,
  productionBriefReference: PublicReferenceSchema,
  productionBriefDigestSha256: SourceDigestSchema,
  requestedByAgencyUserReference: PublicReferenceSchema,
}).strict();

const VersionPayloadBase = z.object({
  siteReference: PublicReferenceSchema,
  versionReference: PublicReferenceSchema,
}).strict();

export const ImportTemplatePayloadSchema = z.object({
  jobType: z.literal('IMPORT_TEMPLATE'),
  templateSourceReference: PublicReferenceSchema,
  artifactReference: z.string().trim().min(1).max(1000),
  artifactDigestSha256: SourceDigestSchema,
}).strict();

export const ClassifyTemplatePayloadSchema = z.object({
  jobType: z.literal('CLASSIFY_TEMPLATE'),
  templateVersionReference: PublicReferenceSchema,
  artifactDigestSha256: SourceDigestSchema,
}).strict();

export const CreateBlueprintPayloadSchema = SitePayloadBase.extend({
  jobType: z.literal('CREATE_BLUEPRINT'),
  templateVersionReference: PublicReferenceSchema,
  sourceDataDigestSha256: SourceDigestSchema,
}).strict();

export const GenerateSitePayloadSchema = SitePayloadBase.extend({
  jobType: z.literal('GENERATE_SITE'),
  blueprintReference: PublicReferenceSchema,
  knowledgePackReference: PublicReferenceSchema.optional(),
  requestedByAgencyUserReference: PublicReferenceSchema,
  generationReason: z.enum(['INITIAL_SITE', 'BLUEPRINT_REVISION']),
}).strict();

export const GeneratePagePayloadSchema = SitePayloadBase.extend({
  jobType: z.literal('GENERATE_PAGE'),
  siteVersionReference: PublicReferenceSchema,
  blueprintPageReference: PublicReferenceSchema,
  requestedByAgencyUserReference: PublicReferenceSchema,
}).strict();

export const RegenerateSectionPayloadSchema = SitePayloadBase.extend({
  jobType: z.literal('REGENERATE_SECTION'),
  siteVersionReference: PublicReferenceSchema,
  pageReference: PublicReferenceSchema,
  sectionReference: PublicReferenceSchema,
  regenerationInstruction: SafeRegenerationInstructionSchema,
  requestedByAgencyUserReference: PublicReferenceSchema,
}).strict();

export const GenerateMetadataPayloadSchema = SitePayloadBase.extend({
  jobType: z.literal('GENERATE_METADATA'),
  siteVersionReference: PublicReferenceSchema,
  pageReference: PublicReferenceSchema.optional(),
  requestedByAgencyUserReference: PublicReferenceSchema,
}).strict();

export const GenerateStructuredDataPayloadSchema = SitePayloadBase.extend({
  jobType: z.literal('GENERATE_STRUCTURED_DATA'),
  siteVersionReference: PublicReferenceSchema,
  pageReference: PublicReferenceSchema.optional(),
  requestedByAgencyUserReference: PublicReferenceSchema,
}).strict();

export const OptimiseImagePayloadSchema = SitePayloadBase.extend({
  jobType: z.literal('OPTIMISE_IMAGE'),
  assetReference: PublicReferenceSchema,
  sourceDigestSha256: SourceDigestSchema,
}).strict();

const AuditPayloadFields = {
  siteReference: PublicReferenceSchema,
  versionReference: PublicReferenceSchema,
};

export const RunSeoAuditPayloadSchema = z.object({
  jobType: z.literal('RUN_SEO_AUDIT'),
  ...AuditPayloadFields,
}).strict();

export const RunUxAuditPayloadSchema = z.object({
  jobType: z.literal('RUN_UX_AUDIT'),
  ...AuditPayloadFields,
}).strict();

export const RunAccessibilityAuditPayloadSchema = z.object({
  jobType: z.literal('RUN_ACCESSIBILITY_AUDIT'),
  ...AuditPayloadFields,
}).strict();

export const RunConversionAuditPayloadSchema = z.object({
  jobType: z.literal('RUN_CONVERSION_AUDIT'),
  ...AuditPayloadFields,
}).strict();

const QualityAuditReasonSchema = z.enum([
  'PRE_INTERNAL_REVIEW',
  'PRE_CLIENT_REVIEW',
  'PRE_PUBLICATION',
  'MANUAL_RECHECK',
  'POST_REMEDIATION',
]);
const QualityAuditPayloadFields = {
  siteReference: PublicReferenceSchema,
  siteVersionReference: PublicReferenceSchema,
  qualityRunReference: PublicReferenceSchema,
  requestedByAgencyUserReference: PublicReferenceSchema,
  reason: QualityAuditReasonSchema,
};

export const RunFullSiteQualityAuditPayloadSchema = z.object({
  jobType: z.literal('RUN_FULL_SITE_QUALITY_AUDIT'),
  ...QualityAuditPayloadFields,
}).strict();

export const RunTechnicalSeoAuditPayloadSchema = z.object({
  jobType: z.literal('RUN_TECHNICAL_SEO_AUDIT'),
  ...QualityAuditPayloadFields,
}).strict();

export const RunPhase158AccessibilityAuditPayloadSchema = z.object({
  jobType: z.literal('RUN_ACCESSIBILITY_AUDIT'),
  ...QualityAuditPayloadFields,
}).strict();

export const RunResponsiveUxAuditPayloadSchema = z.object({
  jobType: z.literal('RUN_RESPONSIVE_UX_AUDIT'),
  ...QualityAuditPayloadFields,
}).strict();

export const RunPhase158ConversionAuditPayloadSchema = z.object({
  jobType: z.literal('RUN_CONVERSION_AUDIT'),
  ...QualityAuditPayloadFields,
}).strict();

export const RunBookingIntegrityAuditPayloadSchema = z.object({
  jobType: z.literal('RUN_BOOKING_INTEGRITY_AUDIT'),
  ...QualityAuditPayloadFields,
}).strict();

export const RunPerformanceAuditPayloadSchema = z.object({
  jobType: z.literal('RUN_PERFORMANCE_AUDIT'),
  ...QualityAuditPayloadFields,
}).strict();

export const RunContentIntegrityAuditPayloadSchema = z.object({
  jobType: z.literal('RUN_CONTENT_INTEGRITY_AUDIT'),
  ...QualityAuditPayloadFields,
}).strict();

export const RunAssetReadinessAuditPayloadSchema = z.object({
  jobType: z.literal('RUN_ASSET_READINESS_AUDIT'),
  ...QualityAuditPayloadFields,
}).strict();

export const EvaluatePublicationReadinessPayloadSchema = z.object({
  jobType: z.literal('EVALUATE_PUBLICATION_READINESS'),
  ...QualityAuditPayloadFields,
}).strict();

export const CreateSiteSnapshotPayloadSchema = VersionPayloadBase.extend({
  jobType: z.literal('CREATE_SITE_SNAPSHOT'),
  snapshotKind: z.enum(['PREVIEW', 'PUBLISHED']),
}).strict();

export const PreparePublicationPayloadSchema = VersionPayloadBase.extend({
  jobType: z.literal('PREPARE_PUBLICATION'),
}).strict();

export const VerifyDomainPayloadSchema = SitePayloadBase.extend({
  jobType: z.literal('VERIFY_DOMAIN'),
  domainReference: PublicReferenceSchema,
}).strict();

export const SyncAnalyticsPayloadSchema = SitePayloadBase.extend({
  jobType: z.literal('SYNC_ANALYTICS'),
  publishedVersionReference: PublicReferenceSchema,
}).strict();

export const CheckBookingLinksPayloadSchema = SitePayloadBase.extend({
  jobType: z.literal('CHECK_BOOKING_LINKS'),
  publishedVersionReference: PublicReferenceSchema,
}).strict();

export const GenerateMonthlyPageOpportunitiesPayloadSchema = SitePayloadBase.extend({
  jobType: z.literal('GENERATE_MONTHLY_PAGE_OPPORTUNITIES'),
  period: PeriodSchema,
}).strict();

export const GenerateMonthlyPagePayloadSchema = VersionPayloadBase.extend({
  jobType: z.literal('GENERATE_MONTHLY_PAGE'),
  opportunityReference: PublicReferenceSchema,
}).strict();

const TestPayloadBase = z.object({
  correlationReference: PublicReferenceSchema,
}).strict();

export const TestSucceedPayloadSchema = TestPayloadBase.extend({
  jobType: z.literal('TEST_SUCCEED'),
}).strict();

export const TestRetryableFailurePayloadSchema = TestPayloadBase.extend({
  jobType: z.literal('TEST_RETRYABLE_FAILURE'),
  retryAfterMs: z.number().int().min(1).max(60_000).optional(),
}).strict();

export const TestTerminalFailurePayloadSchema = TestPayloadBase.extend({
  jobType: z.literal('TEST_TERMINAL_FAILURE'),
}).strict();

export const TestLongRunningPayloadSchema = TestPayloadBase.extend({
  jobType: z.literal('TEST_LONG_RUNNING'),
  durationMs: z.number().int().min(1).max(60_000),
}).strict();

export const TestCancellablePayloadSchema = TestPayloadBase.extend({
  jobType: z.literal('TEST_CANCELLABLE'),
  durationMs: z.number().int().min(1).max(60_000),
}).strict();

export const SiteJobPayloadSchema = z.discriminatedUnion('jobType', [
  ProvisionWorkspacePayloadSchema,
  ImportTemplatePayloadSchema,
  ClassifyTemplatePayloadSchema,
  CreateBlueprintPayloadSchema,
  GenerateSitePayloadSchema,
  GeneratePagePayloadSchema,
  RegenerateSectionPayloadSchema,
  GenerateMetadataPayloadSchema,
  GenerateStructuredDataPayloadSchema,
  OptimiseImagePayloadSchema,
  RunSeoAuditPayloadSchema,
  RunUxAuditPayloadSchema,
  RunPhase158AccessibilityAuditPayloadSchema,
  RunPhase158ConversionAuditPayloadSchema,
  RunFullSiteQualityAuditPayloadSchema,
  RunTechnicalSeoAuditPayloadSchema,
  RunResponsiveUxAuditPayloadSchema,
  RunBookingIntegrityAuditPayloadSchema,
  RunPerformanceAuditPayloadSchema,
  RunContentIntegrityAuditPayloadSchema,
  RunAssetReadinessAuditPayloadSchema,
  EvaluatePublicationReadinessPayloadSchema,
  CreateSiteSnapshotPayloadSchema,
  PreparePublicationPayloadSchema,
  VerifyDomainPayloadSchema,
  SyncAnalyticsPayloadSchema,
  CheckBookingLinksPayloadSchema,
  GenerateMonthlyPageOpportunitiesPayloadSchema,
  GenerateMonthlyPagePayloadSchema,
  CreateSitePublicationPayloadSchema,
  ActivateFallbackDomainPayloadSchema,
  CreateCustomDomainPlanPayloadSchema,
  DiscoverCustomDomainDnsPayloadSchema,
  VerifyNameserverDelegationPayloadSchema,
  ConfigureCustomDomainDnsPayloadSchema,
  VerifyCustomDomainPayloadSchema,
  ActivateCustomDomainPayloadSchema,
  RunPublicationHealthChecksPayloadSchema,
  RollbackSitePublicationPayloadSchema,
  SuspendSiteDomainPayloadSchema,
  RemoveSiteDomainPayloadSchema,
  InvalidateSiteCachePayloadSchema,
  TestSucceedPayloadSchema,
  TestRetryableFailurePayloadSchema,
  TestTerminalFailurePayloadSchema,
  TestLongRunningPayloadSchema,
  TestCancellablePayloadSchema,
]);
export type SiteJobPayload = z.infer<typeof SiteJobPayloadSchema>;

export const SiteJobResultSchema = z.object({
  summary: z.string().trim().min(1).max(500),
  outputReferences: z.array(PublicReferenceSchema).max(50).default([]),
  metrics: z.record(z.number().finite()).default({}),
}).strict();
export type SiteJobResult = z.infer<typeof SiteJobResultSchema>;

export const SiteJobProgressSchema = z.object({
  current: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  message: z.string().trim().min(1).max(300).optional(),
}).strict().refine(value => value.current <= value.total, {
  message: 'Progress current cannot exceed total.',
  path: ['current'],
});
export type SiteJobProgress = z.infer<typeof SiteJobProgressSchema>;

export const SiteJobRetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(25),
  initialDelayMs: z.number().int().min(100).max(86_400_000),
  backoffMultiplier: z.number().min(1).max(10),
  maximumDelayMs: z.number().int().min(100).max(604_800_000),
  jitterRatio: z.number().min(0).max(0.5),
}).strict().refine(value => value.maximumDelayMs >= value.initialDelayMs, {
  message: 'Maximum retry delay must be at least the initial retry delay.',
});
export type SiteJobRetryPolicy = z.infer<typeof SiteJobRetryPolicySchema>;

export const SiteJobListQuerySchema = z.object({
  siteReference: PublicReferenceSchema.optional(),
  status: SiteJobStatusSchema.optional(),
  jobType: SiteJobTypeSchema.optional(),
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type SiteJobListQuery = z.infer<typeof SiteJobListQuerySchema>;

export const SiteJobActionReasonSchema = z.object({
  reason: z.string().trim().min(8).max(500),
}).strict();

export const SafeSiteJobSummarySchema = z.object({
  reference: PublicReferenceSchema,
  tenantReference: PublicReferenceSchema,
  siteReference: PublicReferenceSchema,
  versionReference: PublicReferenceSchema.nullable(),
  blueprintReference: PublicReferenceSchema.nullable(),
  jobType: SiteJobTypeSchema,
  status: SiteJobStatusSchema,
  priority: z.number().int(),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  progressCurrent: z.number().int().nonnegative(),
  progressTotal: z.number().int().positive().nullable(),
  progressMessage: z.string().nullable(),
  failureCode: SiteJobFailureCodeSchema.nullable(),
  failureMessage: z.string().nullable(),
  retryable: z.boolean().nullable(),
  scheduledFor: z.coerce.date(),
  availableAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
  failedAt: z.coerce.date().nullable(),
  cancelledAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).strict();
export type SafeSiteJobSummary = z.infer<typeof SafeSiteJobSummarySchema>;

export function parseSiteJobPayload(
  jobType: RegisteredSiteJobType,
  value: unknown,
): SiteJobPayload {
  const parsed = SiteJobPayloadSchema.parse(value);
  if (parsed.jobType !== jobType) {
    throw new Error('Stored job type does not match the payload discriminator.');
  }
  return parsed;
}
