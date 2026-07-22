import { z } from 'zod';
import { AnalyticsPresetSchema } from './analytics.js';

export const ExportableReportTypeSchema = z.enum(['APPOINTMENTS','CLIENTS','SERVICES','STAFF_ACTIVITY','PRODUCTS','STOCK','PAYMENTS','REFUNDS','FORMS','COMMUNICATIONS']);
export const ReportExportStatusSchema = z.enum(['PENDING','PROCESSING','READY','FAILED','EXPIRED','CANCELLED']);
export const ReportScheduleStatusSchema = z.enum(['ACTIVE','PAUSED','DELETED']);
export const ReportFrequencySchema = z.enum(['DAILY','WEEKLY','MONTHLY']);

export const ReportExportFiltersSchema = z.object({
  period: AnalyticsPresetSchema.optional(), from: z.string().date().optional(), to: z.string().date().optional(), search: z.string().trim().min(1).max(120).optional(),
  status: z.string().trim().min(1).max(40).optional(), staffId: z.string().uuid().optional(), serviceId: z.string().uuid().optional(), clientId: z.string().uuid().optional(),
  bookingChannel: z.enum(['in_shop','mobile']).optional(), paymentStatus: z.string().trim().min(1).max(30).optional(), source: z.string().trim().min(1).max(40).optional(),
  method: z.enum(['CARD','CASH','SPLIT']).optional(), newOrReturning: z.enum(['NEW','RETURNING']).optional(), lastVisitRange: z.enum(['LAST_30_DAYS','LAST_90_DAYS','OVER_90_DAYS','NEVER']).optional(),
  accountStatus: z.enum(['ACTIVE','SUSPENDED','DEACTIVATED']).optional(), templateId: z.string().uuid().optional(), versionId: z.string().uuid().optional(),
  channel: z.enum(['EMAIL','SMS']).optional(), template: z.string().trim().min(1).max(80).optional(), sort: z.string().trim().min(1).max(40).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.period === 'CUSTOM' && (!value.from || !value.to)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Custom periods require from and to dates.' });
  if (value.period !== 'CUSTOM' && (value.from || value.to)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'from and to are only valid for CUSTOM periods.' });
});

export const CreateReportExportSchema = z.object({ reportType: ExportableReportTypeSchema, filters: ReportExportFiltersSchema.default({}), format: z.literal('CSV').default('CSV') }).strict();
export const ReportExportIdParamsSchema = z.object({ exportId: z.string().uuid() }).strict();
export const ReportScheduleIdParamsSchema = z.object({ scheduleId: z.string().uuid() }).strict();
export const ReportHistoryQuerySchema = z.object({ limit:z.coerce.number().int().min(1).max(100).default(50), cursor:z.string().datetime().optional() }).strict();

export const ReportExportSchema = z.object({
  id:z.string().uuid(), reportType:ExportableReportTypeSchema, filters:ReportExportFiltersSchema, format:z.literal('CSV'), status:ReportExportStatusSchema,
  requestedByUserId:z.string().uuid().nullable(), requestedByName:z.string().nullable().optional(), rowCount:z.number().int().nonnegative().nullable(), fileSizeBytes:z.number().int().nonnegative().nullable(),
  requestedAt:z.string().datetime(), startedAt:z.string().datetime().nullable(), completedAt:z.string().datetime().nullable(), expiresAt:z.string().datetime().nullable(), failureCode:z.string().nullable(), downloadFilename:z.string().nullable(),
}).strict();
export const ReportExportListSchema = z.object({ data:z.array(ReportExportSchema), nextCursor:z.string().datetime().nullable() }).strict();
export const ReportExportDownloadSchema = z.object({ url:z.string().url(), expiresAt:z.string().datetime(), filename:z.string() }).strict();

const RecurrenceFieldsSchema = z.object({
  frequency:ReportFrequencySchema, deliveryTimeLocal:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), weekday:z.number().int().min(0).max(6).nullable().optional(), monthlyDay:z.union([z.enum(['FIRST','LAST']),z.coerce.number().int().min(1).max(28).transform(String)]).nullable().optional(),
}).strict().superRefine((value,ctx)=>{if(value.frequency==='WEEKLY'&&value.weekday==null)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Weekly schedules require a weekday.'});if(value.frequency==='MONTHLY'&&value.monthlyDay==null)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Monthly schedules require a monthly day.'});});
export const CreateReportScheduleSchema = z.object({
  name:z.string().trim().min(1).max(120), reportType:ExportableReportTypeSchema, filters:ReportExportFiltersSchema.default({}), recurrence:RecurrenceFieldsSchema,
  recipientUserIds:z.array(z.string().uuid()).max(25).default([]), additionalRecipientEmails:z.array(z.string().trim().email().max(255)).max(10).default([]),
}).strict().superRefine((value,ctx)=>{if(value.recipientUserIds.length+value.additionalRecipientEmails.length===0)ctx.addIssue({code:z.ZodIssueCode.custom,message:'At least one recipient is required.'});});
export const UpdateReportScheduleSchema = z.object({
  name:z.string().trim().min(1).max(120).optional(), reportType:ExportableReportTypeSchema.optional(), filters:ReportExportFiltersSchema.optional(), recurrence:RecurrenceFieldsSchema.optional(),
  recipientUserIds:z.array(z.string().uuid()).max(25).optional(), additionalRecipientEmails:z.array(z.string().trim().email().max(255)).max(10).optional(),
}).strict().refine(value=>Object.keys(value).length>0,{message:'At least one schedule field is required.'});
export const ReportScheduleSchema = z.object({
  id:z.string().uuid(), name:z.string(), reportType:ExportableReportTypeSchema, filters:ReportExportFiltersSchema, frequency:ReportFrequencySchema, timezone:z.string(), deliveryTimeLocal:z.string(),
  weekday:z.number().int().nullable(), monthlyDay:z.string().nullable(), recipientUserIds:z.array(z.string().uuid()), additionalRecipientsMasked:z.array(z.string()), status:ReportScheduleStatusSchema,
  nextRunAt:z.string().datetime().nullable(), lastRunAt:z.string().datetime().nullable(), createdAt:z.string().datetime(), updatedAt:z.string().datetime(),
}).strict();
export const ReportScheduleListSchema=z.object({data:z.array(ReportScheduleSchema)}).strict();
export const ReportScheduleRunSchema=z.object({id:z.string().uuid(),scheduledFor:z.string().datetime(),status:z.enum(['QUEUED','PROCESSING','SUCCEEDED','FAILED']),reportExportJobId:z.string().uuid().nullable(),failureCode:z.string().nullable(),startedAt:z.string().datetime().nullable(),completedAt:z.string().datetime().nullable()}).strict();

export type ExportableReportType=z.infer<typeof ExportableReportTypeSchema>; export type ReportExportFilters=z.infer<typeof ReportExportFiltersSchema>;
export type CreateReportExport=z.infer<typeof CreateReportExportSchema>; export type ReportExport=z.infer<typeof ReportExportSchema>;
export type CreateReportSchedule=z.infer<typeof CreateReportScheduleSchema>; export type UpdateReportSchedule=z.infer<typeof UpdateReportScheduleSchema>; export type ReportSchedule=z.infer<typeof ReportScheduleSchema>;
