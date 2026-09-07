import { z } from 'zod';
import { normalizeBusinessType } from './business-profile.js';
import { TaskPrioritySchema } from './tasks.js';

const ReferenceSchema = z.string().uuid();
const NullableReferenceSchema = ReferenceSchema.nullable();
const IsoDateTimeSchema = z.string().datetime();

export const WorkTypeSchema = z.enum(['JOB', 'PROJECT', 'DELIVERY', 'CASE', 'ORDER']);
export type WorkType = z.infer<typeof WorkTypeSchema>;

export const WorkStatusSchema = z.enum(['DRAFT', 'READY', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED']);
export type WorkStatus = z.infer<typeof WorkStatusSchema>;

export const WorkActivityTypeSchema = z.enum([
  'CREATED', 'CONVERTED_FROM_SALE', 'STATUS_CHANGED', 'ASSIGNED', 'REASSIGNED',
  'SCHEDULE_CHANGED', 'DUE_DATE_CHANGED', 'PRIORITY_CHANGED', 'TASK_CREATED',
  'COMPLETED', 'REOPENED', 'CANCELLED',
]);
export type WorkActivityType = z.infer<typeof WorkActivityTypeSchema>;

const WORK_TYPE_DEFAULTS: Record<string, WorkType> = {
  LOGISTICS_COURIER: 'DELIVERY',
  AGENCY: 'PROJECT',
  CONSULTANCY: 'PROJECT',
  CONSTRUCTION: 'PROJECT',
  PLUMBING: 'JOB',
  ELECTRICAL: 'JOB',
  CLEANING: 'JOB',
  PROPERTY_MANAGEMENT: 'JOB',
  GARAGE_MECHANIC: 'JOB',
  ESTATE_AGENCY: 'CASE',
  CHARITY_NONPROFIT: 'CASE',
  PROFESSIONAL_SERVICES: 'CASE',
  RESTAURANT_CAFE: 'ORDER',
  RETAIL: 'ORDER',
  ECOMMERCE: 'ORDER',
};

export function defaultWorkTypeForBusinessType(value: unknown): WorkType {
  const type = normalizeBusinessType(value);
  return (type && WORK_TYPE_DEFAULTS[type]) || 'JOB';
}

export const CreateWorkItemSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().max(20_000).nullable().optional(),
  workType: WorkTypeSchema.optional(),
  priority: TaskPrioritySchema.default('NORMAL'),
  assignedUserId: z.string().uuid().nullable().optional(),
  scheduledStartAt: IsoDateTimeSchema.nullable().optional(),
  scheduledEndAt: IsoDateTimeSchema.nullable().optional(),
  dueAt: IsoDateTimeSchema.nullable().optional(),
  locationLabel: z.string().trim().max(500).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.scheduledStartAt && value.scheduledEndAt && Date.parse(value.scheduledEndAt) < Date.parse(value.scheduledStartAt)) {
    ctx.addIssue({ code: 'custom', message: 'Scheduled end must be after scheduled start.', path: ['scheduledEndAt'] });
  }
});
export type CreateWorkItemInput = z.infer<typeof CreateWorkItemSchema>;

export const UpdateWorkItemSchema = z.object({
  title: z.string().trim().min(2).max(255).optional(),
  description: z.string().trim().max(20_000).nullable().optional(),
  priority: TaskPrioritySchema.optional(),
  scheduledStartAt: IsoDateTimeSchema.nullable().optional(),
  scheduledEndAt: IsoDateTimeSchema.nullable().optional(),
  dueAt: IsoDateTimeSchema.nullable().optional(),
  locationLabel: z.string().trim().max(500).nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'At least one work field is required.').superRefine((value, ctx) => {
  if (value.scheduledStartAt && value.scheduledEndAt && Date.parse(value.scheduledEndAt) < Date.parse(value.scheduledStartAt)) {
    ctx.addIssue({ code: 'custom', message: 'Scheduled end must be after scheduled start.', path: ['scheduledEndAt'] });
  }
});
export type UpdateWorkItemInput = z.infer<typeof UpdateWorkItemSchema>;

export const ChangeWorkStatusSchema = z.object({
  status: WorkStatusSchema,
  reason: z.string().trim().max(2000).optional(),
}).strict();
export type ChangeWorkStatusInput = z.infer<typeof ChangeWorkStatusSchema>;

export const AssignWorkItemSchema = z.object({ assignedUserId: z.string().uuid().nullable() }).strict();
export type AssignWorkItemInput = z.infer<typeof AssignWorkItemSchema>;

export const CreateWorkFromOpportunitySchema = z.object({
  workType: WorkTypeSchema.optional(),
  title: z.string().trim().min(2).max(255).optional(),
  description: z.string().trim().max(20_000).nullable().optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  priority: TaskPrioritySchema.default('NORMAL'),
  scheduledStartAt: IsoDateTimeSchema.nullable().optional(),
  scheduledEndAt: IsoDateTimeSchema.nullable().optional(),
  dueAt: IsoDateTimeSchema.nullable().optional(),
  locationLabel: z.string().trim().max(500).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.scheduledStartAt && value.scheduledEndAt && Date.parse(value.scheduledEndAt) < Date.parse(value.scheduledStartAt)) {
    ctx.addIssue({ code: 'custom', message: 'Scheduled end must be after scheduled start.', path: ['scheduledEndAt'] });
  }
});
export type CreateWorkFromOpportunityInput = z.infer<typeof CreateWorkFromOpportunitySchema>;

export const CreateWorkTaskSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(2000).nullable().optional(),
  priority: TaskPrioritySchema.default('NORMAL'),
  assignedUserId: z.string().uuid().nullable().optional(),
  dueAt: IsoDateTimeSchema.nullable().optional(),
}).strict();
export type CreateWorkTaskInput = z.infer<typeof CreateWorkTaskSchema>;

export const WorkListQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  status: WorkStatusSchema.optional(),
  workType: WorkTypeSchema.optional(),
  assignedTo: z.union([z.string().uuid(), z.literal('me')]).optional(),
  clientId: z.string().uuid().optional(),
  overdue: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();
export type WorkListQuery = z.infer<typeof WorkListQuerySchema>;

export const WorkItemSchema = z.object({
  reference: ReferenceSchema,
  referenceNumber: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  workType: WorkTypeSchema,
  status: WorkStatusSchema,
  priority: TaskPrioritySchema,
  client: z.object({ id: z.string().uuid(), name: z.string(), email: z.string().nullable(), phone: z.string().nullable() }).nullable(),
  assignedUser: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  sourceOpportunityReference: NullableReferenceSchema,
  sourceQuoteReference: NullableReferenceSchema,
  scheduledStartAt: z.string().nullable(),
  scheduledEndAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  locationLabel: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  blockedReason: z.string().nullable(),
  overdue: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();
export type WorkItem = z.infer<typeof WorkItemSchema>;

export const WorkActivitySchema = z.object({
  reference: ReferenceSchema,
  type: WorkActivityTypeSchema,
  actorUserId: z.string().uuid().nullable(),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
}).strict();

export const WorkTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  priority: TaskPrioritySchema,
  assignedUser: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  dueAt: z.string().nullable(),
  overdue: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export const WorkDetailSchema = z.object({
  work: WorkItemSchema,
  activity: z.array(WorkActivitySchema),
  tasks: z.array(WorkTaskSchema),
}).strict();
export type WorkDetail = z.infer<typeof WorkDetailSchema>;

export const WorkSummarySchema = z.object({
  openCount: z.number().int().min(0),
  inProgressCount: z.number().int().min(0),
  blockedCount: z.number().int().min(0),
  overdueCount: z.number().int().min(0),
  completedCount: z.number().int().min(0),
}).strict();
