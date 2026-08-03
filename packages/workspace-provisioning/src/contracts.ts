import { z } from 'zod';

export const ProvisioningPlanKeySchema = z.enum(['CORE', 'GROWTH', 'SCALE']);
export const PaymentReadinessStatusSchema = z.enum([
  'NOT_STARTED', 'ACTION_REQUIRED', 'ONBOARDING_STARTED', 'READY', 'RESTRICTED', 'DISABLED',
]);
export const ProvisioningDraftStatusSchema = z.enum([
  'DRAFT', 'VALIDATING', 'READY_TO_PROVISION', 'PROVISIONING', 'COMPLETED', 'CANCELLED', 'SUPERSEDED',
]);
export const ProvisioningRunStatusSchema = z.enum([
  'QUEUED',
  'PROVISIONING_TENANT',
  'PROVISIONING_BUSINESS',
  'PROVISIONING_SERVICES',
  'PROVISIONING_STAFF',
  'PROVISIONING_AVAILABILITY',
  'PROVISIONING_BOOKING',
  'PROVISIONING_FORMS',
  'PROVISIONING_PAYMENTS',
  'PLANNING_SITE',
  'GENERATING_SITE',
  'VALIDATING_SITE',
  'CREATING_REVIEW',
  'READY',
  'ACTION_REQUIRED',
  'PARTIALLY_FAILED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
]);
export type ProvisioningRunStatus = z.infer<typeof ProvisioningRunStatusSchema>;

export const ProvisioningStepStatusSchema = z.enum([
  'PENDING', 'IN_PROGRESS', 'COMPLETED', 'WARNING', 'ACTION_REQUIRED', 'FAILED', 'SKIPPED',
]);

export const PROVISIONING_STEPS = [
  'VALIDATE_DRAFT',
  'RESOLVE_PLAN',
  'CREATE_TENANT',
  'CREATE_WORKSPACE',
  'CREATE_BUSINESS_PROFILE',
  'CREATE_LOCATIONS',
  'CREATE_SERVICES',
  'CREATE_STAFF',
  'CREATE_STAFF_SERVICE_RELATIONSHIPS',
  'CREATE_LOCATION_SERVICE_RELATIONSHIPS',
  'CREATE_OPENING_HOURS',
  'CREATE_AVAILABILITY',
  'CREATE_BOOKING_CONFIGURATION',
  'CREATE_FORMS_AND_POLICIES',
  'CREATE_PAYMENT_CONFIGURATION',
  'CREATE_SITE',
  'SELECT_TEMPLATE',
  'GENERATE_BLUEPRINT',
  'APPROVE_BLUEPRINT',
  'GENERATE_SITE',
  'VALIDATE_NATIVE_BOOKING',
  'CREATE_INTERNAL_REVIEW',
  'CREATE_PREVIEW',
  'MARK_READY',
  'RECORD_AUDIT',
] as const;
export const ProvisioningStepKeySchema = z.enum(PROVISIONING_STEPS);
export type ProvisioningStepKey = z.infer<typeof ProvisioningStepKeySchema>;

const PublicReferenceSchema = z.string().uuid();
const SafeNameSchema = z.string().trim().min(2).max(255);
const SubdomainSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const HexColourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const ProvisioningDesignSourceSchema = z.enum([
  'KS_NATIVE',
  'GOOGLE_STITCH',
  'LICENSED_TEMPLATE',
]);
export type ProvisioningDesignSource = z.infer<typeof ProvisioningDesignSourceSchema>;

export const ProvisioningDesignPresetKeySchema = z.enum([
  'NORTHLIGHT',
  'EDITORIAL',
  'MODERN',
  'LUXURY',
  'WELLNESS',
  'CLINICAL',
  'FRIENDLY',
  'BOLD',
  'LOCAL',
  'CREATIVE',
]);
export type ProvisioningDesignPresetKey = z.infer<typeof ProvisioningDesignPresetKeySchema>;

export const ProvisioningSectionVariantSchema = z.enum([
  'editorial',
  'grid',
  'split',
  'compact',
  'standard',
  'featured',
  'quiet',
]);

/** Per-client palette overrides. They are validated again against WCAG before review opens. */
export const ProvisioningThemeColourOverridesSchema = z.object({
  primaryColour: HexColourSchema.optional(),
  secondaryColour: HexColourSchema.optional(),
  accentColour: HexColourSchema.optional(),
  backgroundColour: HexColourSchema.optional(),
  surfaceColour: HexColourSchema.optional(),
  textColour: HexColourSchema.optional(),
  mutedTextColour: HexColourSchema.optional(),
  borderColour: HexColourSchema.optional(),
}).strict();
export type ProvisioningThemeColourOverrides = z.infer<typeof ProvisioningThemeColourOverridesSchema>;

export const ProvisioningSiteDesignSchema = z.object({
  source: ProvisioningDesignSourceSchema.default('KS_NATIVE'),
  presetKey: ProvisioningDesignPresetKeySchema.default('NORTHLIGHT'),
  defaultSectionVariant: ProvisioningSectionVariantSchema.default('standard'),
  libraryItemReference: PublicReferenceSchema.optional(),
  themeOverrides: ProvisioningThemeColourOverridesSchema.optional(),
}).strict().superRefine((design, context) => {
  if (design.source !== 'KS_NATIVE' && design.libraryItemReference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['libraryItemReference'],
      message: 'A Design Studio library theme can only be used with KS Native delivery.',
    });
  }
  if (design.source !== 'KS_NATIVE' && design.themeOverrides && Object.keys(design.themeOverrides).length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['themeOverrides'],
      message: 'Custom KS colour overrides can only be used with KS Native delivery.',
    });
  }
});
export type ProvisioningSiteDesign = z.infer<typeof ProvisioningSiteDesignSchema>;

export const CreateProvisioningDraftSchema = z.object({
  productionBriefReference: PublicReferenceSchema,
  planVersionReference: PublicReferenceSchema,
  workspace: z.object({
    name: SafeNameSchema,
    subdomain: SubdomainSchema,
    timezone: z.string().trim().min(1).max(100),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }).strict(),
  // A technical renderer version remains pinned for integrity. For KS_NATIVE this
  // reference is resolved by the delivery context and is never exposed as a visual choice.
  templateVersionReference: PublicReferenceSchema,
  pagePlan: z.object({
    requestedPageTypes: z.array(z.enum([
      'HOME', 'SERVICE_HUB', 'SERVICE_DETAIL', 'LOCATION_HUB', 'LOCATION_DETAIL',
      'ABOUT', 'TEAM_HUB', 'TEAM_DETAIL', 'CONTACT', 'FAQ', 'POLICIES', 'RESULTS',
      'NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE', 'CONSULTATION_GUIDE', 'BOOKING',
    ])).max(100),
    /**
     * The default launch selects the strongest ten marketing pages justified by
     * verified client data. Functional booking and required policy pages do not
     * consume this target.
     */
    targetMarketingPageCount: z.number().int().min(1).max(30).default(10),
    preferredLayoutReferences: z.record(PublicReferenceSchema).default({}),
    design: ProvisioningSiteDesignSchema.default({
      source: 'KS_NATIVE',
      presetKey: 'NORTHLIGHT',
      defaultSectionVariant: 'standard',
    }),
  }).strict(),
  paymentPreference: z.object({
    allowPayLater: z.boolean(),
    onlinePaymentsRequested: z.boolean(),
    depositCollectionRequested: z.boolean(),
  }).strict(),
}).strict();
export const UpdateProvisioningDraftSchema = CreateProvisioningDraftSchema.partial().strict();

export const StartProvisioningRunSchema = z.object({
  provisioningDraftReference: PublicReferenceSchema,
  idempotencyKey: z.string().trim().min(16).max(160).regex(/^[A-Za-z0-9:_-]+$/),
}).strict();
export type StartProvisioningRun = z.infer<typeof StartProvisioningRunSchema>;

export const ProvisioningActionReasonSchema = z.object({
  reason: z.string().trim().min(8).max(500),
}).strict();

export const ProvisioningProgressSchema = z.object({
  runReference: PublicReferenceSchema,
  status: ProvisioningRunStatusSchema,
  completionPercentage: z.number().int().min(0).max(100),
  currentStep: ProvisioningStepKeySchema.nullable(),
  steps: z.array(z.object({
    key: ProvisioningStepKeySchema,
    status: ProvisioningStepStatusSchema,
    safeMessage: z.string().max(500).nullable(),
    attemptCount: z.number().int().nonnegative(),
  }).strict()).length(PROVISIONING_STEPS.length),
  failureCode: z.string().max(100).nullable(),
  ready: z.boolean(),
}).strict();

export const CombinedReadinessStatusSchema = z.enum([
  'READY', 'ACTION_REQUIRED', 'WARNING', 'BLOCKING', 'NOT_STARTED', 'NOT_AVAILABLE_UNTIL_PHASE_15_9',
]);

export const CombinedReadinessSchema = z.object({
  workspace: CombinedReadinessStatusSchema,
  booking: CombinedReadinessStatusSchema,
  website: CombinedReadinessStatusSchema,
  review: CombinedReadinessStatusSchema,
  payments: CombinedReadinessStatusSchema,
  publication: z.literal('NOT_AVAILABLE_UNTIL_PHASE_15_9'),
  blockingIssues: z.array(z.object({ code: z.string().max(100), area: z.enum(['WORKSPACE', 'BOOKING', 'WEBSITE', 'REVIEW', 'PAYMENTS']), message: z.string().max(500) }).strict()).max(200),
  warnings: z.array(z.object({ code: z.string().max(100), area: z.enum(['WORKSPACE', 'BOOKING', 'WEBSITE', 'REVIEW', 'PAYMENTS']), message: z.string().max(500) }).strict()).max(200),
  ready: z.boolean(),
}).strict();
