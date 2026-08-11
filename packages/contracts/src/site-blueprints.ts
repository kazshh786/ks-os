import { z } from 'zod';
import {
  BookingConversionPlacementSchema,
  KsOsBookingActionSchema,
  PublicReferenceSchema,
  SiteConversionRoleSchema,
  SiteEntitlementKindSchema,
  SitePageTypeSchema,
} from './sites.js';
import { PlanKeySchema } from './agency.js';

export const BlueprintStatusSchema = z.enum([
  'DRAFT',
  'GENERATING',
  'REVIEW_REQUIRED',
  'READY_FOR_APPROVAL',
  'APPROVED',
  'SUPERSEDED',
  'REJECTED',
]);
export type BlueprintStatus = z.infer<typeof BlueprintStatusSchema>;

export const BlueprintNavigationGroupSchema = z.enum([
  'PRIMARY',
  'SECONDARY',
  'CONTEXTUAL',
  'FUNCTIONAL',
]);
export type BlueprintNavigationGroup = z.infer<
  typeof BlueprintNavigationGroupSchema
>;

export const BlueprintActionItemCategorySchema = z.enum([
  'BUSINESS_PROFILE',
  'SERVICE_DATA',
  'LOCATION_DATA',
  'STAFF_DATA',
  'TEMPLATE',
  'LICENCE',
  'LAYOUT',
  'BOOKING',
  'BRAND',
  'CONTENT',
  'ASSET',
  'ENTITLEMENT',
]);
export type BlueprintActionItemCategory = z.infer<
  typeof BlueprintActionItemCategorySchema
>;

export const BlueprintActionItemSeveritySchema = z.enum([
  'INFO',
  'WARNING',
  'BLOCKING',
]);
export type BlueprintActionItemSeverity = z.infer<
  typeof BlueprintActionItemSeveritySchema
>;

export const BlueprintActionItemStatusSchema = z.enum(['OPEN', 'RESOLVED']);
export type BlueprintActionItemStatus = z.infer<
  typeof BlueprintActionItemStatusSchema
>;

export const BlueprintCanonicalPathSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value === '/' || /^\/[a-z0-9]+(?:[a-z0-9/-]*[a-z0-9])?$/.test(value), {
    message: 'Canonical paths must be lowercase root-relative paths.',
  })
  .refine((value) => !value.includes('//') && !value.includes('..'), {
    message: 'Canonical paths cannot contain traversal or empty segments.',
  })
  .refine((value) => !value.includes('?') && !value.includes('#'), {
    message: 'Canonical paths cannot contain query strings or fragments.',
  });

export const BlueprintBookingRequirementSchema = z.object({
  placement: BookingConversionPlacementSchema,
  action: KsOsBookingActionSchema,
}).strict();
export type BlueprintBookingRequirement = z.infer<
  typeof BlueprintBookingRequirementSchema
>;

const BlueprintPageCommonShape = {
  reference: PublicReferenceSchema.optional(),
  conversionRole: SiteConversionRoleSchema,
  titleLabel: z.string().trim().min(1).max(160),
  plannedSlug: BlueprintCanonicalPathSchema,
  navigationGroup: BlueprintNavigationGroupSchema,
  navigationOrder: z.number().int().min(0).max(10_000),
  layoutReference: PublicReferenceSchema.nullable(),
  entitlementKind: SiteEntitlementKindSchema,
  consumesMarketingEntitlement: z.boolean(),
  generationPriority: z.number().int().min(0).max(10_000),
  selectionScore: z.number().int().min(-10_000).max(10_000),
  selectionReasons: z.array(z.string().trim().min(1).max(120)).max(50),
  layoutSelectionReason: z.string().trim().min(1).max(500).nullable(),
  bookingRequirements: z.array(BlueprintBookingRequirementSchema).max(20),
  agencyNotes: z.string().trim().max(1000).nullable().optional(),
};

const UnmappedBlueprintPageSchema = z.object({
  ...BlueprintPageCommonShape,
  pageType: z.enum([
    'HOME',
    'SERVICE_HUB',
    'LOCATION_HUB',
    'ABOUT',
    'TEAM_HUB',
    'CONTACT',
    'FAQ',
    'POLICIES',
    'RESULTS',
    'NEW_CLIENT_GUIDE',
    'AFTERCARE_GUIDE',
    'CONSULTATION_GUIDE',
    'GUIDE',
    'HOW_TO',
    'ARTICLE',
    'BLOG_POST',
    'FAQ_RESOURCE',
    'TUTORIAL',
    'DEFINITION',
    'TROUBLESHOOTING',
    'COMPARISON',
    'CASE_STUDY',
    'BOOKING',
  ]),
  serviceReference: z.never().optional(),
  locationReference: z.never().optional(),
  staffReference: z.never().optional(),
}).strict();

const ServiceBlueprintPageSchema = z.object({
  ...BlueprintPageCommonShape,
  pageType: z.literal('SERVICE_DETAIL'),
  serviceReference: PublicReferenceSchema,
  locationReference: z.never().optional(),
  staffReference: z.never().optional(),
}).strict();

const LocationBlueprintPageSchema = z.object({
  ...BlueprintPageCommonShape,
  pageType: z.literal('LOCATION_DETAIL'),
  serviceReference: z.never().optional(),
  locationReference: PublicReferenceSchema,
  staffReference: z.never().optional(),
}).strict();

const StaffBlueprintPageSchema = z.object({
  ...BlueprintPageCommonShape,
  pageType: z.literal('TEAM_DETAIL'),
  serviceReference: z.never().optional(),
  locationReference: z.never().optional(),
  staffReference: PublicReferenceSchema,
}).strict();

export const BlueprintPageInputSchema = z.union([
  UnmappedBlueprintPageSchema,
  ServiceBlueprintPageSchema,
  LocationBlueprintPageSchema,
  StaffBlueprintPageSchema,
]).superRefine((page, context) => {
  if (page.pageType === 'BOOKING') {
    if (page.plannedSlug !== '/book') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'BOOKING is fixed to /book.',
        path: ['plannedSlug'],
      });
    }
    if (page.consumesMarketingEntitlement || page.entitlementKind !== 'FUNCTIONAL') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'BOOKING must be a non-consuming functional page.',
        path: ['consumesMarketingEntitlement'],
      });
    }
  }
});
export type BlueprintPageInput = z.infer<typeof BlueprintPageInputSchema>;

export const BlueprintPageSummarySchema = BlueprintPageInputSchema.and(
  z.object({ reference: PublicReferenceSchema }).passthrough(),
);
export type BlueprintPageSummary = z.infer<typeof BlueprintPageSummarySchema>;

export const BlueprintEntitlementUsageSchema = z.object({
  planKey: PlanKeySchema,
  marketingPageLimit: z.number().int().nonnegative(),
  proposedMarketingPageCount: z.number().int().nonnegative(),
  functionalPageCount: z.number().int().nonnegative(),
  requiredLegalPageCount: z.number().int().nonnegative(),
  unusedMarketingPageAllowance: z.number().int().nonnegative(),
  overrideApplied: z.boolean(),
}).strict();
export type BlueprintEntitlementUsage = z.infer<
  typeof BlueprintEntitlementUsageSchema
>;

export const BlueprintReadinessAssessmentSchema = z.object({
  pageType: SitePageTypeSchema,
  subjectReference: PublicReferenceSchema.nullable(),
  ready: z.boolean(),
  requiredChecks: z.array(z.object({
    code: z.string().trim().min(1).max(100),
    passed: z.boolean(),
  }).strict()).max(30),
  recommendedMissing: z.array(z.string().trim().min(1).max(100)).max(30),
}).strict();
export type BlueprintReadinessAssessment = z.infer<
  typeof BlueprintReadinessAssessmentSchema
>;

export const BlueprintActionItemSchema = z.object({
  reference: PublicReferenceSchema,
  category: BlueprintActionItemCategorySchema,
  severity: BlueprintActionItemSeveritySchema,
  status: BlueprintActionItemStatusSchema,
  code: z.string().trim().min(1).max(100).regex(/^[A-Z0-9_]+$/),
  message: z.string().trim().min(1).max(1000),
  pageReference: PublicReferenceSchema.nullable(),
  subjectReference: PublicReferenceSchema.nullable(),
  safeMetadata: z.record(z.union([
    z.string().max(500),
    z.number().finite(),
    z.boolean(),
    z.null(),
  ])),
  resolvedAt: z.string().datetime().nullable(),
}).strict();
export type BlueprintActionItem = z.infer<typeof BlueprintActionItemSchema>;

export const BlueprintSummarySchema = z.object({
  reference: PublicReferenceSchema,
  siteReference: PublicReferenceSchema,
  templateVersionReference: PublicReferenceSchema.nullable(),
  name: z.string().trim().min(1).max(160),
  status: BlueprintStatusSchema,
  revision: z.number().int().positive(),
  sourceDataDigest: z.string().length(64).regex(/^[a-f0-9]+$/).nullable(),
  engineVersion: z.string().trim().min(1).max(80).nullable(),
  entitlementUsage: BlueprintEntitlementUsageSchema,
  blockingActionItemCount: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type BlueprintSummary = z.infer<typeof BlueprintSummarySchema>;

export const BlueprintDetailSchema = BlueprintSummarySchema.extend({
  pages: z.array(BlueprintPageSummarySchema).min(2).max(100),
  readiness: z.array(BlueprintReadinessAssessmentSchema).max(500),
  actionItems: z.array(BlueprintActionItemSchema).max(1000),
}).strict();
export type BlueprintDetail = z.infer<typeof BlueprintDetailSchema>;

export const BlueprintGenerationRequestSchema = z.object({
  templateVersionReference: PublicReferenceSchema,
  name: z.string().trim().min(1).max(160).optional(),
  preferences: z.object({
    prioritisedServiceReferences: z.array(PublicReferenceSchema).max(100).default([]),
    prioritisedLocationReferences: z.array(PublicReferenceSchema).max(100).default([]),
    prioritisedStaffReferences: z.array(PublicReferenceSchema).max(100).default([]),
    preferredLayoutReferences: z.record(SitePageTypeSchema, PublicReferenceSchema).default({}),
    includePageTypes: z.array(SitePageTypeSchema).max(16).default([]),
    explicitPages: z.array(z.object({
      title: z.string().trim().min(1).max(160),
      pageType: z.enum([
        'GUIDE', 'HOW_TO', 'ARTICLE', 'FAQ_RESOURCE', 'TUTORIAL',
        'DEFINITION', 'TROUBLESHOOTING', 'COMPARISON', 'CASE_STUDY',
      ]).default('GUIDE'),
    }).strict()).max(50).default([]),
  }).strict().default({}),
}).strict();
export type BlueprintGenerationRequest = z.infer<
  typeof BlueprintGenerationRequestSchema
>;

export const BlueprintGenerationResultSchema = z.object({
  blueprint: BlueprintDetailSchema,
  idempotentReplay: z.boolean(),
  generationRunReference: PublicReferenceSchema,
}).strict();
export type BlueprintGenerationResult = z.infer<
  typeof BlueprintGenerationResultSchema
>;

export const BlueprintValidationFindingSchema = z.object({
  code: z.string().trim().min(1).max(100).regex(/^[A-Z0-9_]+$/),
  severity: BlueprintActionItemSeveritySchema,
  message: z.string().trim().min(1).max(1000),
  pageReference: PublicReferenceSchema.nullable(),
  subjectReference: PublicReferenceSchema.nullable(),
}).strict();
export type BlueprintValidationFinding = z.infer<
  typeof BlueprintValidationFindingSchema
>;

export const BlueprintValidationResultSchema = z.object({
  valid: z.boolean(),
  approvalReady: z.boolean(),
  entitlementUsage: BlueprintEntitlementUsageSchema,
  findings: z.array(BlueprintValidationFindingSchema).max(1000),
  validatedAt: z.string().datetime(),
}).strict();
export type BlueprintValidationResult = z.infer<
  typeof BlueprintValidationResultSchema
>;

export const BlueprintApprovalRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(8).max(1000),
}).strict();
export type BlueprintApprovalRequest = z.infer<
  typeof BlueprintApprovalRequestSchema
>;

export const BlueprintPagePatchSchema = z.object({
  titleLabel: z.string().trim().min(1).max(160).optional(),
  plannedSlug: BlueprintCanonicalPathSchema.optional(),
  navigationGroup: BlueprintNavigationGroupSchema.optional(),
  navigationOrder: z.number().int().min(0).max(10_000).optional(),
  layoutReference: PublicReferenceSchema.optional(),
  conversionRole: SiteConversionRoleSchema.optional(),
  agencyNotes: z.string().trim().max(1000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one page change is required.',
});
export type BlueprintPagePatch = z.infer<typeof BlueprintPagePatchSchema>;

export const BlueprintAgencyOverrideSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('UPDATE_BLUEPRINT'),
    name: z.string().trim().min(1).max(160).optional(),
    status: z.enum(['DRAFT', 'REVIEW_REQUIRED', 'READY_FOR_APPROVAL']).optional(),
  }).strict(),
  z.object({
    operation: z.literal('ADD_PAGE'),
    page: BlueprintPageInputSchema,
  }).strict(),
  z.object({
    operation: z.literal('UPDATE_PAGE'),
    pageReference: PublicReferenceSchema,
    changes: BlueprintPagePatchSchema,
  }).strict(),
  z.object({
    operation: z.literal('REMOVE_PAGE'),
    pageReference: PublicReferenceSchema,
  }).strict(),
  z.object({
    operation: z.literal('REORDER_PAGES'),
    pageReferences: z.array(PublicReferenceSchema).min(2).max(100),
  }).strict(),
  z.object({
    operation: z.literal('RESOLVE_ACTION_ITEM'),
    actionItemReference: PublicReferenceSchema,
    resolutionNote: z.string().trim().min(3).max(1000),
  }).strict(),
]);
export type BlueprintAgencyOverride = z.infer<
  typeof BlueprintAgencyOverrideSchema
>;

export const BlueprintComparisonSchema = z.object({
  fromBlueprintReference: PublicReferenceSchema,
  toBlueprintReference: PublicReferenceSchema,
  addedPages: z.array(BlueprintPageSummarySchema).max(100),
  removedPages: z.array(BlueprintPageSummarySchema).max(100),
  changedPages: z.array(z.object({
    from: BlueprintPageSummarySchema,
    to: BlueprintPageSummarySchema,
    changedFields: z.array(z.string().trim().min(1).max(80)).min(1),
  }).strict()).max(100),
  entitlementDelta: z.number().int(),
}).strict();
export type BlueprintComparison = z.infer<typeof BlueprintComparisonSchema>;

export const BlueprintRejectRequestSchema = z.object({
  reason: z.string().trim().min(8).max(1000),
}).strict();
export type BlueprintRejectRequest = z.infer<
  typeof BlueprintRejectRequestSchema
>;
