import { z } from 'zod';

export const OperationsIssueCategorySchema = z.enum(['EMAIL','SMS','AUTOMATION','PAYMENT','REFUND','STRIPE','PAYOUT','DISPUTE','FORM','APPOINTMENT','TEAM','SYSTEM']);
export const OperationsIssueTypeSchema = z.enum(['EMAIL_FAILED','EMAIL_BOUNCED','SMS_FAILED','AUTOMATION_ACTION_FAILED','PAYMENT_FAILED','REFUND_FAILED','CUSTOMER_CANCELLATION_REFUND_REVIEW','STRIPE_ACTION_REQUIRED','PAYOUT_FAILED','DISPUTE_EVIDENCE_REQUIRED','FORM_DELIVERY_FAILED','FORM_OVERDUE','APPOINTMENT_PAYMENT_REQUIRED','TEAM_ACTION_REQUIRED','SYSTEM_FAILURE']);
export const OperationsIssueSeveritySchema = z.enum(['INFO','WARNING','CRITICAL']);
export const OperationsIssueStatusSchema = z.enum(['OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED']);
export const OperationsIssueSourceTypeSchema = z.enum(['EMAIL_OUTBOX','SMS_OUTBOX','AUTOMATION_ACTION_RUN','PAYMENT_ATTEMPT','REFUND','STRIPE_CONNECTION','PAYOUT','DISPUTE','FORM_ASSIGNMENT','APPOINTMENT','TEAM_MEMBER','SYSTEM']);

export const OperationsIssueSchema = z.object({
  id:z.string().uuid(), tenantId:z.string().uuid(), category:OperationsIssueCategorySchema, issueType:OperationsIssueTypeSchema,
  severity:OperationsIssueSeveritySchema, status:OperationsIssueStatusSchema, title:z.string(), message:z.string(),
  sourceType:OperationsIssueSourceTypeSchema, sourceId:z.string(), deduplicationKey:z.string(), occurrenceCount:z.number().int().positive(),
  relatedAppointmentId:z.string().uuid().nullable(), actionDeadline:z.string().datetime().nullable(), metadata:z.record(z.unknown()),
  assignedToUserId:z.string().uuid().nullable(), acknowledgedByUserId:z.string().uuid().nullable(), resolvedByUserId:z.string().uuid().nullable(),
  occurredAt:z.string().datetime(), lastOccurredAt:z.string().datetime(), acknowledgedAt:z.string().datetime().nullable(), resolvedAt:z.string().datetime().nullable(), dismissedAt:z.string().datetime().nullable(), createdAt:z.string().datetime(), updatedAt:z.string().datetime()
}).strict();
export const OperationsIssueListQuerySchema=z.object({status:OperationsIssueStatusSchema.optional(),category:OperationsIssueCategorySchema.optional(),severity:OperationsIssueSeveritySchema.optional(),assignedTo:z.string().uuid().optional(),cursor:z.string().datetime().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)}).strict();
export const OperationsIssueIdParamsSchema=z.object({issueId:z.string().uuid()}).strict();
export const AssignOperationsIssueSchema=z.object({assignedToUserId:z.string().uuid().nullable()}).strict();
export const OperationsIssueListResponseSchema=z.object({data:z.array(OperationsIssueSchema),nextCursor:z.string().datetime().nullable()}).strict();
export const OperationsIssueResponseSchema=z.object({data:OperationsIssueSchema}).strict();
export const OperationsIssueSummarySchema=z.object({open:z.number().int().nonnegative(),acknowledged:z.number().int().nonnegative(),critical:z.number().int().nonnegative(),totalActionable:z.number().int().nonnegative()}).strict();
export const OperationsIssueSummaryResponseSchema=z.object({data:OperationsIssueSummarySchema}).strict();
export const OperationsRetryResponseSchema=z.object({data:z.object({accepted:z.literal(true),status:z.enum(['QUEUED','COMPLETED'])}).strict()}).strict();

export type OperationsIssue=z.infer<typeof OperationsIssueSchema>;
export type OperationsIssueListQuery=z.infer<typeof OperationsIssueListQuerySchema>;
export type OperationsIssueCategory=z.infer<typeof OperationsIssueCategorySchema>;
export type OperationsIssueType=z.infer<typeof OperationsIssueTypeSchema>;
export type OperationsIssueSeverity=z.infer<typeof OperationsIssueSeveritySchema>;
export type OperationsIssueSourceType=z.infer<typeof OperationsIssueSourceTypeSchema>;
