import { PublicReferenceSchema } from '@ks-os/contracts';
import { z } from 'zod';

export const ReviewCycleStatusSchema = z.enum([
  'DRAFT',
  'INTERNAL_REVIEW',
  'INTERNAL_CHANGES_REQUIRED',
  'READY_FOR_CLIENT_REVIEW',
  'CLIENT_REVIEW',
  'CLIENT_CHANGES_REQUESTED',
  'CLIENT_APPROVED',
  'AGENCY_FINAL_REVIEW',
  'AGENCY_APPROVED',
  'REJECTED',
  'CANCELLED',
  'SUPERSEDED',
]);
export type ReviewCycleStatus = z.infer<typeof ReviewCycleStatusSchema>;

export const ReviewScopeSchema = z.enum([
  'FULL_SITE',
  'PAGE',
  'SECTION',
  'FACTS_ONLY',
  'COPY_ONLY',
  'DESIGN_AND_STRUCTURE',
  'FINAL_APPROVAL',
]);
export type ReviewScope = z.infer<typeof ReviewScopeSchema>;

export const ReviewParticipantTypeSchema = z.enum([
  'AGENCY_USER',
  'TENANT_USER',
  'EXTERNAL_REVIEWER',
]);
export const ReviewParticipantRoleSchema = z.enum([
  'AGENCY_OWNER',
  'AGENCY_REVIEWER',
  'CLIENT_APPROVER',
  'CLIENT_REVIEWER',
  'FACT_VERIFIER',
  'VIEW_ONLY',
]);
export type ReviewParticipantRole = z.infer<typeof ReviewParticipantRoleSchema>;

export const ReviewItemTargetTypeSchema = z.enum([
  'SITE',
  'PAGE',
  'SECTION',
  'FIELD',
  'METADATA',
  'NAVIGATION',
  'BOOKING_ACTION',
  'STRUCTURED_DATA_INPUT',
  'FACT',
  'GENERATION_FINDING',
]);
export const ReviewItemStatusSchema = z.enum([
  'PENDING',
  'IN_REVIEW',
  'COMMENTED',
  'CHANGE_REQUESTED',
  'APPROVED',
  'REJECTED',
  'NOT_APPLICABLE',
  'SUPERSEDED',
]);

export const CommentStatusSchema = z.enum([
  'OPEN',
  'RESOLVED',
  'DISMISSED',
  'DELETED',
]);
export const CommentVisibilitySchema = z.enum(['INTERNAL', 'CLIENT_VISIBLE']);
export const CommentAnchorStatusSchema = z.enum([
  'CURRENT',
  'OUTDATED',
  'REQUIRES_REANCHOR',
]);

export const CommentAnchorSchema = z.object({
  pagePublicReference: PublicReferenceSchema.optional(),
  sectionPublicReference: PublicReferenceSchema.optional(),
  fieldPath: z.string().trim().min(1).max(500).regex(/^[A-Za-z0-9_.\[\]-]+$/).optional(),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  textExcerpt: z.string().trim().max(280).optional(),
  startOffset: z.number().int().nonnegative().max(1_000_000).optional(),
  endOffset: z.number().int().nonnegative().max(1_000_000).optional(),
}).strict().superRefine((anchor, context) => {
  if (
    anchor.startOffset !== undefined
    && anchor.endOffset !== undefined
    && anchor.endOffset < anchor.startOffset
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'The end offset must not precede the start offset.',
      path: ['endOffset'],
    });
  }
});
export type CommentAnchor = z.infer<typeof CommentAnchorSchema>;

const UNSAFE_REVIEW_TEXT = /<\s*\/?\s*[a-z][^>]*>|javascript\s*:|data\s*:\s*text\/html|vbscript\s*:|(?:^|\W)(?:eval|document\.cookie|window\.location)\s*\(|\b(?:iframe|script|object|embed)\b/i;
export function containsUnsafeReviewText(value: string): boolean {
  return UNSAFE_REVIEW_TEXT.test(value);
}

export const safeReviewTextSchema = (maxLength = 4_000) => z.string()
  .trim()
  .min(1)
  .max(maxLength)
  .refine((value: string) => !containsUnsafeReviewText(value), {
    message: 'Review text contains HTML, executable content, or an unsafe link.',
  });
export const SafeReviewTextSchema = safeReviewTextSchema();

export const CreateCommentSchema = z.object({
  reviewItemReference: PublicReferenceSchema.optional(),
  parentCommentReference: PublicReferenceSchema.optional(),
  anchor: CommentAnchorSchema.optional(),
  body: safeReviewTextSchema(2_000),
  visibility: CommentVisibilitySchema.default('CLIENT_VISIBLE'),
}).strict();

export const UpdateCommentSchema = z.object({
  body: safeReviewTextSchema(2_000),
}).strict();

export const ChangeRequestCategorySchema = z.enum([
  'FACT_CORRECTION',
  'COPY_CHANGE',
  'SERVICE_CHANGE',
  'PRICE_CHANGE',
  'STAFF_CHANGE',
  'LOCATION_CHANGE',
  'POLICY_CHANGE',
  'DESIGN_FEEDBACK',
  'LAYOUT_CHANGE',
  'IMAGE_CHANGE',
  'SEO_CHANGE',
  'BOOKING_CHANGE',
  'ACCESSIBILITY_CHANGE',
  'OTHER',
]);
export const ChangeRequestPrioritySchema = z.enum(['URGENT', 'HIGH', 'NORMAL', 'LOW']);
export const ChangeRequestStatusSchema = z.enum([
  'OPEN',
  'TRIAGED',
  'ACCEPTED',
  'IN_PROGRESS',
  'READY_FOR_REVIEW',
  'RESOLVED',
  'REJECTED',
  'CANCELLED',
  'SUPERSEDED',
]);
export const ChangeRequestResolutionTypeSchema = z.enum([
  'MANUAL_CONTENT_REVISION',
  'SECTION_REGENERATION',
  'PAGE_REGENERATION',
  'FACT_DATA_UPDATE_REQUIRED',
  'NO_CHANGE_REQUIRED',
  'REQUEST_REJECTED',
  'DUPLICATE_REQUEST',
  'DEFERRED',
]);

export const CreateChangeRequestSchema = z.object({
  reviewItemReference: PublicReferenceSchema.optional(),
  pageReference: PublicReferenceSchema.optional(),
  sectionReference: PublicReferenceSchema.optional(),
  fieldPath: z.string().trim().min(1).max(500).regex(/^[A-Za-z0-9_.\[\]-]+$/).optional(),
  category: ChangeRequestCategorySchema,
  priority: ChangeRequestPrioritySchema.default('NORMAL'),
  title: safeReviewTextSchema(160),
  description: safeReviewTextSchema(4_000),
  requestedOutcome: safeReviewTextSchema(2_000).optional(),
}).strict();

const PROHIBITED_CHANGE_REQUEST = [
  /\b(?:publish|deploy|go live)\b.*\b(?:now|directly|immediately)\b/i,
  /\b(?:external|third[- ]party)\b.*\bbook(?:ing)?\b/i,
  /\b(?:calendly|fresha|treatwell|booksy|mindbody)\b/i,
  /\b(?:invent|fabricate|make up|fake)\b.*\b(?:review|testimonial|price|credential|qualification|award|result)\b/i,
  /\b(?:other tenant|cross[- ]tenant|another client)\b/i,
  /\b(?:private data|password|secret|credential|access token)\b/i,
  /\b(?:bypass|disable)\b.*\b(?:security|validation|approval|tenant)\b/i,
] as const;

export function assertSafeChangeRequest(
  input: z.infer<typeof CreateChangeRequestSchema>,
): void {
  const combined = `${input.title}\n${input.description}\n${input.requestedOutcome ?? ''}`;
  if (PROHIBITED_CHANGE_REQUEST.some((pattern) => pattern.test(combined))) {
    throw new Error('SITE_REVIEW_CHANGE_REQUEST_UNSAFE');
  }
}

export const UpdateChangeRequestSchema = z.object({
  priority: ChangeRequestPrioritySchema.optional(),
  assignedAgencyUserReference: PublicReferenceSchema.nullable().optional(),
  resolutionNotes: safeReviewTextSchema(2_000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one change is required.',
});

export const ResolveChangeRequestSchema = z.object({
  resolutionType: ChangeRequestResolutionTypeSchema,
  resolutionNotes: safeReviewTextSchema(2_000),
  resultingVersionReference: PublicReferenceSchema.optional(),
  resultingPageReference: PublicReferenceSchema.optional(),
  resultingSectionReference: PublicReferenceSchema.optional(),
}).strict();

export const BoundedRegenerationReasonSchema = z.object({
  reasonCode: z.enum([
    'CLIENT_COPY_CORRECTION',
    'CLIENT_FACT_CORRECTION',
    'AGENCY_QUALITY_CORRECTION',
    'ACCESSIBILITY_CORRECTION',
  ]),
  instruction: z.string()
    .trim()
    .min(8)
    .max(1_000)
    .refine((value) => !containsUnsafeReviewText(value), {
      message: 'Regeneration instruction contains unsafe content.',
    }),
}).strict();

export const FactTypeSchema = z.enum([
  'LEGAL_BUSINESS_NAME',
  'TRADING_NAME',
  'PHONE',
  'EMAIL',
  'ADDRESS',
  'OPENING_HOURS',
  'SERVICE_NAME',
  'SERVICE_DESCRIPTION',
  'SERVICE_PRICE',
  'SERVICE_DURATION',
  'STAFF_NAME',
  'STAFF_ROLE',
  'STAFF_CREDENTIAL',
  'STAFF_BIO',
  'LOCATION',
  'SERVICE_AREA',
  'POLICY',
  'QUALIFICATION',
  'AWARD',
  'GUARANTEE',
  'REVIEW',
  'TESTIMONIAL',
  'RESULT',
  'OTHER',
]);
export const FactVerificationStatusSchema = z.enum([
  'UNVERIFIED',
  'PENDING_REVIEW',
  'CONFIRMED',
  'DISPUTED',
  'REQUIRES_EVIDENCE',
  'REJECTED',
  'SUPERSEDED',
  'NOT_APPLICABLE',
]);
export const FactResponseSchema = z.object({
  response: z.enum(['CONFIRM', 'DISPUTE']),
  note: safeReviewTextSchema(1_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.response === 'DISPUTE' && !value.note) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A disputed fact requires a note.',
      path: ['note'],
    });
  }
});

export const AgencyFactDecisionSchema = z.object({
  status: FactVerificationStatusSchema,
  agencyDecision: safeReviewTextSchema(1_000).optional(),
  evidenceReference: PublicReferenceSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  if (['REQUIRES_EVIDENCE', 'REJECTED'].includes(value.status) && !value.agencyDecision) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'An agency decision note is required.',
      path: ['agencyDecision'],
    });
  }
});

export const ApprovalDecisionSchema = z.enum([
  'APPROVE',
  'APPROVE_WITH_NOTES',
  'REQUEST_CHANGES',
  'REJECT',
  'WITHDRAW_APPROVAL',
]);
export const ApprovalLevelSchema = z.enum([
  'ITEM',
  'PAGE',
  'FULL_SITE',
  'CLIENT_FINAL',
  'AGENCY_FINAL',
]);
export const CreateApprovalDecisionSchema = z.object({
  decision: ApprovalDecisionSchema,
  approvalLevel: ApprovalLevelSchema,
  reviewItemReference: PublicReferenceSchema.optional(),
  pageReference: PublicReferenceSchema.optional(),
  notes: safeReviewTextSchema(2_000).optional(),
}).strict().superRefine((value, context) => {
  if (['REQUEST_CHANGES', 'REJECT'].includes(value.decision) && !value.notes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A reason is required for this decision.',
      path: ['notes'],
    });
  }
});

export const PreviewSessionPurposeSchema = z.enum([
  'AGENCY_REVIEW',
  'CLIENT_REVIEW',
  'FACT_VERIFICATION',
  'FINAL_APPROVAL',
]);
export const InvitationStatusSchema = z.enum([
  'PENDING',
  'QUEUED',
  'SENT',
  'OPENED',
  'ACCEPTED',
  'EXPIRED',
  'REVOKED',
  'FAILED',
]);

export const CreateReviewCycleSchema = z.object({
  versionReference: PublicReferenceSchema,
  reviewScope: ReviewScopeSchema,
  pageReference: PublicReferenceSchema.optional(),
  sectionReference: PublicReferenceSchema.optional(),
  clientApprovalRequired: z.boolean().default(true),
  agencyApprovalRequired: z.boolean().default(true),
}).strict().superRefine((value, context) => {
  if (value.reviewScope === 'PAGE' && !value.pageReference) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Page scope requires a page.', path: ['pageReference'] });
  }
  if (value.reviewScope === 'SECTION' && (!value.pageReference || !value.sectionReference)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Section scope requires a page and section.', path: ['sectionReference'] });
  }
});

export const AddReviewParticipantSchema = z.object({
  participantType: ReviewParticipantTypeSchema,
  role: ReviewParticipantRoleSchema,
  agencyUserReference: PublicReferenceSchema.optional(),
  tenantUserReference: PublicReferenceSchema.optional(),
  contactReference: PublicReferenceSchema.optional(),
  displayName: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(320),
}).strict().superRefine((value, context) => {
  if (value.participantType === 'AGENCY_USER') {
    if (!value.agencyUserReference || value.tenantUserReference || value.contactReference) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Agency participants require only an agency-user identity.', path: ['agencyUserReference'] });
    }
    if (!['AGENCY_OWNER', 'AGENCY_REVIEWER'].includes(value.role)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Agency participants require an agency review role.', path: ['role'] });
    }
  }
  if (value.participantType === 'TENANT_USER') {
    if (!value.tenantUserReference || value.agencyUserReference || value.contactReference) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Tenant participants require only a tenant-user identity.', path: ['tenantUserReference'] });
    }
    if (['AGENCY_OWNER', 'AGENCY_REVIEWER'].includes(value.role)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Tenant participants cannot receive an agency review role.', path: ['role'] });
    }
  }
  if (value.participantType === 'EXTERNAL_REVIEWER') {
    if (value.agencyUserReference || value.tenantUserReference) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'External participants cannot claim a user identity.', path: ['participantType'] });
    }
    if (['AGENCY_OWNER', 'AGENCY_REVIEWER'].includes(value.role)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'External reviewers cannot receive an agency review role.', path: ['role'] });
    }
  }
});

export const ReviewTransitionActionSchema = z.enum([
  'OPEN_INTERNAL_REVIEW',
  'REQUEST_INTERNAL_CHANGES',
  'MARK_READY_FOR_CLIENT',
  'START_CLIENT_REVIEW',
  'REQUEST_CLIENT_CHANGES',
  'MARK_CLIENT_APPROVED',
  'START_AGENCY_FINAL_REVIEW',
  'MARK_AGENCY_APPROVED',
  'REJECT',
  'CANCEL',
  'SUPERSEDE',
]);

export const ReviewReadinessBlockingCodeSchema = z.enum([
  'VERSION_INCOMPLETE',
  'VERSION_SUPERSEDED',
  'GENERATION_FAILED',
  'OPEN_BLOCKING_FINDING',
  'PROHIBITED_CLAIM',
  'INVALID_BOOKING_ACTION',
  'EXTERNAL_BOOKING_ACTION',
  'MISSING_REQUIRED_PAGE',
  'MISSING_REQUIRED_SECTION',
  'DISPUTED_REQUIRED_FACT',
  'UNVERIFIED_REQUIRED_FACT',
  'OPEN_REQUIRED_CHANGE_REQUEST',
  'STALE_APPROVAL',
  'MISSING_CLIENT_APPROVER',
  'MISSING_AGENCY_APPROVER',
  'PREVIEW_UNAVAILABLE',
  'CROSS_TENANT_REFERENCE',
  'OTHER',
]);
export type ReviewReadinessBlockingCode = z.infer<typeof ReviewReadinessBlockingCodeSchema>;

export const ReviewReadinessSchema = z.object({
  ready: z.boolean(),
  blockingReasons: z.array(ReviewReadinessBlockingCodeSchema),
  warningReasons: z.array(z.string().trim().min(1).max(120)),
  openBlockingItemCount: z.number().int().nonnegative(),
  openCommentCount: z.number().int().nonnegative(),
  openChangeRequestCount: z.number().int().nonnegative(),
  disputedFactCount: z.number().int().nonnegative(),
  unresolvedFindingCount: z.number().int().nonnegative(),
  invalidBookingActionCount: z.number().int().nonnegative(),
  staleApprovalCount: z.number().int().nonnegative(),
  participantStatus: z.object({
    clientApproverPresent: z.boolean(),
    agencyApproverPresent: z.boolean(),
  }).strict(),
  versionCompleteness: z.enum(['COMPLETE', 'INCOMPLETE', 'SUPERSEDED']),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ReviewReadiness = z.infer<typeof ReviewReadinessSchema>;
