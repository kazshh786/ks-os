import {
  PublicReferenceSchema,
  SiteConversionRoleSchema,
  SitePageTypeSchema,
} from '@ks-os/contracts';
import { SiteSectionTypeSchema } from '@ks-os/site-schema';
import { z } from 'zod';

export const KNOWLEDGE_SCHEMA_VERSION = 1 as const;

export const KnowledgePackStatusSchema = z.enum([
  'DRAFT',
  'IMPORTING',
  'REVIEW_REQUIRED',
  'READY_FOR_APPROVAL',
  'APPROVED',
  'ACTIVE',
  'RETIRED',
  'REJECTED',
  'SUPERSEDED',
]);
export type KnowledgePackStatus = z.infer<typeof KnowledgePackStatusSchema>;

export const KnowledgePackScopeSchema = z.enum(['PUBLIC_SITE']);
export type KnowledgePackScope = z.infer<typeof KnowledgePackScopeSchema>;

export const KnowledgeRuleScopeSchema = z.enum([
  'PUBLIC_SITE',
  'CONTENT_GENERATION',
  'SEO_AUDIT',
  'BOOKING_FLOW',
  'PLATFORM_SECURITY',
]);
export type KnowledgeRuleScope = z.infer<typeof KnowledgeRuleScopeSchema>;

export const KnowledgeDomainSchema = z.enum([
  'UX',
  'MOBILE',
  'ACCESSIBILITY',
  'TECHNICAL_SEO',
  'LOCAL_SEO',
  'CONTENT_SEO',
  'COPYWRITING',
  'CONVERSION',
  'TRUST',
  'BOOKING',
  'PERFORMANCE',
]);
export type KnowledgeDomain = z.infer<typeof KnowledgeDomainSchema>;

export const KnowledgePrioritySchema = z.enum([
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
]);
export type KnowledgePriority = z.infer<typeof KnowledgePrioritySchema>;

export const KnowledgeValidationTypeSchema = z.enum([
  'DETERMINISTIC',
  'AI_REVIEW',
  'HUMAN_REVIEW',
  'DATA_REQUIRED',
  'MIXED',
]);
export type KnowledgeValidationType = z.infer<typeof KnowledgeValidationTypeSchema>;

export const KnowledgePublicationEffectSchema = z.enum([
  'BLOCK',
  'WARNING',
  'RECOMMENDATION',
]);
export type KnowledgePublicationEffect = z.infer<typeof KnowledgePublicationEffectSchema>;

/**
 * Official requirements sit between platform code and expert guidance.
 * The two OFFICIAL_* values are required by the validated v3 platform export.
 */
export const KnowledgeEnforcementAuthoritySchema = z.enum([
  'PLATFORM',
  'OFFICIAL_STANDARD',
  'OFFICIAL_DOCUMENTATION',
  'EXPERT_APPROVED',
  'ADVISORY',
]);
export type KnowledgeEnforcementAuthority = z.infer<
  typeof KnowledgeEnforcementAuthoritySchema
>;

export const KnowledgeRuleStatusSchema = z.enum([
  'ACCEPTED',
  'REJECTED',
  'DEPRECATED',
]);
export type KnowledgeRuleStatus = z.infer<typeof KnowledgeRuleStatusSchema>;

export const KnowledgeSourceSupportSchema = z.enum([
  'DIRECT',
  'SYNTHESISED',
  'INFERRED',
]);
export type KnowledgeSourceSupport = z.infer<typeof KnowledgeSourceSupportSchema>;

export const KnowledgeSourceStrengthSchema = z.enum([
  'STRONG',
  'MODERATE',
  'LIMITED',
]);
export type KnowledgeSourceStrength = z.infer<typeof KnowledgeSourceStrengthSchema>;

export const KnowledgeEvidenceAuthoritySchema = z.enum([
  'PLATFORM_POLICY',
  'OFFICIAL_STANDARD',
  'OFFICIAL_PRODUCT_DOCUMENTATION',
  'EXPERT_BOOK',
  'PROFESSIONAL_GUIDANCE',
  'AI_SYNTHESIS',
]);

export const KnowledgeTemporalClassSchema = z.enum([
  'STABLE',
  'SLOW_CHANGING',
  'TIME_SENSITIVE',
  'EXPERIMENTAL',
]);

export const KnowledgeSourceTypeSchema = z.enum([
  'ARTICLE',
  'BOOK',
  'DOCUMENTATION',
  'INTERNAL_POLICY',
  'OFFICIAL_DOCUMENTATION',
  'REPORT',
  'STANDARD',
  'WEBSITE',
]);

/**
 * Source cataloguing topics are deliberately broader than rule domains.
 * They describe provenance rather than becoming selectable rule domains.
 */
export const KnowledgeSourceTopicSchema = z.enum([
  'ACCESSIBILITY',
  'AI',
  'BRAND_STRATEGY',
  'BUSINESS_STRATEGY',
  'COPYWRITING',
  'CRAWLING',
  'MARKETING',
  'METADATA',
  'PERFORMANCE',
  'PLATFORM_ARCHITECTURE',
  'PSYCHOLOGY',
  'REVIEWS',
  'SALES',
  'SALES_STRATEGY',
  'SEO',
  'SITEMAPS',
  'STRUCTURED_DATA',
  'TECHNICAL_SEO',
  'UX',
  'UX_DESIGN',
  'UX_RESEARCH',
  'VARIOUS',
]);

export const KnowledgePlaybookRequirementSchema = z.enum([
  'REQUIRED',
  'RECOMMENDED',
  'OPTIONAL',
  'CONDITIONAL',
  'PROHIBITED',
]);

export const KnowledgeCtaTypeSchema = z.enum([
  'KS_OS_BOOKING',
  'INTERNAL_PAGE',
  'PHONE',
  'EMAIL',
  'GET_DIRECTIONS',
  'READ_REVIEWS',
]);

export const KnowledgeFindingSeveritySchema = z.enum([
  'ERROR',
  'WARNING',
  'REVIEW',
]);

export const KnowledgeConflictSeveritySchema = z.enum([
  'CRITICAL',
  'HIGH',
  'MEDIUM',
]);

export const KnowledgeConflictTypeSchema = z.enum([
  'PRIORITY_MISMATCH',
  'PUBLICATION_EFFECT_MISMATCH',
  'REQUIRED_PROHIBITED_SECTION',
  'EXTERNAL_BOOKING',
  'ACCESSIBILITY_ANIMATION',
  'URGENCY_TRUST',
  'SEO_THIN_CONTENT',
  'UNSUPPORTED_CLAIM',
  'MUTUALLY_EXCLUSIVE_INSTRUCTIONS',
]);

export const KnowledgeImportFormatSchema = z.enum(['CSV', 'JSON']);

const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  value => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)),
  'Date must be a real ISO calendar date.',
);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const StableIdentifierSchema = z.string()
  .min(3)
  .max(120)
  .regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/);
const SafeInstructionSchema = z.string().trim().min(1).max(2_000);
const SafeOptionalInstructionSchema = z.string().trim().min(1).max(2_000).optional();
const StableStringListSchema = z.array(
  z.string().trim().min(1).max(240),
).max(100).default([]);

export const KnowledgeSourceSchema = z.object({
  sourceId: StableIdentifierSchema,
  sourceTitle: z.string().trim().min(1).max(300),
  author: z.string().trim().min(1).max(240).optional(),
  editionOrVersion: z.string().trim().min(1).max(120).optional(),
  sourceType: KnowledgeSourceTypeSchema,
  topicDomains: z.array(KnowledgeSourceTopicSchema).min(1).max(30),
  evidenceAuthority: KnowledgeEvidenceAuthoritySchema,
  supportCapability: KnowledgeSourceSupportSchema,
  strengthOfSupport: KnowledgeSourceStrengthSchema.optional(),
  temporalClass: KnowledgeTemporalClassSchema,
  citationLocations: StableStringListSchema,
  copyrightNotes: z.string().trim().max(500).optional(),
  verifiedAt: DateOnlySchema.optional(),
  reviewDueAt: DateOnlySchema.optional(),
  reviewNotes: z.string().trim().max(1_000).optional(),
  contentDigest: Sha256Schema,
}).strict();
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;

export const KnowledgeRuleSchema = z.object({
  ruleId: StableIdentifierSchema,
  ruleName: z.string().trim().min(1).max(240),
  ruleScope: KnowledgeRuleScopeSchema,
  domain: KnowledgeDomainSchema,
  subcategory: z.string().trim().min(1).max(120),
  principle: z.string().trim().min(1).max(1_200),
  whyItMatters: z.string().trim().min(1).max(1_500).optional(),
  implementationInstruction: SafeInstructionSchema,
  applicablePageTypes: z.array(SitePageTypeSchema).max(16).default([]),
  applicableSectionTypes: z.array(SiteSectionTypeSchema).max(24).default([]),
  conversionRoles: z.array(SiteConversionRoleSchema).max(6).default([]),
  priority: KnowledgePrioritySchema,
  validationType: KnowledgeValidationTypeSchema,
  publicationEffect: KnowledgePublicationEffectSchema,
  enforcementAuthority: KnowledgeEnforcementAuthoritySchema,
  requiredBusinessData: StableStringListSchema,
  prohibitedBehaviour: SafeOptionalInstructionSchema,
  antiPattern: z.string().trim().min(1).max(1_500).optional(),
  deterministicTestDescription: SafeOptionalInstructionSchema,
  aiReviewInstruction: SafeOptionalInstructionSchema,
  humanReviewInstruction: SafeOptionalInstructionSchema,
  sourceIds: z.array(StableIdentifierSchema).max(50).default([]),
  supportType: KnowledgeSourceSupportSchema.optional(),
  temporalClass: KnowledgeTemporalClassSchema,
  verificationSourceIds: z.array(StableIdentifierSchema).max(50).default([]),
  verifiedAt: DateOnlySchema.optional(),
  reviewDueAt: DateOnlySchema.optional(),
  confidence: z.number().min(0).max(1),
  notes: z.string().trim().max(1_000).optional(),
  status: KnowledgeRuleStatusSchema.default('ACCEPTED'),
  contentDigest: Sha256Schema,
}).strict();
export type KnowledgeRule = z.infer<typeof KnowledgeRuleSchema>;

export const KnowledgeSectionPlaybookSchema = z.object({
  sectionType: SiteSectionTypeSchema,
  sectionOrderMin: z.number().int().min(0).max(100),
  sectionOrderMax: z.number().int().min(0).max(100),
  requirement: KnowledgePlaybookRequirementSchema,
  userIntent: z.string().trim().min(1).max(1_000),
  businessObjective: z.string().trim().min(1).max(1_000).optional(),
  sectionPurpose: z.string().trim().min(1).max(1_000),
  requiredBusinessData: StableStringListSchema,
  copyInstruction: SafeOptionalInstructionSchema,
  seoInstruction: SafeOptionalInstructionSchema,
  trustInstruction: SafeOptionalInstructionSchema,
  bookingInstruction: SafeOptionalInstructionSchema,
  mobileInstruction: SafeOptionalInstructionSchema,
  accessibilityInstruction: SafeOptionalInstructionSchema,
  allowedPrimaryCtaTypes: z.array(KnowledgeCtaTypeSchema).max(10).default([]),
  allowedSecondaryCtaTypes: z.array(KnowledgeCtaTypeSchema).max(10).default([]),
  blockingConditions: StableStringListSchema,
  commonAntiPatterns: StableStringListSchema,
  ruleIds: z.array(StableIdentifierSchema).max(50).default([]),
  sourceIds: z.array(StableIdentifierSchema).max(50).default([]),
  confidence: z.number().min(0).max(1),
  notes: z.string().trim().max(1_000).optional(),
  contentDigest: Sha256Schema,
}).strict().refine(
  value => value.sectionOrderMax >= value.sectionOrderMin,
  {
    message: 'Section order maximum must be at least the minimum.',
    path: ['sectionOrderMax'],
  },
);
export type KnowledgeSectionPlaybook = z.infer<
  typeof KnowledgeSectionPlaybookSchema
>;

export const KnowledgePagePlaybookSchema = z.object({
  pageType: SitePageTypeSchema,
  conversionRole: SiteConversionRoleSchema,
  sections: z.array(KnowledgeSectionPlaybookSchema).min(1).max(100),
  contentDigest: Sha256Schema,
}).strict();
export type KnowledgePagePlaybook = z.infer<typeof KnowledgePagePlaybookSchema>;

export const RejectedKnowledgeRuleSchema = z.object({
  ruleId: StableIdentifierSchema,
  ruleName: z.string().trim().min(1).max(240),
  rejectionReason: z.string().trim().min(1).max(1_000),
}).strict();
export type RejectedKnowledgeRule = z.infer<typeof RejectedKnowledgeRuleSchema>;

export const KnowledgeImportBundleSchema = z.object({
  pack: z.object({
    name: z.string().trim().min(2).max(200),
    description: z.string().trim().max(2_000).optional(),
    semanticVersion: z.string()
      .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
    intendedScope: KnowledgePackScopeSchema,
    schemaVersion: z.literal(KNOWLEDGE_SCHEMA_VERSION),
  }).strict(),
  sources: z.array(KnowledgeSourceSchema).max(5_000),
  rules: z.array(KnowledgeRuleSchema).max(20_000),
  pagePlaybooks: z.array(KnowledgePagePlaybookSchema).max(500),
  rejectedRules: z.array(RejectedKnowledgeRuleSchema).max(5_000).default([]),
  sourceDigest: Sha256Schema,
}).strict();
export type KnowledgeImportBundle = z.infer<typeof KnowledgeImportBundleSchema>;

export const KnowledgeImportFindingSchema = z.object({
  severity: KnowledgeFindingSeveritySchema,
  category: z.enum([
    'SCHEMA',
    'DUPLICATE',
    'PROVENANCE',
    'COPYRIGHT',
    'CONFLICT',
    'BOOKING',
    'BUSINESS_DATA',
    'PLAYBOOK',
    'GOVERNANCE',
  ]),
  code: StableIdentifierSchema,
  message: z.string().trim().min(1).max(500),
  blocksApproval: z.boolean(),
  ruleId: StableIdentifierSchema.optional(),
  sourceId: StableIdentifierSchema.optional(),
  pageType: SitePageTypeSchema.optional(),
  sectionType: SiteSectionTypeSchema.optional(),
}).strict();
export type KnowledgeImportFinding = z.infer<
  typeof KnowledgeImportFindingSchema
>;

export const KnowledgeConflictSchema = z.object({
  conflictType: KnowledgeConflictTypeSchema,
  severity: KnowledgeConflictSeveritySchema,
  summary: z.string().trim().min(1).max(500),
  ruleIds: z.array(StableIdentifierSchema).max(20).default([]),
  pageType: SitePageTypeSchema.optional(),
  sectionType: SiteSectionTypeSchema.optional(),
  resolved: z.boolean().default(false),
}).strict();
export type KnowledgeConflict = z.infer<typeof KnowledgeConflictSchema>;

export const KnowledgeValidationReportSchema = z.object({
  valid: z.boolean(),
  readyForApproval: z.boolean(),
  findings: z.array(KnowledgeImportFindingSchema),
  conflicts: z.array(KnowledgeConflictSchema),
  counts: z.object({
    sources: z.number().int().nonnegative(),
    rules: z.number().int().nonnegative(),
    pagePlaybooks: z.number().int().nonnegative(),
    sectionPlaybooks: z.number().int().nonnegative(),
    rejectedRules: z.number().int().nonnegative(),
  }).strict(),
  contentDigest: Sha256Schema,
}).strict();
export type KnowledgeValidationReport = z.infer<
  typeof KnowledgeValidationReportSchema
>;

export const CreateKnowledgePackSchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2_000).optional(),
  semanticVersion: z.string()
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  intendedScope: KnowledgePackScopeSchema,
}).strict();

export const UpdateKnowledgePackSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, {
  message: 'At least one pack field is required.',
});

export const UpdateKnowledgeRuleSchema = KnowledgeRuleSchema.omit({
  ruleId: true,
  contentDigest: true,
}).partial().strict().refine(value => Object.keys(value).length > 0, {
  message: 'At least one rule field is required.',
});

export const KnowledgePackActionSchema = z.object({
  reason: z.string().trim().min(8).max(500),
}).strict();

export const ReviseKnowledgePackSchema = z.object({
  semanticVersion: z.string()
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  reason: z.string().trim().min(8).max(500),
}).strict();

export const ResolveKnowledgeConflictSchema = z.object({
  resolution: z.enum(['RESOLVED', 'DISMISSED']),
  reason: z.string().trim().min(8).max(1_000),
}).strict();

export const KnowledgePackListQuerySchema = z.object({
  status: KnowledgePackStatusSchema.optional(),
  intendedScope: KnowledgePackScopeSchema.optional(),
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export { PublicReferenceSchema, SiteConversionRoleSchema, SitePageTypeSchema, SiteSectionTypeSchema };
