import { z } from 'zod';

export const PublicationReasonSchema = z.enum([
  'INITIAL_PUBLICATION',
  'CONTENT_UPDATE',
  'SEO_PAGE_PUBLICATION',
  'MANUAL_REPUBLICATION',
  'ROLLBACK',
  'DOMAIN_ACTIVATION_RECHECK',
]);
export type PublicationReason = z.infer<typeof PublicationReasonSchema>;

export const PublicationStatusSchema = z.enum([
  'REQUESTED',
  'VALIDATING',
  'SNAPSHOTTING',
  'ACTIVATING_HOSTNAMES',
  'SWITCHING_POINTER',
  'INVALIDATING_CACHE',
  'HEALTH_CHECKING',
  'LIVE',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'ROLLING_BACK',
  'ROLLED_BACK',
  'SUPERSEDED',
]);
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;

export const SiteDomainTypeSchema = z.enum(['FALLBACK', 'CUSTOM']);
export const SiteDomainRoleSchema = z.enum(['CANONICAL', 'ALIAS', 'FALLBACK']);
export const SiteDomainStatusSchema = z.enum([
  'RESERVED',
  'DNS_DISCOVERY_PENDING',
  'DNS_REVIEW_REQUIRED',
  'NAMESERVER_ACTION_REQUIRED',
  'NAMESERVER_CHECK_PENDING',
  'VERIFYING',
  'VERIFIED',
  'SSL_PENDING',
  'ACTIVATING',
  'ACTIVE',
  'DEGRADED',
  'FAILED',
  'SUSPENDED',
  'REMOVED',
]);
export type SiteDomainStatus = z.infer<typeof SiteDomainStatusSchema>;

export const ProviderOperationStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'RETRY_DELAY',
  'FAILED',
  'COMPENSATING',
  'COMPENSATED',
  'CANCELLED',
]);

const PublicReferenceSchema = z.string().uuid();
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const CreateSitePublicationPayloadSchema = z.object({
  jobType: z.literal('CREATE_SITE_PUBLICATION'),
  siteReference: PublicReferenceSchema,
  siteVersionReference: PublicReferenceSchema,
  qualityRunReference: PublicReferenceSchema,
  publicationRunReference: PublicReferenceSchema,
  requestedByAgencyUserReference: PublicReferenceSchema,
  reason: PublicationReasonSchema.exclude(['ROLLBACK', 'DOMAIN_ACTIVATION_RECHECK']),
  acknowledgeWarnings: z.boolean(),
}).strict();

const DomainJobBase = z.object({
  siteReference: PublicReferenceSchema,
  domainReference: PublicReferenceSchema,
  requestedByAgencyUserReference: PublicReferenceSchema,
}).strict();

export const ActivateFallbackDomainPayloadSchema = DomainJobBase.extend({
  jobType: z.literal('ACTIVATE_FALLBACK_DOMAIN'),
}).strict();
export const CreateCustomDomainPlanPayloadSchema = DomainJobBase.extend({
  jobType: z.literal('CREATE_CUSTOM_DOMAIN_PLAN'),
}).strict();
export const DiscoverCustomDomainDnsPayloadSchema = DomainJobBase.extend({
  jobType: z.literal('DISCOVER_CUSTOM_DOMAIN_DNS'),
}).strict();
export const VerifyNameserverDelegationPayloadSchema = DomainJobBase.extend({
  jobType: z.literal('VERIFY_NAMESERVER_DELEGATION'),
}).strict();
export const ConfigureCustomDomainDnsPayloadSchema = DomainJobBase.extend({
  jobType: z.literal('CONFIGURE_CUSTOM_DOMAIN_DNS'),
  dnsPlanReference: PublicReferenceSchema,
}).strict();
export const VerifyCustomDomainPayloadSchema = DomainJobBase.extend({
  jobType: z.literal('VERIFY_CUSTOM_DOMAIN'),
}).strict();
export const ActivateCustomDomainPayloadSchema = DomainJobBase.extend({
  jobType: z.literal('ACTIVATE_CUSTOM_DOMAIN'),
}).strict();
export const RunPublicationHealthChecksPayloadSchema = DomainJobBase.extend({
  jobType: z.literal('RUN_PUBLICATION_HEALTH_CHECKS'),
  publicationRunReference: PublicReferenceSchema,
  expectedSnapshotReference: PublicReferenceSchema,
}).strict();
export const SuspendSiteDomainPayloadSchema = DomainJobBase.extend({
  jobType: z.literal('SUSPEND_SITE_DOMAIN'),
  reason: z.string().trim().min(8).max(500),
}).strict();
export const RemoveSiteDomainPayloadSchema = DomainJobBase.extend({
  jobType: z.literal('REMOVE_SITE_DOMAIN'),
  confirmation: z.literal('REMOVE_MANAGED_DOMAIN'),
}).strict();
export const InvalidateSiteCachePayloadSchema = z.object({
  jobType: z.literal('INVALIDATE_SITE_CACHE'),
  siteReference: PublicReferenceSchema,
  publicationRunReference: PublicReferenceSchema,
  snapshotReference: PublicReferenceSchema,
}).strict();
export const RollbackSitePublicationPayloadSchema = z.object({
  jobType: z.literal('ROLLBACK_SITE_PUBLICATION'),
  siteReference: PublicReferenceSchema,
  publicationRunReference: PublicReferenceSchema,
  targetSnapshotReference: PublicReferenceSchema,
  requestedByAgencyUserReference: PublicReferenceSchema,
  reason: z.string().trim().min(8).max(500),
}).strict();

export const PublicationJobPayloadSchema = z.discriminatedUnion('jobType', [
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
]);
export type PublicationJobPayload = z.infer<typeof PublicationJobPayloadSchema>;

export const PublicationPinSchema = z.object({
  siteReference: PublicReferenceSchema,
  siteVersionReference: PublicReferenceSchema,
  siteVersionDigestSha256: DigestSchema,
  qualityRunReference: PublicReferenceSchema,
  qualityPolicyVersion: z.string().trim().min(1).max(100),
  knowledgePackReference: PublicReferenceSchema,
  knowledgePackSemanticVersion: z.string().trim().min(1).max(50),
  knowledgePackDigestSha256: DigestSchema,
  templateVersionReference: PublicReferenceSchema,
  rendererVersion: z.string().trim().min(1).max(100),
  snapshotSchemaVersion: z.number().int().positive(),
}).strict();
export type PublicationPin = z.infer<typeof PublicationPinSchema>;

export const WarningAcknowledgementSchema = z.object({
  siteVersionDigestSha256: DigestSchema,
  qualityRunReference: PublicReferenceSchema,
  acknowledgedByAgencyUserReference: PublicReferenceSchema,
  acknowledgedAt: z.string().datetime(),
  warningCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,99}$/)).max(100),
}).strict();
export type WarningAcknowledgement = z.infer<typeof WarningAcknowledgementSchema>;
