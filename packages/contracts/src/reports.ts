import { z } from 'zod';
import { AnalyticsPresetSchema } from './analytics.js';
import { DerivedPaymentStateSchema, PaymentSourceSchema, RefundStatusSchema } from './payments.js';

export const ReportPeriodSchema = z.object({
  period: AnalyticsPresetSchema.default('LAST_30_DAYS'),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.period === 'CUSTOM' && (!value.from || !value.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Custom periods require from and to dates.' });
  }
  if (value.period !== 'CUSTOM' && (value.from || value.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'from and to are only valid for CUSTOM periods.' });
  }
});

export const ReportPaginationSchema = z.object({
  limit: z.number().int().min(1).max(100),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
}).strict();

export const ReportSortSchema = z.object({
  field: z.enum(['date','created','amount','net','last_visit','name','spend','appointments','bookings','revenue','completed','booked','utilisation','quantity','stock','last_sale','requested','submitted','title','queued','status']),
  direction: z.enum(['asc', 'desc']),
}).strict();

export const ReportFilterOptionSchema = z.object({ value: z.string(), label: z.string() }).strict();
export const ReportSummarySchema = z.object({ totalRecords: z.number().int().nonnegative(), currency: z.string().length(3) }).strict();
export const ReportErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.enum(['REPORT_ACCESS_DENIED', 'REPORT_INVALID_PERIOD', 'REPORT_INVALID_FILTER', 'REPORT_INVALID_SORT', 'REPORT_RANGE_TOO_LARGE', 'REPORT_QUERY_FAILED', 'REPORT_DATA_UNAVAILABLE']),
    message: z.string(),
  }).strict(),
}).strict();

export const ReportPeriodResponseSchema = z.object({
  period: AnalyticsPresetSchema,
  from: z.string().datetime(),
  to: z.string().datetime(),
  timezone: z.string(),
  localFrom: z.string().date(),
  localTo: z.string().date(),
}).strict();

const periodFields = {
  period: AnalyticsPresetSchema.default('LAST_30_DAYS'),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
};
const pageFields = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
};
const searchField = z.string().trim().min(1).max(120).optional();
const validatePeriod = (value: { period: z.infer<typeof AnalyticsPresetSchema>; from?: string; to?: string }, ctx: z.RefinementCtx) => {
  if (value.period === 'CUSTOM' && (!value.from || !value.to)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Custom periods require from and to dates.' });
  if (value.period !== 'CUSTOM' && (value.from || value.to)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'from and to are only valid for CUSTOM periods.' });
};

export const AppointmentReportStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);
export const AppointmentsReportQuerySchema = z.object({
  ...periodFields, ...pageFields,
  search: searchField,
  status: AppointmentReportStatusSchema.optional(),
  staffId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  bookingChannel: z.enum(['in_shop', 'mobile']).optional(),
  paymentStatus: z.string().trim().min(1).max(30).optional(),
  sort: z.enum(['date_desc', 'date_asc', 'created_desc', 'amount_desc']).default('date_desc'),
}).strict().superRefine(validatePeriod);

const AppointmentReportRowSchema = z.object({
  appointmentId: z.string().uuid(), publicReference: z.string().uuid(), startTime: z.string().datetime(), endTime: z.string().datetime(),
  clientId: z.string().uuid().nullable(), clientDisplayName: z.string().nullable(), serviceId: z.string().uuid().nullable(), serviceName: z.string().nullable(),
  staffId: z.string().uuid(), staffName: z.string(), status: AppointmentReportStatusSchema, bookingChannel: z.enum(['in_shop', 'mobile']),
  quotedAmount: z.number().int(), paymentState: z.string(), createdAt: z.string().datetime(),
}).strict();
export const AppointmentsReportResponseSchema = z.object({
  period: ReportPeriodResponseSchema, currency: z.string().length(3),
  filters: z.object({ search:z.string().nullable(), status:AppointmentReportStatusSchema.nullable(), staffId:z.string().uuid().nullable(), serviceId:z.string().uuid().nullable(), clientId:z.string().uuid().nullable(), bookingChannel:z.enum(['in_shop','mobile']).nullable(), paymentStatus:z.string().nullable(), sort:z.string() }).strict(),
  summary: z.object({ total:z.number().int(), completed:z.number().int(), cancelled:z.number().int(), noShow:z.number().int(), awaitingPayment:z.number().int(), quotedAmountTotal:z.number().int() }).strict(),
  rows: z.array(AppointmentReportRowSchema), pagination: ReportPaginationSchema, generatedAt:z.string().datetime(),
}).strict();

export const ClientsReportQuerySchema = z.object({
  ...periodFields, ...pageFields, search:searchField,
  newOrReturning:z.enum(['NEW','RETURNING']).optional(),
  lastVisitRange:z.enum(['LAST_30_DAYS','LAST_90_DAYS','OVER_90_DAYS','NEVER']).optional(),
  sort:z.enum(['last_visit_desc','name_asc','spend_desc','appointments_desc']).default('last_visit_desc'),
}).strict().superRefine(validatePeriod);
const ClientReportRowSchema = z.object({
  clientId:z.string().uuid(), name:z.string(), firstAppointmentAt:z.string().datetime().nullable(), lastAppointmentAt:z.string().datetime().nullable(),
  completedAppointmentCount:z.number().int(), cancelledCount:z.number().int(), noShowCount:z.number().int(), recordedSpend:z.number().int(),
  futureAppointmentCount:z.number().int(), clientType:z.enum(['NEW','RETURNING']),
}).strict();
export const ClientsReportResponseSchema = z.object({
  period:ReportPeriodResponseSchema,currency:z.string().length(3),
  filters:z.object({search:z.string().nullable(),newOrReturning:z.enum(['NEW','RETURNING']).nullable(),lastVisitRange:z.enum(['LAST_30_DAYS','LAST_90_DAYS','OVER_90_DAYS','NEVER']).nullable(),sort:z.string()}).strict(),
  summary:z.object({totalClients:z.number().int(),newClients:z.number().int(),returningClients:z.number().int(),recordedSpend:z.number().int()}).strict(),
  rows:z.array(ClientReportRowSchema),pagination:ReportPaginationSchema,generatedAt:z.string().datetime(),
}).strict();

export const ServicesReportQuerySchema = z.object({
  ...periodFields,...pageFields,search:searchField,serviceId:z.string().uuid().optional(),
  sort:z.enum(['bookings_desc','revenue_desc','name_asc','completed_desc']).default('bookings_desc'),
}).strict().superRefine(validatePeriod);
const ServiceReportRowSchema = z.object({
  serviceId:z.string().uuid(),serviceName:z.string(),bookings:z.number().int(),completed:z.number().int(),cancelled:z.number().int(),noShows:z.number().int(),
  recordedRevenue:z.number().int(),averageRecordedTransaction:z.number().int(),uniqueClients:z.number().int(),rebookingIndicator:z.number().nullable(),
}).strict();
export const ServicesReportResponseSchema = z.object({
  period:ReportPeriodResponseSchema,currency:z.string().length(3),filters:z.object({search:z.string().nullable(),serviceId:z.string().uuid().nullable(),sort:z.string()}).strict(),
  summary:z.object({totalServices:z.number().int(),bookings:z.number().int(),completed:z.number().int(),recordedRevenue:z.number().int()}).strict(),
  rows:z.array(ServiceReportRowSchema),pagination:ReportPaginationSchema,generatedAt:z.string().datetime(),
}).strict();

export const StaffReportQuerySchema = z.object({
  ...periodFields,...pageFields,search:searchField,staffId:z.string().uuid().optional(),accountStatus:z.enum(['ACTIVE','SUSPENDED','DEACTIVATED']).optional(),
  sort:z.enum(['booked_desc','utilisation_desc','revenue_desc','name_asc']).default('booked_desc'),
}).strict().superRefine(validatePeriod);
const StaffReportRowSchema = z.object({
  staffId:z.string().uuid(),staffName:z.string(),accountStatus:z.string(),scheduledMinutes:z.number().int().nullable(),bookedMinutes:z.number().int(),
  completedAppointments:z.number().int(),cancelledAppointments:z.number().int(),noShows:z.number().int(),recordedRevenue:z.number().int(),uniqueClients:z.number().int(),utilisationPercentage:z.number().nullable(),
}).strict();
export const StaffReportResponseSchema = z.object({
  period:ReportPeriodResponseSchema,currency:z.string().length(3),filters:z.object({search:z.string().nullable(),staffId:z.string().uuid().nullable(),accountStatus:z.string().nullable(),sort:z.string()}).strict(),
  summary:z.object({totalStaff:z.number().int(),scheduledMinutes:z.number().int(),bookedMinutes:z.number().int(),completedAppointments:z.number().int(),recordedRevenue:z.number().int()}).strict(),
  rows:z.array(StaffReportRowSchema),pagination:ReportPaginationSchema,generatedAt:z.string().datetime(),
}).strict();

export const ProductsReportQuerySchema = z.object({
  ...periodFields,...pageFields,search:searchField,
  sort:z.enum(['quantity_desc','sales_desc','name_asc','stock_asc']).default('quantity_desc'),
}).strict().superRefine(validatePeriod);
const ProductReportRowSchema = z.object({productId:z.string().uuid(),name:z.string(),sku:z.string(),quantitySold:z.number().int(),grossRecordedSales:z.number().int().nullable(),transactionCount:z.number().int(),currentStock:z.number().int(),lastSaleAt:z.string().datetime().nullable()}).strict();
export const ProductsReportResponseSchema = z.object({
  period:ReportPeriodResponseSchema,currency:z.string().length(3),filters:z.object({search:z.string().nullable(),sort:z.string()}).strict(),
  summary:z.object({totalProducts:z.number().int(),productsSold:z.number().int(),quantitySold:z.number().int(),grossRecordedSales:z.number().int().nullable()}).strict(),
  rows:z.array(ProductReportRowSchema),pagination:ReportPaginationSchema,generatedAt:z.string().datetime(),
}).strict();

export const StockReportQuerySchema = z.object({
  ...pageFields,search:searchField,status:z.enum(['IN_STOCK','LOW_STOCK','OUT_OF_STOCK']).optional(),sort:z.enum(['quantity_asc','quantity_desc','name_asc','last_sale_desc']).default('quantity_asc'),
}).strict();
const StockReportRowSchema = z.object({productId:z.string().uuid(),name:z.string(),sku:z.string(),currentQuantity:z.number().int(),lowStock:z.boolean(),outOfStock:z.boolean(),lastSaleAt:z.string().datetime().nullable()}).strict();
export const StockReportResponseSchema = z.object({
  currency:z.string().length(3),asOf:z.string().datetime(),filters:z.object({search:z.string().nullable(),status:z.enum(['IN_STOCK','LOW_STOCK','OUT_OF_STOCK']).nullable(),sort:z.string()}).strict(),
  summary:z.object({totalProducts:z.number().int(),inStock:z.number().int(),lowStock:z.number().int(),outOfStock:z.number().int()}).strict(),
  rows:z.array(StockReportRowSchema),pagination:ReportPaginationSchema,generatedAt:z.string().datetime(),
}).strict();

export const PaymentsReportQuerySchema = z.object({
  ...periodFields,...pageFields,search:searchField,source:PaymentSourceSchema.optional(),method:z.enum(['CARD','CASH','SPLIT']).optional(),status:DerivedPaymentStateSchema.optional(),
  sort:z.enum(['date_desc','date_asc','amount_desc','net_desc']).default('date_desc'),
}).strict().superRefine(validatePeriod);
const PaymentReportRowSchema = z.object({
  transactionId:z.string().uuid(),date:z.string().datetime(),appointmentId:z.string().uuid().nullable(),bookingReference:z.string().uuid().nullable(),clientDisplayName:z.string().nullable(),serviceName:z.string().nullable(),
  source:PaymentSourceSchema,method:z.enum(['CARD','CASH','SPLIT']),grossAmount:z.number().int(),refundedAmount:z.number().int(),netAmount:z.number().int(),status:DerivedPaymentStateSchema,
}).strict();
export const PaymentsReportResponseSchema = z.object({
  period:ReportPeriodResponseSchema,currency:z.string().length(3),filters:z.object({search:z.string().nullable(),source:PaymentSourceSchema.nullable(),method:z.enum(['CARD','CASH','SPLIT']).nullable(),status:DerivedPaymentStateSchema.nullable(),sort:z.string()}).strict(),
  summary:z.object({totalTransactions:z.number().int(),succeeded:z.number().int(),failed:z.number().int(),grossAmount:z.number().int(),refundedAmount:z.number().int(),netAmount:z.number().int()}).strict(),
  rows:z.array(PaymentReportRowSchema),pagination:ReportPaginationSchema,generatedAt:z.string().datetime(),
}).strict();

export const RefundsReportQuerySchema = z.object({
  ...periodFields,...pageFields,search:searchField,status:RefundStatusSchema.optional(),source:z.enum(['KS_OS','STRIPE_DASHBOARD']).optional(),
  sort:z.enum(['requested_desc','completed_desc','amount_desc']).default('requested_desc'),
}).strict().superRefine(validatePeriod);
const RefundReportRowSchema = z.object({refundId:z.string().uuid(),transactionId:z.string().uuid(),bookingReference:z.string().uuid().nullable(),dateRequested:z.string().datetime(),dateCompleted:z.string().datetime().nullable(),amount:z.number().int(),currency:z.string().length(3),status:RefundStatusSchema,reason:z.string(),source:z.string(),requestedBy:z.string().nullable()}).strict();
export const RefundsReportResponseSchema = z.object({
  period:ReportPeriodResponseSchema,currency:z.string().length(3),filters:z.object({search:z.string().nullable(),status:RefundStatusSchema.nullable(),source:z.string().nullable(),sort:z.string()}).strict(),
  summary:z.object({totalRefunds:z.number().int(),requestedAmount:z.number().int(),completedAmount:z.number().int(),failed:z.number().int()}).strict(),
  rows:z.array(RefundReportRowSchema),pagination:ReportPaginationSchema,generatedAt:z.string().datetime(),
}).strict();

export const FormReportStatusSchema = z.enum(['PENDING','OPENED','SUBMITTED','EXPIRED','CANCELLED']);
export const FormsReportQuerySchema = z.object({
  ...periodFields,...pageFields,search:searchField,status:FormReportStatusSchema.optional(),templateId:z.string().uuid().optional(),versionId:z.string().uuid().optional(),staffId:z.string().uuid().optional(),serviceId:z.string().uuid().optional(),
  sort:z.enum(['assigned_desc','appointment_desc','submitted_desc','title_asc']).default('assigned_desc'),
}).strict().superRefine(validatePeriod);
const FormReportRowSchema = z.object({assignmentId:z.string().uuid(),formId:z.string().uuid(),formTitle:z.string(),formVersion:z.number().int(),clientDisplayName:z.string(),appointmentId:z.string().uuid().nullable(),appointmentReference:z.string().uuid().nullable(),assignedAt:z.string().datetime(),openedAt:z.string().datetime().nullable(),submittedAt:z.string().datetime().nullable(),status:FormReportStatusSchema,assignedBy:z.string()}).strict();
export const FormsReportResponseSchema = z.object({
  period:ReportPeriodResponseSchema,currency:z.string().length(3),filters:z.object({search:z.string().nullable(),status:FormReportStatusSchema.nullable(),templateId:z.string().uuid().nullable(),versionId:z.string().uuid().nullable(),staffId:z.string().uuid().nullable(),serviceId:z.string().uuid().nullable(),sort:z.string()}).strict(),
  summary:z.object({assigned:z.number().int(),opened:z.number().int(),submitted:z.number().int(),expired:z.number().int(),cancelled:z.number().int(),completionRate:z.number()}).strict(),
  rows:z.array(FormReportRowSchema),pagination:ReportPaginationSchema,generatedAt:z.string().datetime(),
}).strict();

export const CommunicationChannelSchema = z.enum(['EMAIL','SMS']);
export const CommunicationReportStatusSchema = z.enum(['PENDING','PROCESSING','ACCEPTED','QUEUED','SENT','DELIVERED','FAILED','UNDELIVERED','BOUNCED','COMPLAINED','SUPPRESSED','EXPIRED','CANCELLED']);
export const CommunicationsReportQuerySchema = z.object({
  ...periodFields,...pageFields,channel:CommunicationChannelSchema.optional(),template:z.string().trim().min(1).max(80).optional(),status:CommunicationReportStatusSchema.optional(),
  sort:z.enum(['queued_desc','queued_asc','status_asc']).default('queued_desc'),
}).strict().superRefine(validatePeriod);
const CommunicationReportRowSchema = z.object({communicationId:z.string().uuid(),channel:CommunicationChannelSchema,category:z.string(),maskedRecipient:z.string(),relatedType:z.string().nullable(),relatedId:z.string().uuid().nullable(),queuedAt:z.string().datetime(),sentAt:z.string().datetime().nullable(),deliveredAt:z.string().datetime().nullable(),status:CommunicationReportStatusSchema,segmentCount:z.number().int().nullable(),failureCategory:z.string().nullable()}).strict();
export const CommunicationsReportResponseSchema = z.object({
  period:ReportPeriodResponseSchema,currency:z.string().length(3),filters:z.object({channel:CommunicationChannelSchema.nullable(),template:z.string().nullable(),status:CommunicationReportStatusSchema.nullable(),sort:z.string()}).strict(),
  summary:z.object({total:z.number().int(),email:z.number().int(),sms:z.number().int(),delivered:z.number().int(),failed:z.number().int(),segments:z.number().int()}).strict(),
  rows:z.array(CommunicationReportRowSchema),pagination:ReportPaginationSchema,generatedAt:z.string().datetime(),
}).strict();

export type AppointmentsReportQuery=z.infer<typeof AppointmentsReportQuerySchema>; export type AppointmentsReportResponse=z.infer<typeof AppointmentsReportResponseSchema>;
export type ClientsReportQuery=z.infer<typeof ClientsReportQuerySchema>; export type ClientsReportResponse=z.infer<typeof ClientsReportResponseSchema>;
export type ServicesReportQuery=z.infer<typeof ServicesReportQuerySchema>; export type ServicesReportResponse=z.infer<typeof ServicesReportResponseSchema>;
export type StaffReportQuery=z.infer<typeof StaffReportQuerySchema>; export type StaffReportResponse=z.infer<typeof StaffReportResponseSchema>;
export type ProductsReportQuery=z.infer<typeof ProductsReportQuerySchema>; export type ProductsReportResponse=z.infer<typeof ProductsReportResponseSchema>;
export type StockReportQuery=z.infer<typeof StockReportQuerySchema>; export type StockReportResponse=z.infer<typeof StockReportResponseSchema>;
export type PaymentsReportQuery=z.infer<typeof PaymentsReportQuerySchema>; export type PaymentsReportResponse=z.infer<typeof PaymentsReportResponseSchema>;
export type RefundsReportQuery=z.infer<typeof RefundsReportQuerySchema>; export type RefundsReportResponse=z.infer<typeof RefundsReportResponseSchema>;
export type FormsReportQuery=z.infer<typeof FormsReportQuerySchema>; export type FormsReportResponse=z.infer<typeof FormsReportResponseSchema>;
export type CommunicationsReportQuery=z.infer<typeof CommunicationsReportQuerySchema>; export type CommunicationsReportResponse=z.infer<typeof CommunicationsReportResponseSchema>;
