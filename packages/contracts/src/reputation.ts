import { z } from 'zod';

export const ReviewProviderSchema = z.enum(['GOOGLE', 'TRUSTPILOT']);
export const ReviewProviderModeSchema = z.enum(['GOOGLE', 'TRUSTPILOT', 'BOTH']);
export const ReviewConnectionTypeSchema = z.enum(['MANUAL_LINK', 'OAUTH', 'API']);
export const ReviewConnectionStatusSchema = z.enum(['CONFIGURED', 'CONNECTED', 'ERROR', 'DISCONNECTED']);
export const ReviewInvitationChannelSchema = z.enum(['EMAIL', 'SMS', 'CUSTOMER_PORTAL']);
export const ReviewInvitationStatusSchema = z.enum([
  'SCHEDULED', 'QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'PROVIDER_CLICKED',
  'CONFIRMED_REVIEW', 'FAILED', 'CANCELLED', 'EXPIRED', 'SUPPRESSED',
]);

export const REVIEW_DELAY_OPTIONS = [0, 120, 360, 1440, 2880, 4320, 10080] as const;
export const DEFAULT_REVIEW_INVITATION_MESSAGE =
  'Thank you for visiting {{salonName}}. We\u2019d value your honest feedback about your experience. You can leave a review using the link below. There\u2019s no obligation to leave a review.';

const prohibitedReviewWording = /(?:five[\s-]*star|5[\s-]*star|discount\s+for\s+(?:a\s+)?review|free\s+gift|reward|positive\s+review|remove\s+your\s+review)/i;

export function hasProhibitedReviewWording(value: string) {
  return prohibitedReviewWording.test(value);
}

export const ReviewInvitationTemplateSchema = z.string().trim().min(40).max(800)
  .refine((value) => !/[<>]/.test(value), 'Review wording must be plain text')
  .refine((value) => !hasProhibitedReviewWording(value), 'Review wording contains prohibited manipulation or incentive language')
  .refine((value) => /honest feedback|honest review/i.test(value), 'Review wording must ask for honest feedback or an honest review')
  .refine((value) => /no obligation/i.test(value), 'Review wording must state that there is no obligation');

export const GoogleReviewLinkInputSchema = z.object({
  locationId: z.string().uuid().nullable().optional(),
  reviewUrl: z.string().url().max(2048),
  businessDisplayName: z.string().trim().min(1).max(160),
}).strict();

export const TrustpilotConnectionInputSchema = z.object({
  connectionType: z.enum(['MANUAL_LINK', 'API']),
  locationId: z.string().uuid().nullable().optional(),
  reviewUrl: z.string().url().max(2048).nullable().optional(),
  businessDisplayName: z.string().trim().min(1).max(160),
  businessUnitId: z.string().trim().max(120).nullable().optional(),
  profileDomain: z.string().trim().max(255).nullable().optional(),
  providerLocationId: z.string().trim().max(120).nullable().optional(),
  locale: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/).default('en-GB'),
  invitationTemplateId: z.string().trim().max(160).nullable().optional(),
  apiCredentials: z.object({
    apiKey: z.string().min(8).max(500),
    accessToken: z.string().min(16).max(4000),
    refreshToken: z.string().min(16).max(4000).optional(),
    authorBusinessUserId: z.string().min(4).max(255).optional(),
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.connectionType === 'MANUAL_LINK' && !value.reviewUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reviewUrl'], message: 'A Trustpilot review URL is required' });
  if (value.connectionType === 'API' && (!value.businessUnitId || !value.apiCredentials)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['businessUnitId'], message: 'Business unit and API credentials are required' });
});

export const ReviewInvitationRuleCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  providerMode: ReviewProviderModeSchema,
  channel: ReviewInvitationChannelSchema,
  delayMinutes: z.union(REVIEW_DELAY_OPTIONS.map((value) => z.literal(value)) as [z.ZodLiteral<0>, z.ZodLiteral<120>, ...z.ZodLiteral<number>[]]),
  locationId: z.string().uuid().nullable().optional(),
  messageTemplate: ReviewInvitationTemplateSchema.default(DEFAULT_REVIEW_INVITATION_MESSAGE),
  privateContactEnabled: z.boolean().default(true),
}).strict();

export const ReviewInvitationRuleUpdateSchema = ReviewInvitationRuleCreateSchema.partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const ReputationListQuerySchema = z.object({
  provider: ReviewProviderSchema.optional(),
  status: z.string().trim().max(40).optional(),
  locationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().datetime().optional(),
}).strict();

export const ReviewReplySchema = z.object({ reply: z.string().trim().min(1).max(2000) }).strict()
  .refine((value) => !/(?:@|\+?\d[\d\s().-]{7,}|appointment|treatment|medical|diagnos|prescription|internal note)/i.test(value.reply), {
    message: 'Reply may contain private customer, appointment, or medical information',
  });

export const ReviewClickSchema = z.object({ provider: ReviewProviderSchema }).strict();

export type ReviewProvider = z.infer<typeof ReviewProviderSchema>;
export type ReviewProviderMode = z.infer<typeof ReviewProviderModeSchema>;
export type ReviewInvitationChannel = z.infer<typeof ReviewInvitationChannelSchema>;
export type ReviewInvitationStatus = z.infer<typeof ReviewInvitationStatusSchema>;
