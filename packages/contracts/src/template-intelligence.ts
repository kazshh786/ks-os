import { z } from 'zod';
import {
  PublicReferenceSchema,
  SiteConversionRoleSchema,
  SitePageTypeSchema,
  TemplateSourceTypeSchema,
} from './sites.js';

export const TemplateAnalysisStatusSchema = z.enum([
  'PENDING',
  'ANALYSING',
  'REVIEW_REQUIRED',
  'READY_FOR_APPROVAL',
  'APPROVED',
  'REJECTED',
  'FAILED',
  'SUPERSEDED',
]);
export type TemplateAnalysisStatus = z.infer<typeof TemplateAnalysisStatusSchema>;

export const TemplateFileCategorySchema = z.enum([
  'HTML',
  'CSS',
  'JAVASCRIPT',
  'IMAGE',
  'FONT',
  'SVG',
  'JSON',
  'DOCUMENTATION',
  'BUILD_CONFIG',
  'UNKNOWN',
]);
export type TemplateFileCategory = z.infer<typeof TemplateFileCategorySchema>;

export const TemplateFindingSeveritySchema = z.enum([
  'BLOCKING',
  'WARNING',
  'INFO',
]);
export type TemplateFindingSeverity = z.infer<typeof TemplateFindingSeveritySchema>;

export const TemplateFindingCategorySchema = z.enum([
  'SECURITY',
  'STRUCTURE',
  'CLASSIFICATION',
  'RESPONSIVE',
  'ACCESSIBILITY',
  'BOOKING_CONVERSION',
  'DESIGN_SYSTEM',
  'LICENSING',
]);
export type TemplateFindingCategory = z.infer<typeof TemplateFindingCategorySchema>;

export const TemplateSectionTypeSchema = z.enum([
  'HEADER',
  'NAVIGATION',
  'ANNOUNCEMENT_BAR',
  'HERO',
  'INTRODUCTION',
  'FEATURED_SERVICES',
  'SERVICE_GRID',
  'SERVICE_DETAILS',
  'BENEFITS',
  'PROCESS',
  'PRICING',
  'TEAM',
  'STAFF_PROFILE',
  'GALLERY',
  'RESULTS',
  'TESTIMONIALS',
  'REVIEW_SUMMARY',
  'TRUST_INDICATORS',
  'FAQ',
  'LOCATION',
  'OPENING_HOURS',
  'MAP',
  'CONTACT_FORM',
  'NEWSLETTER',
  'POLICIES',
  'BOOKING_CTA',
  'FINAL_CTA',
  'FOOTER',
  'UNKNOWN',
]);
export type TemplateSectionType = z.infer<typeof TemplateSectionTypeSchema>;

export const TemplateDetectedPageTypeSchema = z.enum([
  ...SitePageTypeSchema.options,
  'PORTFOLIO',
  'SHOP',
  'PRODUCT_DETAIL',
  'CAREERS',
  'BLOG_ARCHIVE',
  'BLOG_ARTICLE',
  'CASE_STUDY',
  'COMING_SOON',
  'ERROR_PAGE',
  'UTILITY_PAGE',
  'UNKNOWN',
]);
export type TemplateDetectedPageType = z.infer<
  typeof TemplateDetectedPageTypeSchema
>;

export const TemplateBookingCtaPositionSchema = z.enum([
  'HEADER',
  'HERO',
  'MOBILE_NAVIGATION',
  'SERVICE_CARD',
  'SERVICE_DETAIL',
  'FINAL_SECTION',
  'FOOTER',
  'STICKY_MOBILE',
  'OTHER',
]);
export type TemplateBookingCtaPosition = z.infer<
  typeof TemplateBookingCtaPositionSchema
>;

export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const TemplateRelativePathSchema = z
  .string()
  .min(1)
  .max(1000)
  .refine((value) => !value.includes('\0'), 'Null bytes are not allowed.')
  .refine((value) => !/^(?:[a-z]:[\\/]|[\\/]{1,2})/i.test(value), {
    message: 'Absolute paths are not allowed.',
  })
  .refine(
    (value) => !value.replaceAll('\\', '/').split('/').includes('..'),
    'Path traversal is not allowed.',
  );

export const TemplateDesignSignalsSchema = z.object({
  cssCustomProperties: z.array(z.string().max(120)).max(250),
  colours: z.array(z.string().max(80)).max(100),
  fontFamilies: z.array(z.string().max(160)).max(50),
  fontWeights: z.array(z.number().int().min(1).max(1000)).max(20),
  spacingValues: z.array(z.string().max(40)).max(100),
  borderRadii: z.array(z.string().max(40)).max(50),
  shadows: z.array(z.string().max(240)).max(50),
  containerWidths: z.array(z.string().max(40)).max(50),
  imageAspectRatios: z.array(z.string().max(40)).max(50),
  buttonVariants: z.array(z.string().max(120)).max(50),
  frameworkIndicators: z.array(z.string().max(120)).max(30),
}).strict();
export type TemplateDesignSignals = z.infer<typeof TemplateDesignSignalsSchema>;

export const TemplateResponsiveSignalsSchema = z.object({
  hasViewportMeta: z.boolean(),
  mediaQueryCount: z.number().int().nonnegative(),
  breakpoints: z.array(z.number().int().positive().max(10000)).max(50),
  hasSrcset: z.boolean(),
  hasSizes: z.boolean(),
  hasPictureElements: z.boolean(),
  hasResponsiveNavigation: z.boolean(),
  usesGrid: z.boolean(),
  usesFlexbox: z.boolean(),
  fixedWidthRisks: z.array(z.string().max(240)).max(50),
  horizontalOverflowRisks: z.array(z.string().max(240)).max(50),
  missingMobileNavigationSignal: z.boolean(),
}).strict();
export type TemplateResponsiveSignals = z.infer<
  typeof TemplateResponsiveSignalsSchema
>;

export const TemplateManifestSectionSchema = z.object({
  sectionType: TemplateSectionTypeSchema,
  confidence: z.number().min(0).max(1),
  domOrder: z.number().int().nonnegative(),
  structuralReference: z.string().min(1).max(300),
  requiredForRecommendedPageType: z.boolean(),
  containsBookingAction: z.boolean(),
  requiresAgencyReview: z.boolean(),
}).strict();
export type TemplateManifestSection = z.infer<
  typeof TemplateManifestSectionSchema
>;

export const TemplateManifestLayoutSchema = z.object({
  layoutReference: PublicReferenceSchema,
  layoutKey: z.string().min(2).max(120).regex(/^[a-z][a-z0-9_-]+$/),
  sourceFile: TemplateRelativePathSchema.nullable(),
  detectedPageType: TemplateDetectedPageTypeSchema,
  recommendedPageType: SitePageTypeSchema.nullable(),
  suggestedAdditionalPageTypes: z.array(SitePageTypeSchema)
    .max(SitePageTypeSchema.options.length),
  allowedPageTypes: z.array(SitePageTypeSchema).max(SitePageTypeSchema.options.length),
  incompatiblePageTypes: z.array(SitePageTypeSchema).max(SitePageTypeSchema.options.length),
  conversionRole: SiteConversionRoleSchema,
  classificationConfidence: z.number().min(0).max(1),
  classificationEvidence: z.array(z.string().min(1).max(120)).max(50),
  sections: z.array(TemplateManifestSectionSchema).max(100),
  bookingCtaPositions: z.array(TemplateBookingCtaPositionSchema).max(20),
  responsiveSignals: TemplateResponsiveSignalsSchema,
  accessibilityConcerns: z.array(z.string().max(240)).max(50),
  securityConcerns: z.array(z.string().max(240)).max(50),
  requiresAgencyReview: z.boolean(),
  enabled: z.boolean(),
}).strict().superRefine((layout, context) => {
  if (!layout.enabled && layout.allowedPageTypes.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['allowedPageTypes'],
      message: 'Disabled layouts cannot expose approved page-type compatibility.',
    });
  }
  if (
    layout.recommendedPageType
    && layout.allowedPageTypes.length > 0
    && !layout.allowedPageTypes.includes(layout.recommendedPageType)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recommendedPageType'],
      message: 'The recommended page type must be allowed once compatibility is approved.',
    });
  }
  if (
    layout.recommendedPageType
    && layout.suggestedAdditionalPageTypes.includes(layout.recommendedPageType)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['suggestedAdditionalPageTypes'],
      message: 'Additional page-type suggestions cannot repeat the recommendation.',
    });
  }
  const contradictoryPageType = layout.suggestedAdditionalPageTypes.find(
    (pageType) => layout.incompatiblePageTypes.includes(pageType),
  );
  if (contradictoryPageType) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['incompatiblePageTypes'],
      message: `${contradictoryPageType} cannot be both suggested and incompatible.`,
    });
  }
  const approvedButIncompatible = layout.allowedPageTypes.find(
    (pageType) => layout.incompatiblePageTypes.includes(pageType),
  );
  if (approvedButIncompatible) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['incompatiblePageTypes'],
      message: `${approvedButIncompatible} cannot be both approved and incompatible.`,
    });
  }
});
export type TemplateManifestLayout = z.infer<typeof TemplateManifestLayoutSchema>;

export const TemplateManifestFindingSchema = z.object({
  reference: PublicReferenceSchema.optional(),
  severity: TemplateFindingSeveritySchema,
  category: TemplateFindingCategorySchema,
  code: z.string().min(2).max(100).regex(/^[A-Z][A-Z0-9_]+$/),
  filePath: TemplateRelativePathSchema.nullable(),
  layoutReference: PublicReferenceSchema.nullable(),
  message: z.string().min(1).max(1000),
  resolved: z.boolean(),
}).strict();

export const TemplateManifestSchema = z.object({
  schemaVersion: z.literal(1),
  templateVersionReference: PublicReferenceSchema,
  sourceType: TemplateSourceTypeSchema,
  name: z.string().min(1).max(160),
  industryTags: z.array(
    z.string().trim().toLowerCase().min(2).max(40).regex(/^[a-z0-9-]+$/),
  ).max(30),
  designSignals: TemplateDesignSignalsSchema,
  layouts: z.array(TemplateManifestLayoutSchema).max(200),
  findings: z.array(TemplateManifestFindingSchema).max(1000),
}).strict();
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

export const CreateTemplateSourceSchema = z.object({
  sourceType: TemplateSourceTypeSchema,
  name: z.string().trim().min(2).max(160),
  sourceReference: z.string().trim().min(1).max(500).optional(),
  industryTags: z.array(
    z.string().trim().toLowerCase().min(2).max(40).regex(/^[a-z0-9-]+$/),
  ).max(30).default([]),
  agencyNotes: z.string().trim().max(2000).optional(),
}).strict();
export type CreateTemplateSource = z.infer<typeof CreateTemplateSourceSchema>;

export const UpdateTemplateSourceSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  status: z.enum(['DRAFT', 'INTERNAL_REVIEW', 'APPROVED', 'RETIRED']).optional(),
  industryTags: z.array(
    z.string().trim().toLowerCase().min(2).max(40).regex(/^[a-z0-9-]+$/),
  ).max(30).optional(),
  agencyNotes: z.string().trim().max(2000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one template-source change is required.',
});
export type UpdateTemplateSource = z.infer<typeof UpdateTemplateSourceSchema>;

export const ManualTemplateLayoutSchema = z.object({
  name: z.string().trim().min(2).max(160),
  layoutKey: z.string().min(2).max(120).regex(/^[a-z][a-z0-9_-]+$/),
  recommendedPageType: SitePageTypeSchema.nullable().default(null),
  conversionRole: SiteConversionRoleSchema,
  allowedPageTypes: z.array(SitePageTypeSchema).max(SitePageTypeSchema.options.length),
  agencyNotes: z.string().trim().max(2000).optional(),
}).strict();

export const CreateTemplateVersionSchema = z.object({
  artifactDigestSha256: Sha256Schema,
  analyserVersion: z.string().trim().min(1).max(80).default('deterministic-v1'),
  artifactReference: z.string().trim().min(1).max(500).optional(),
  manualLayouts: z.array(ManualTemplateLayoutSchema).max(100).default([]),
}).strict();
export type CreateTemplateVersion = z.infer<typeof CreateTemplateVersionSchema>;

export const StartTemplateAnalysisSchema = z.object({
  artifactDigestSha256: Sha256Schema,
  analyserVersion: z.string().trim().min(1).max(80).default('deterministic-v1'),
}).strict();
export type StartTemplateAnalysis = z.infer<typeof StartTemplateAnalysisSchema>;

export const UpdateTemplateLayoutSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  layoutKey: z.string().min(2).max(120).regex(/^[a-z][a-z0-9_-]+$/).optional(),
  recommendedPageType: SitePageTypeSchema.nullable().optional(),
  conversionRole: SiteConversionRoleSchema.optional(),
  requiresAgencyReview: z.boolean().optional(),
  disabled: z.boolean().optional(),
  agencyNotes: z.string().trim().max(2000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one layout change is required.',
});
export type UpdateTemplateLayout = z.infer<typeof UpdateTemplateLayoutSchema>;

export const AddTemplateLayoutPageTypeSchema = z.object({
  pageType: SitePageTypeSchema,
}).strict();
export type AddTemplateLayoutPageType = z.infer<
  typeof AddTemplateLayoutPageTypeSchema
>;

export const TemplateDecisionSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
}).strict();
export type TemplateDecision = z.infer<typeof TemplateDecisionSchema>;

export const ResolveTemplateFindingSchema = z.object({
  resolved: z.boolean(),
  agencyNote: z.string().trim().max(1000).optional(),
}).strict();
export type ResolveTemplateFinding = z.infer<
  typeof ResolveTemplateFindingSchema
>;

export const CreateTemplateLicenceSchema = z.object({
  templateVersionReference: PublicReferenceSchema,
  envatoItemReference: z.string().trim().min(1).max(255),
  licenceReference: z.string().trim().min(1).max(255),
  projectRegistrationReference: z.string().trim().max(255).optional(),
  evidenceStorageReference: TemplateRelativePathSchema.optional(),
}).strict();
export type CreateTemplateLicence = z.infer<typeof CreateTemplateLicenceSchema>;

export const TemplateLicenceStatusSchema = z.enum([
  'ACTIVE',
  'EXPIRED',
  'REVOKED',
]);
export type TemplateLicenceStatus = z.infer<typeof TemplateLicenceStatusSchema>;

export const TemplateLicenceSummarySchema = z.object({
  reference: PublicReferenceSchema,
  templateVersionReference: PublicReferenceSchema,
  sourceType: TemplateSourceTypeSchema,
  envatoItemReference: z.string().max(255).nullable(),
  projectRegistrationReference: z.string().max(255).nullable(),
  status: TemplateLicenceStatusSchema,
  recordedAt: z.string().datetime(),
  verifiedAt: z.string().datetime().nullable(),
}).strict();
export type TemplateLicenceSummary = z.infer<
  typeof TemplateLicenceSummarySchema
>;

export const EMPTY_TEMPLATE_DESIGN_SIGNALS: TemplateDesignSignals = {
  cssCustomProperties: [],
  colours: [],
  fontFamilies: [],
  fontWeights: [],
  spacingValues: [],
  borderRadii: [],
  shadows: [],
  containerWidths: [],
  imageAspectRatios: [],
  buttonVariants: [],
  frameworkIndicators: [],
};

export const EMPTY_TEMPLATE_RESPONSIVE_SIGNALS: TemplateResponsiveSignals = {
  hasViewportMeta: false,
  mediaQueryCount: 0,
  breakpoints: [],
  hasSrcset: false,
  hasSizes: false,
  hasPictureElements: false,
  hasResponsiveNavigation: false,
  usesGrid: false,
  usesFlexbox: false,
  fixedWidthRisks: [],
  horizontalOverflowRisks: [],
  missingMobileNavigationSignal: true,
};

export function templateConfidenceBand(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (score >= 0.8) return 'HIGH';
  if (score >= 0.5) return 'MEDIUM';
  return 'LOW';
}

export function validateTemplateManifest(input: unknown): TemplateManifest {
  return TemplateManifestSchema.parse(input);
}
