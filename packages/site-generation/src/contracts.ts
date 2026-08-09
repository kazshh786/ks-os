import {
  PublicReferenceSchema,
  SiteConversionRoleSchema,
  SitePageTypeSchema,
  SiteSlugSchema,
} from '@ks-os/contracts';
import {
  SiteDesignTokensV2Schema,
  SiteSectionSchema,
  SiteSectionTypeSchema,
  SiteSeoMetadataSchema,
} from '@ks-os/site-schema';
import { z } from 'zod';

export const SITE_GENERATOR_VERSION = '2.0.0' as const;
export const SITE_GENERATION_PROMPT_TEMPLATE_VERSION = '2.0.0' as const;

export const SiteGenerationRunStatusSchema = z.enum([
  'PENDING',
  'PREPARING_CONTEXT',
  'GENERATING',
  'VALIDATING',
  'REPAIRING',
  'DESIGN_COMPLETE',
  'READY_FOR_REVIEW',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'SUPERSEDED',
]);
export type SiteGenerationRunStatus = z.infer<typeof SiteGenerationRunStatusSchema>;

export const SiteGenerationReasonSchema = z.enum([
  'INITIAL_SITE',
  'BLUEPRINT_REVISION',
]);

export const FactStatusSchema = z.enum([
  'VERIFIED',
  'AGENCY_CONFIRMED',
  'TENANT_CONFIRMED',
  'UNVERIFIED',
  'UNKNOWN',
  'NOT_APPLICABLE',
]);
export type FactStatus = z.infer<typeof FactStatusSchema>;

const PublicFactSchema = z.object({
  key: z.string().trim().min(1).max(120).regex(/^[a-z][a-z0-9_.-]*$/),
  value: z.union([z.string().max(2_000), z.number().finite(), z.boolean()]),
  status: FactStatusSchema,
}).strict();

const PublicEntityFactSchema = z.object({
  publicReference: PublicReferenceSchema,
  facts: z.array(PublicFactSchema).max(100),
}).strict();

export const SiteAssetClassSchema = z.enum([
  'LOGO', 'BRAND', 'SERVICE', 'STAFF', 'LOCATION', 'GALLERY', 'RESULT', 'DECORATIVE',
]);
export type SiteAssetClass = z.infer<typeof SiteAssetClassSchema>;

export const ApprovedGenerationAssetSchema = z.object({
  publicReference: PublicReferenceSchema,
  assetClass: SiteAssetClassSchema,
  entityReference: PublicReferenceSchema.optional(),
  width: z.number().int().positive().max(20_000).optional(),
  height: z.number().int().positive().max(20_000).optional(),
  alt: z.string().trim().min(1).max(500).optional(),
  approved: z.literal(true),
}).strict();
export type ApprovedGenerationAsset = z.infer<typeof ApprovedGenerationAssetSchema>;

export const VerifiedBusinessFactsSchema = z.object({
  businessReference: PublicReferenceSchema,
  business: z.array(PublicFactSchema).max(100),
  services: z.array(PublicEntityFactSchema).max(500),
  locations: z.array(PublicEntityFactSchema).max(100),
  staff: z.array(PublicEntityFactSchema).max(500),
  policies: z.array(PublicFactSchema).max(100),
  brand: z.array(PublicFactSchema).max(100),
  assetReferences: z.array(PublicReferenceSchema).max(500),
  approvedAssets: z.array(ApprovedGenerationAssetSchema).max(2_000).default([]),
}).strict();
export type VerifiedBusinessFacts = z.infer<typeof VerifiedBusinessFactsSchema>;

export const GenerationClaimTypeSchema = z.enum([
  'BUSINESS_IDENTITY',
  'SERVICE_AVAILABILITY',
  'SERVICE_PRICE',
  'SERVICE_DURATION',
  'STAFF_CREDENTIAL',
  'YEARS_EXPERIENCE',
  'LOCATION',
  'OPENING_HOURS',
  'QUALIFICATION',
  'GUARANTEE',
  'RESULT',
  'TESTIMONIAL',
  'REVIEW',
  'AWARD',
  'SAFETY',
  'HEALTH_OR_TREATMENT_CLAIM',
  'COMPARATIVE_CLAIM',
  'SUPERLATIVE_CLAIM',
]);
export const GenerationClaimStatusSchema = z.enum([
  'GROUNDED',
  'REQUIRES_REVIEW',
  'UNSUPPORTED',
  'PROHIBITED',
  'NOT_APPLICABLE',
]);
export const GeneratedClaimSchema = z.object({
  claimType: GenerationClaimTypeSchema,
  claimText: z.string().trim().min(1).max(1_000),
  status: GenerationClaimStatusSchema,
  factKeys: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
}).strict();
export type GeneratedClaim = z.infer<typeof GeneratedClaimSchema>;

export const GenerationFindingSchema = z.object({
  severity: z.enum(['ERROR', 'WARNING', 'REVIEW']),
  category: z.enum([
    'FACT', 'CLAIM', 'KNOWLEDGE', 'TEMPLATE', 'BOOKING', 'LINK',
    'DUPLICATE', 'METADATA', 'STRUCTURED_DATA', 'PROVIDER', 'SCHEMA',
    'COMPLETENESS', 'DESIGN', 'ASSET', 'BROWSER', 'ACCESSIBILITY',
  ]),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,99}$/),
  message: z.string().trim().min(1).max(1_000),
  targetReference: PublicReferenceSchema.optional(),
}).strict();
export type GenerationFinding = z.infer<typeof GenerationFindingSchema>;

export const AssetRequirementSchema = z.object({
  purpose: z.enum(['HERO', 'SERVICE', 'LOCATION', 'STAFF', 'GALLERY', 'SOCIAL']),
  description: z.string().trim().min(1).max(500),
  required: z.boolean(),
}).strict();

export const AssetCoverageAssignmentSchema = z.object({
  pageReference: PublicReferenceSchema,
  sectionType: SiteSectionTypeSchema,
  componentKey: z.string().trim().min(1).max(120),
  slot: z.enum([
    'LOGO', 'PRIMARY_IMAGE', 'SECONDARY_IMAGE', 'PORTRAIT', 'LOCATION_IMAGE',
    'GALLERY_SET', 'RESULT_PAIR', 'DECORATIVE_IMAGE',
  ]),
  assetReference: PublicReferenceSchema.optional(),
  placeholderCode: z.enum([
    'SERVICE_IMAGE_REQUIRED', 'STAFF_PORTRAIT_REQUIRED', 'LOCATION_IMAGE_REQUIRED',
    'GALLERY_ASSET_REQUIRED', 'RESULT_ASSET_REQUIRED', 'BRAND_IMAGE_REQUIRED',
  ]).optional(),
}).strict().superRefine((assignment, context) => {
  if ((assignment.assetReference ? 1 : 0) + (assignment.placeholderCode ? 1 : 0) !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'An asset assignment requires exactly one approved asset or preview placeholder.',
    });
  }
});

export const AssetCoveragePlanSchema = z.object({
  inventory: z.array(ApprovedGenerationAssetSchema).max(2_000),
  assignments: z.array(AssetCoverageAssignmentSchema).max(2_000),
  uncoveredRequirements: z.array(z.object({
    pageReference: PublicReferenceSchema,
    componentKey: z.string().trim().min(1).max(120),
    slot: z.string().trim().min(1).max(80),
    placeholderCode: z.string().trim().min(1).max(100),
  }).strict()).max(2_000),
}).strict();
export type AssetCoveragePlan = z.infer<typeof AssetCoveragePlanSchema>;

export const SiteCompositionStrategySchema = z.object({
  brandMood: z.string().trim().min(10).max(500),
  visualDirection: z.string().trim().min(10).max(500),
  typographicIntent: z.string().trim().min(10).max(500),
  spacingIntent: z.string().trim().min(10).max(500),
  imageStrategy: z.string().trim().min(10).max(500),
  surfaceStrategy: z.string().trim().min(10).max(500),
  heroStrategy: z.string().trim().min(10).max(500),
  cardStrategy: z.string().trim().min(10).max(500),
  conversionStrategy: z.string().trim().min(10).max(500),
  trustStrategy: z.string().trim().min(10).max(500),
  pageRhythm: z.string().trim().min(10).max(500),
  sectionDiversityStrategy: z.string().trim().min(10).max(500),
  mobileStrategy: z.string().trim().min(10).max(500),
  recommendedDesignTokens: SiteDesignTokensV2Schema,
}).strict();
export type SiteCompositionStrategy = z.infer<typeof SiteCompositionStrategySchema>;

export const PageComponentSelectionSchema = z.object({
  sectionType: SiteSectionTypeSchema,
  componentKey: z.string().trim().min(1).max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/),
  purpose: z.string().trim().min(5).max(500),
  dataBindings: z.array(z.enum([
    'BUSINESS', 'SERVICES', 'LOCATIONS', 'STAFF', 'BOOKING', 'TESTIMONIALS',
    'GALLERY', 'RESULTS', 'OPENING_HOURS', 'CONTACT', 'POLICIES',
  ])).max(12),
  assetAssignments: z.array(z.object({
    slot: z.enum([
      'LOGO', 'PRIMARY_IMAGE', 'SECONDARY_IMAGE', 'PORTRAIT', 'LOCATION_IMAGE',
      'GALLERY_SET', 'RESULT_PAIR', 'DECORATIVE_IMAGE',
    ]),
    assetReference: PublicReferenceSchema.optional(),
    placeholderCode: z.enum([
      'SERVICE_IMAGE_REQUIRED', 'STAFF_PORTRAIT_REQUIRED', 'LOCATION_IMAGE_REQUIRED',
      'GALLERY_ASSET_REQUIRED', 'RESULT_ASSET_REQUIRED', 'BRAND_IMAGE_REQUIRED',
    ]).optional(),
  }).strict().superRefine((assignment, context) => {
    if ((assignment.assetReference ? 1 : 0) + (assignment.placeholderCode ? 1 : 0) !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A planned asset slot requires exactly one approved asset or controlled placeholder.',
      });
    }
  })).max(12),
}).strict();

export const PageCompositionPlanSchema = z.object({
  pageReference: PublicReferenceSchema,
  pagePurpose: z.string().trim().min(10).max(800),
  conversionGoal: z.string().trim().min(10).max(500),
  contentNarrative: z.string().trim().min(10).max(1_000),
  selectedComponents: z.array(PageComponentSelectionSchema).min(1).max(100),
  internalLinkIntent: z.array(z.object({
    targetPageReference: PublicReferenceSchema,
    intent: z.string().trim().min(5).max(300),
  }).strict()).max(100),
  ctaIntent: z.string().trim().min(10).max(500),
  designExemption: z.object({
    code: z.string().trim().min(3).max(100),
    rationale: z.string().trim().min(20).max(500),
  }).strict().optional(),
}).strict();
export type PageCompositionPlan = z.infer<typeof PageCompositionPlanSchema>;

export const PageCompletenessStateSchema = z.enum([
  'SCHEMA_VALID', 'GENERATION_COMPLETE', 'DESIGN_COMPLETE', 'READY_FOR_REVIEW', 'PUBLICATION_READY',
]);
export type PageCompletenessState = z.infer<typeof PageCompletenessStateSchema>;

export const InternalLinkSuggestionSchema = z.object({
  targetPageReference: PublicReferenceSchema,
  anchorText: z.string().trim().min(1).max(120),
}).strict();

export const StructuredDataInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('LOCAL_BUSINESS'),
    businessName: z.string().trim().min(1).max(160),
    locationReference: PublicReferenceSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('SERVICE'),
    serviceReference: PublicReferenceSchema,
    serviceName: z.string().trim().min(1).max(160),
  }).strict(),
  z.object({
    type: z.literal('FAQ'),
    items: z.array(z.object({
      question: z.string().trim().min(1).max(240),
      answer: z.string().trim().min(1).max(2_000),
    }).strict()).min(1).max(50),
  }).strict(),
  z.object({
    type: z.literal('BREADCRUMB'),
    pageReferences: z.array(PublicReferenceSchema).min(1).max(20),
  }).strict(),
]);

export const GeneratedPageSchema = z.object({
  pageReference: PublicReferenceSchema,
  title: z.string().trim().min(1).max(160),
  navigationLabel: z.string().trim().min(1).max(80),
  slug: SiteSlugSchema,
  pageType: SitePageTypeSchema,
  conversionRole: SiteConversionRoleSchema,
  layoutReference: PublicReferenceSchema,
  seo: SiteSeoMetadataSchema,
  sections: z.array(SiteSectionSchema).min(1).max(100),
  internalLinks: z.array(InternalLinkSuggestionSchema).max(100).default([]),
  structuredDataInputs: z.array(StructuredDataInputSchema).max(100).default([]),
  assetRequirements: z.array(AssetRequirementSchema).max(100).default([]),
  missingDataFindings: z.array(GenerationFindingSchema).max(100).default([]),
  claims: z.array(GeneratedClaimSchema).max(500).default([]),
}).strict();
export type GeneratedPage = z.infer<typeof GeneratedPageSchema>;

export const GeneratedSectionSchema = z.object({
  pageReference: PublicReferenceSchema,
  sectionReference: PublicReferenceSchema,
  section: SiteSectionSchema,
  missingDataFindings: z.array(GenerationFindingSchema).max(50).default([]),
  claims: z.array(GeneratedClaimSchema).max(100).default([]),
}).strict();
export type GeneratedSection = z.output<typeof GeneratedSectionSchema>;

export const GeneratedMetadataSchema = z.object({
  pageReference: PublicReferenceSchema,
  seo: SiteSeoMetadataSchema,
}).strict();
export type GeneratedMetadata = z.output<typeof GeneratedMetadataSchema>;

export const GeneratedStructuredDataSchema = z.object({
  pageReference: PublicReferenceSchema,
  inputs: z.array(StructuredDataInputSchema).max(100),
}).strict();
export type GeneratedStructuredData = z.output<typeof GeneratedStructuredDataSchema>;

export const BlueprintGenerationPageSchema = z.object({
  blueprintPageReference: PublicReferenceSchema,
  pageReference: PublicReferenceSchema,
  title: z.string().trim().min(1).max(160),
  slug: SiteSlugSchema,
  pageType: SitePageTypeSchema,
  conversionRole: SiteConversionRoleSchema,
  layoutReference: PublicReferenceSchema,
  plannedSectionTypes: z.array(SiteSectionTypeSchema).min(1).max(100),
}).strict();

export const GenerationPlanSchema = z.object({
  siteReference: PublicReferenceSchema,
  blueprintReference: PublicReferenceSchema,
  blueprintRevision: z.number().int().positive(),
  templateVersionReference: PublicReferenceSchema,
  knowledgePackReference: PublicReferenceSchema,
  knowledgePackSemanticVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  pages: z.array(BlueprintGenerationPageSchema).min(1).max(100),
}).strict();
export type GenerationPlan = z.infer<typeof GenerationPlanSchema>;

export const TemplateGenerationConstraintSchema = z.object({
  templateVersionReference: PublicReferenceSchema,
  templateSourceType: z.enum(['ENVATO_HTML', 'GOOGLE_STITCH', 'INTERNAL']),
  templateVersionStatus: z.literal('APPROVED'),
  licenceStatus: z.enum(['ACTIVE', 'NOT_REQUIRED']),
  layoutReference: PublicReferenceSchema,
  layoutStatus: z.literal('APPROVED'),
  compatiblePageTypes: z.array(SitePageTypeSchema).min(1),
  rendererKey: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/),
  rendererVersion: z.number().int().positive(),
  rendererStatus: z.literal('READY'),
  requiredSectionTypes: z.array(SiteSectionTypeSchema).max(100).default([]),
  prohibitedSectionTypes: z.array(SiteSectionTypeSchema).max(100).default([]),
  sectionOrder: z.array(SiteSectionTypeSchema).max(100).default([]),
  componentRegistryVersion: z.number().int().positive().default(1),
  availableComponentKeys: z.array(z.string().trim().min(1).max(120)).max(500).default([]),
}).strict();
export type TemplateGenerationConstraint = z.infer<typeof TemplateGenerationConstraintSchema>;

export const GenerationProvenanceSchema = z.object({
  generationRunReference: PublicReferenceSchema,
  blueprintReference: PublicReferenceSchema,
  blueprintRevision: z.number().int().positive(),
  templateVersionReference: PublicReferenceSchema,
  layoutReferences: z.array(PublicReferenceSchema).min(1),
  rendererKeys: z.array(z.string().min(1).max(120)).min(1),
  knowledgePackReference: PublicReferenceSchema,
  knowledgePackSemanticVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  knowledgeContextDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  generatorVersion: z.string().min(1).max(80),
  promptTemplateVersion: z.string().min(1).max(80),
  providerKey: z.string().min(1).max(80),
  modelKey: z.string().min(1).max(160),
  verifiedBusinessDataDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  outputContentDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  requestedByAgencyUserReference: PublicReferenceSchema,
  generatedAt: z.string().datetime(),
}).strict();

export const RegenerationInstructionSchema = z.string()
  .trim()
  .min(8)
  .max(1_000)
  .superRefine((instruction, context) => {
    const unsafe = /(?:https?:\/\/|external\s+booking|book\s+with\s+(?:calendly|fresha|square)|invent|fabricat|fake\s+(?:review|testimonial|claim)|ignore\s+(?:rules|instructions)|<\s*script|javascript:)/i;
    if (unsafe.test(instruction)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The regeneration instruction conflicts with generation safety rules.',
      });
    }
  });

export const GenerationRunRequestSchema = z.object({
  blueprintReference: PublicReferenceSchema,
  knowledgePackReference: PublicReferenceSchema.optional(),
  generationReason: SiteGenerationReasonSchema,
}).strict();

export const PageRegenerationRequestSchema = z.object({
  regenerationInstruction: RegenerationInstructionSchema.optional(),
}).strict();

export const SectionRegenerationRequestSchema = z.object({
  regenerationInstruction: RegenerationInstructionSchema,
}).strict();
