import {z} from 'zod';

export const TaskStatusSchema=z.enum(['OPEN','IN_PROGRESS','COMPLETED','CANCELLED']);
export const TaskPrioritySchema=z.enum(['LOW','NORMAL','HIGH','URGENT']);
export const TaskSourceTypeSchema=z.enum(['MANUAL','OPERATIONS_ISSUE','APPOINTMENT','CLIENT','FORM_ASSIGNMENT','PAYMENT','REFUND','AUTOMATION','PRODUCT','WORK_ITEM']);
const PublicTaskSourceTypeSchema=TaskSourceTypeSchema.exclude(['WORK_ITEM']);
export const TaskActivityTypeSchema=z.enum(['CREATED','ASSIGNED','REASSIGNED','STARTED','COMPLETED','REOPENED','CANCELLED','DUE_DATE_CHANGED','PRIORITY_CHANGED']);

const NullableUuid=z.string().uuid().nullable();
export const TaskSummarySchema=z.object({
 id:z.string().uuid(),title:z.string(),status:TaskStatusSchema,priority:TaskPrioritySchema,dueAt:z.string().datetime().nullable(),overdue:z.boolean(),tenantTimezone:z.string(),
 assignedUser:z.object({id:z.string().uuid(),name:z.string()}).nullable(),sourceType:TaskSourceTypeSchema,appointmentId:NullableUuid,clientId:NullableUuid,operationsIssueId:NullableUuid,
 createdAt:z.string().datetime(),updatedAt:z.string().datetime()
}).strict();
export const TaskDetailSchema=TaskSummarySchema.extend({description:z.string().nullable(),notes:z.string().nullable(),sourceId:NullableUuid,formAssignmentId:NullableUuid,automationRunId:NullableUuid,createdByUserId:z.string().uuid(),completedAt:z.string().datetime().nullable(),completedByUserId:NullableUuid,cancelledAt:z.string().datetime().nullable(),cancelledByUserId:NullableUuid}).strict();
export const TaskActivitySchema=z.object({id:z.string().uuid(),activityType:TaskActivityTypeSchema,actorUserId:NullableUuid,fromValue:z.string().nullable(),toValue:z.string().nullable(),createdAt:z.string().datetime()}).strict();

export const CreateTaskSchema=z.object({title:z.string().trim().min(1).max(180),description:z.string().trim().max(2000).nullable().optional(),notes:z.string().trim().max(2000).nullable().optional(),priority:TaskPrioritySchema.default('NORMAL'),assignedUserId:NullableUuid.optional(),dueAt:z.string().datetime().nullable().optional(),sourceType:PublicTaskSourceTypeSchema.default('MANUAL'),sourceId:NullableUuid.optional(),appointmentId:NullableUuid.optional(),clientId:NullableUuid.optional(),operationsIssueId:NullableUuid.optional(),formAssignmentId:NullableUuid.optional()}).strict();
export const UpdateTaskSchema=z.object({title:z.string().trim().min(1).max(180).optional(),description:z.string().trim().max(2000).nullable().optional(),notes:z.string().trim().max(2000).nullable().optional(),priority:TaskPrioritySchema.optional(),dueAt:z.string().datetime().nullable().optional()}).strict().refine(x=>Object.keys(x).length>0,'At least one task field is required.');
export const AssignTaskSchema=z.object({assignedUserId:z.string().uuid()}).strict();
export const TaskIdParamsSchema=z.object({taskId:z.string().uuid()}).strict();
export const TaskListQuerySchema=z.object({status:TaskStatusSchema.optional(),priority:TaskPrioritySchema.optional(),assignedTo:z.union([z.string().uuid(),z.literal('me')]).optional(),sourceType:TaskSourceTypeSchema.optional(),overdue:z.enum(['true','false']).transform(x=>x==='true').optional(),dueFrom:z.string().datetime().optional(),dueTo:z.string().datetime().optional(),search:z.string().trim().max(100).optional(),cursor:z.string().max(512).optional(),limit:z.coerce.number().int().min(1).max(100).default(30)}).strict();

export const TaskListResponseSchema=z.object({data:z.array(TaskSummarySchema),nextCursor:z.string().nullable()}).strict();
export const TaskResponseSchema=z.object({data:TaskDetailSchema}).strict();
export const TaskActivityResponseSchema=z.object({data:z.array(TaskActivitySchema)}).strict();
export type TaskStatus=z.infer<typeof TaskStatusSchema>;export type TaskPriority=z.infer<typeof TaskPrioritySchema>;export type TaskSourceType=z.infer<typeof TaskSourceTypeSchema>;export type TaskSummary=z.infer<typeof TaskSummarySchema>;export type TaskDetail=z.infer<typeof TaskDetailSchema>;export type TaskActivity=z.infer<typeof TaskActivitySchema>;export type CreateTaskInput=z.infer<typeof CreateTaskSchema>;export type UpdateTaskInput=z.infer<typeof UpdateTaskSchema>;export type TaskListQuery=z.infer<typeof TaskListQuerySchema>;
