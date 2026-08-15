import { z } from 'zod';

export const PublicReferenceSchema = z.string().uuid();
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const FactFindingBusinessCategorySchema = z.enum([
  'HAIR_SALON',
  'BEAUTY_CLINIC',
  'BARBER',
  'NAIL_SALON',
  'MASSAGE_THERAPIST',
  'PERSONAL_TRAINER',
  'GENERAL_APPOINTMENT_BUSINESS',
]);
export type FactFindingBusinessCategory = z.infer<typeof FactFindingBusinessCategorySchema>;

export const FactFindingQuestionTypeSchema = z.enum([
  'SHORT_TEXT',
  'LONG_TEXT',
  'RICH_TEXT_SAFE',
  'NUMBER',
  'MONEY',
  'DURATION',
  'DATE',
  'BOOLEAN',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'ADDRESS',
  'PHONE',
  'EMAIL',
  'URL',
  'OPENING_HOURS',
  'SERVICE_LIST',
  'STAFF_LIST',
  'LOCATION_LIST',
  'POLICY',
  'FILE_UPLOAD',
  'IMAGE_UPLOAD',
  'REPEATING_GROUP',
]);
export type FactFindingQuestionType = z.infer<typeof FactFindingQuestionTypeSchema>;

export const FactFieldMappingSchema = z.enum([
  'BUSINESS.LEGAL_NAME',
  'BUSINESS.TRADING_NAME',
  'BUSINESS.DESCRIPTION',
  'BUSINESS.PUBLIC_PHONE',
  'BUSINESS.PUBLIC_EMAIL',
  'BUSINESS.CATEGORY',
  'BUSINESS.AUDIENCE',
  'BUSINESS.DIFFERENTIATORS',
  'BUSINESS.BRAND_VOICE',
  'BUSINESS.CUSTOMER_OBJECTIONS',
  'BUSINESS.LOCAL_CONTEXT',
  'LOCATION.NAME',
  'LOCATION.ADDRESS',
  'LOCATION.OPENING_HOURS',
  'LOCATION.ACCESSIBILITY',
  'LOCATION.PARKING',
  'LOCATION.SERVICE_AREA',
  'SERVICE.NAME',
  'SERVICE.DESCRIPTION',
  'SERVICE.DURATION',
  'SERVICE.PRICE',
  'SERVICE.DEPOSIT',
  'SERVICE.BUFFER',
  'SERVICE.AVAILABLE_LOCATIONS',
  'SERVICE.ELIGIBLE_STAFF',
  'SERVICE.INTAKE_REQUIREMENTS',
  'STAFF.NAME',
  'STAFF.ROLE',
  'STAFF.BIO',
  'STAFF.CREDENTIALS',
  'STAFF.ELIGIBLE_SERVICES',
  'STAFF.LOCATIONS',
  'STAFF.AVAILABILITY',
  'BOOKING.MINIMUM_NOTICE',
  'BOOKING.MAXIMUM_ADVANCE',
  'BOOKING.CANCELLATION_POLICY',
  'BOOKING.RESCHEDULING_POLICY',
  'BOOKING.DEPOSIT_POLICY',
  'BOOKING.CONFIRMATION_BEHAVIOUR',
  'BRAND.LOGO',
  'BRAND.COLOURS',
  'BRAND.TYPOGRAPHY',
  'BRAND.VISUAL_DIRECTION',
  'BRAND.TONE',
  'BRAND.PROHIBITED_TERMS',
  'CONTENT.TESTIMONIAL',
  'CONTENT.REVIEW',
  'CONTENT.RESULT',
  'CONTENT.AWARD',
  'CONTENT.FAQ',
  'CONTENT.BUSINESS_STORY',
  'CONTENT.TRUST_EVIDENCE',
  'CONTENT.IMAGE_SOURCE_POLICY',
  'WEBSITE.REQUESTED_PAGE_TYPES',
  'WEBSITE.EXPLICIT_PAGES',
  'WEBSITE.COMMERCIAL_PRIORITIES',
  'WEBSITE.PRIORITISED_SERVICES',
  'WEBSITE.PRIORITISED_LOCATIONS',
  'WEBSITE.REQUIRED_CONTENT',
  'WEBSITE.PROHIBITED_CONTENT',
  'ASSET.TEAM_PHOTO',
  'ASSET.LOCATION_PHOTO',
  'ASSET.SERVICE_PHOTO',
  'ASSET.RESULT_PHOTO',
  'ASSET.LOGO',
  'ASSET.BRAND_GUIDE',
  'ASSET.POLICY_DOCUMENT',
]);
export type FactFieldMapping = z.infer<typeof FactFieldMappingSchema>;

export const FactFindingQuestionnaireStatusSchema = z.enum([
  'DRAFT',
  'PREQUALIFIED',
  'INVITED',
  'IN_PROGRESS',
  'SUBMITTED',
  'AGENCY_REVIEW',
  'CLARIFICATION_REQUIRED',
  'APPROVED',
  'CANCELLED',
  'SUPERSEDED',
]);
export type FactFindingQuestionnaireStatus = z.infer<typeof FactFindingQuestionnaireStatusSchema>;

export const FactFindingResponseStatusSchema = z.enum([
  'NOT_STARTED',
  'IN_PROGRESS',
  'ANSWERED',
  'SUBMITTED',
  'CLARIFICATION_REQUIRED',
  'CLIENT_CONFIRMED',
  'AGENCY_REVIEW_REQUIRED',
  'AGENCY_APPROVED',
  'AGENCY_REJECTED',
  'SUPERSEDED',
  'NOT_APPLICABLE',
]);
export type FactFindingResponseStatus = z.infer<typeof FactFindingResponseStatusSchema>;

export const FactDataClassificationSchema = z.enum([
  'PUBLIC_FACT',
  'PRIVATE_OPERATIONAL',
  'CONSENT',
  'EVIDENCE',
  'CONTENT_PREFERENCE',
  'ASSET',
]);
export type FactDataClassification = z.infer<typeof FactDataClassificationSchema>;

export const FactVerificationBasisSchema = z.enum([
  'UNVERIFIED',
  'TENANT_CONFIRMED',
  'AGENCY_CONFIRMED',
  'VERIFIED',
]);
export type FactVerificationBasis = z.infer<typeof FactVerificationBasisSchema>;

export const DiscoveryConsentTypeSchema = z.enum([
  'PUBLIC_BUSINESS_INFORMATION',
  'SUPPLIED_IMAGERY_PUBLICATION',
  'TESTIMONIAL_CASE_STUDY_PUBLICATION',
  'AI_STOCK_SUPPORTING_IMAGES',
  'AGENCY_REVIEW_ACKNOWLEDGEMENT',
]);
export type DiscoveryConsentType = z.infer<typeof DiscoveryConsentTypeSchema>;

export const FactFindingBriefStatusSchema = z.enum([
  'DRAFT',
  'BUILDING',
  'REVIEW_REQUIRED',
  'APPROVED',
  'LOCKED_FOR_PROVISIONING',
  'SUPERSEDED',
]);
export type FactFindingBriefStatus = z.infer<typeof FactFindingBriefStatusSchema>;

export const ClarificationStatusSchema = z.enum([
  'OPEN',
  'CLIENT_RESPONDED',
  'RESOLVED',
  'WITHDRAWN',
]);

export const safeFactTextSchema = (maximum = 5_000) => z.string()
  .trim()
  .min(1)
  .max(maximum)
  .refine(value => !/<\s*\/?\s*(?:script|iframe|object|embed|style|form|svg|math)\b/i.test(value), {
    message: 'Executable or embedded content is not permitted.',
  })
  .refine(value => !/(?:javascript|data|vbscript)\s*:/i.test(value), {
    message: 'Executable links are not permitted.',
  });

const SafeKeySchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/);
const SelectOptionSchema = z.object({
  value: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
}).strict();

export const QuestionConditionSchema = z.object({
  questionReference: PublicReferenceSchema,
  operator: z.enum(['EQUALS', 'NOT_EQUALS', 'INCLUDES', 'GREATER_THAN', 'LESS_THAN', 'IS_ANSWERED']),
  value: z.union([z.string().max(500), z.number().finite(), z.boolean()]).optional(),
}).strict();

export const QuestionnaireQuestionSchema = z.object({
  reference: PublicReferenceSchema,
  key: SafeKeySchema,
  label: z.string().trim().min(2).max(300),
  guidance: z.string().trim().max(1_500).optional(),
  questionType: FactFindingQuestionTypeSchema,
  fieldMapping: FactFieldMappingSchema.optional(),
  required: z.boolean().default(false),
  systemRequired: z.boolean().default(false),
  evidenceRequired: z.boolean().default(false),
  publicUseAllowed: z.boolean().default(false),
  bookingUseAllowed: z.boolean().default(false),
  generationUseAllowed: z.boolean().default(false),
  agencyVerificationRequired: z.boolean().default(false),
  dataClassification: FactDataClassificationSchema.default('PUBLIC_FACT'),
  consentType: DiscoveryConsentTypeSchema.optional(),
  conditions: z.array(QuestionConditionSchema).max(10).default([]),
  options: z.array(SelectOptionSchema).max(100).default([]),
  displayOrder: z.number().int().min(0).max(10_000),
}).strict().superRefine((question, context) => {
  if (question.systemRequired && !question.required) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['required'], message: 'System-required questions must remain required.' });
  }
  if ((question.bookingUseAllowed || question.generationUseAllowed || question.publicUseAllowed) && !question.fieldMapping) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['fieldMapping'], message: 'Production-eligible questions require a controlled field mapping.' });
  }
  if (question.dataClassification === 'CONSENT' && !question.consentType) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['consentType'], message: 'Consent questions require an explicit consent type.' });
  }
  if (question.dataClassification !== 'PUBLIC_FACT' && question.publicUseAllowed) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dataClassification'],
      message: 'Only PUBLIC_FACT questions may be eligible for direct public use.',
    });
  }
  if (!['PUBLIC_FACT', 'CONTENT_PREFERENCE'].includes(question.dataClassification)
    && question.generationUseAllowed) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['generationUseAllowed'],
      message: 'Only reviewed public facts and content preferences may enter generation.',
    });
  }
});

export const QuestionnaireSectionSchema = z.object({
  reference: PublicReferenceSchema,
  key: SafeKeySchema,
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1_000).optional(),
  displayOrder: z.number().int().min(0).max(1_000),
  optional: z.boolean().default(false),
  questions: z.array(QuestionnaireQuestionSchema).min(1).max(100),
}).strict();

export const CreateQuestionnaireTemplateSchema = z.object({
  key: SafeKeySchema,
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1_000).optional(),
  businessCategories: z.array(FactFindingBusinessCategorySchema).min(1).max(20),
  planKeys: z.array(z.enum(['CORE', 'GROWTH', 'SCALE'])).min(1).max(3),
  sections: z.array(QuestionnaireSectionSchema).min(1).max(40),
}).strict();

export const CreateQuestionnaireSchema = z.object({
  templateReference: PublicReferenceSchema,
  dueAt: z.coerce.date().optional(),
  assignedReviewerReference: PublicReferenceSchema.optional(),
  participant: z.object({
    displayName: z.string().trim().min(1).max(200),
    email: z.string().email().max(320),
  }).strict().optional(),
}).strict();

export const PrequalifyQuestionnaireSchema = z.object({
  questionOverrides: z.array(z.object({
    questionReference: PublicReferenceSchema,
    included: z.boolean(),
    required: z.boolean().optional(),
    guidance: z.string().trim().max(1_500).optional(),
    prefilledAnswer: z.unknown().optional(),
    conditions: z.array(QuestionConditionSchema).max(10).optional(),
  }).strict()).max(1_000),
  dueAt: z.coerce.date().optional(),
}).strict();

const AddressAnswerSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(120),
  postcode: z.string().trim().min(2).max(20),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
}).strict();
const MoneyAnswerSchema = z.object({ amountMinor: z.number().int().nonnegative().max(1_000_000_000), currency: z.string().regex(/^[A-Z]{3}$/) }).strict();
const HoursAnswerSchema = z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), opensAt: z.string().regex(/^\d{2}:\d{2}$/), closesAt: z.string().regex(/^\d{2}:\d{2}$/), closed: z.boolean().default(false) }).strict()).max(14);
const ReferenceListAnswerSchema = z.array(z.object({ reference: PublicReferenceSchema, label: z.string().trim().min(1).max(255) }).strict()).max(200);

export const FactAnswerValueSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(1_000)).max(200),
  AddressAnswerSchema,
  MoneyAnswerSchema,
  HoursAnswerSchema,
  ReferenceListAnswerSchema,
]);

export const SaveFactFindingResponseSchema = z.object({
  questionReference: PublicReferenceSchema,
  answer: FactAnswerValueSchema,
  source: z.enum(['CLIENT_PROVIDED', 'AGENCY_PROVIDED']),
  clientConfirmed: z.boolean().default(false),
}).strict();

export const AgencyFactDecisionSchema = z.object({
  approvedValue: FactAnswerValueSchema.optional(),
  publicUseEligible: z.boolean(),
  bookingUseEligible: z.boolean(),
  generationUseEligible: z.boolean(),
  verificationBasis: z.enum(['AGENCY_CONFIRMED', 'VERIFIED']).default('AGENCY_CONFIRMED'),
  note: safeFactTextSchema(2_000).optional(),
}).strict();

export const MarkFactNotApplicableSchema = z.object({
  reason: safeFactTextSchema(2_000),
}).strict();

export const RejectFactResponseSchema = z.object({ reason: safeFactTextSchema(2_000) }).strict();
export const RequestClarificationSchema = z.object({
  message: safeFactTextSchema(2_000),
  requiredResponseType: FactFindingQuestionTypeSchema,
  evidenceRequested: z.boolean().default(false),
  dueAt: z.coerce.date().optional(),
}).strict();
export const RespondToClarificationSchema = z.object({ response: FactAnswerValueSchema }).strict();

export const FactFindingAssetCategorySchema = z.enum([
  'TEAM_PHOTO', 'LOCATION_PHOTO', 'SERVICE_PHOTO', 'RESULT_PHOTO', 'LOGO',
  'BRAND_GUIDE', 'POLICY_DOCUMENT', 'CERTIFICATE', 'AWARD_EVIDENCE',
  'PRICE_LIST', 'BROCHURE', 'WEBSITE_COPY', 'SERVICE_MENU', 'SUPPORTING_DOCUMENT',
]);
export const FactFindingUploadSchema = z.object({
  questionReference: PublicReferenceSchema.optional(),
  fileName: z.string().trim().min(1).max(255).refine(value => !/[\\/\0]/.test(value), 'Filename is unsafe.'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'application/pdf', 'text/plain']),
  byteSize: z.number().int().positive().max(20 * 1024 * 1024),
  digestSha256: Sha256Schema,
  category: FactFindingAssetCategorySchema,
  publicUsePermission: z.boolean(),
  aiUsePermission: z.boolean(),
  copyrightConfirmed: z.literal(true),
  consentStatus: z.enum(['NOT_APPLICABLE', 'CONFIRMED', 'REQUIRED']),
}).strict();

export const AssetEntityBindingSchema = z.discriminatedUnion('entityType', [
  z.object({ entityType: z.literal('NONE') }).strict(),
  z.object({
    entityType: z.literal('STAFF'),
    entityReference: PublicReferenceSchema,
  }).strict(),
  z.object({
    entityType: z.literal('SERVICE'),
    entityReference: PublicReferenceSchema,
  }).strict(),
]);

export const BuildProductionBriefSchema = z.object({
  includeResponseReferences: z.array(PublicReferenceSchema).max(5_000).optional(),
}).strict();

export const FactFindingSessionExchangeSchema = z.object({ invitationToken: z.string().min(32).max(2_048) }).strict();

export const FACT_FINDING_SECTIONS = [
  'BUSINESS_IDENTITY', 'LEGAL_AND_TRADING', 'PRIMARY_CONTACTS', 'LOCATIONS_AND_SERVICE_AREAS',
  'SERVICES', 'PRICING_AND_DURATIONS', 'STAFF_AND_CREDENTIALS', 'OPENING_HOURS_AND_AVAILABILITY',
  'BOOKING_PREFERENCES', 'DEPOSITS_AND_PAYMENTS', 'INTAKE_AND_CONSENT', 'CANCELLATION_AND_RESCHEDULING',
  'TARGET_CUSTOMERS', 'CUSTOMER_PROBLEMS_AND_OUTCOMES', 'DIFFERENTIATORS', 'COMMON_OBJECTIONS',
  'BRAND_STORY', 'BRAND_PERSONALITY_AND_TONE', 'COMPETITORS_AND_POSITIONING', 'TESTIMONIALS_AND_REVIEWS',
  'RESULTS_AND_CASE_STUDIES', 'AWARDS_AND_QUALIFICATIONS', 'FAQS', 'LOCAL_AREA', 'SEO_TOPICS',
  'EXISTING_WEB_AND_SOCIAL', 'BRAND_ASSETS', 'PHOTOGRAPHY', 'LEGAL_AND_POLICY_DOCUMENTS', 'AGENCY_NOTES',
] as const;
