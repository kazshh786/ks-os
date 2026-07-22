import { z } from 'zod';

export const AnalyticsPresetSchema = z.enum(['TODAY','YESTERDAY','LAST_7_DAYS','LAST_30_DAYS','LAST_90_DAYS','LAST_6_MONTHS','LAST_12_MONTHS','THIS_MONTH','LAST_MONTH','CUSTOM']);
export const DashboardOverviewQuerySchema = z.object({
  preset: AnalyticsPresetSchema.default('LAST_7_DAYS'),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.preset === 'CUSTOM' && (!value.from || !value.to)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Custom periods require from and to dates.' });
  if (value.preset !== 'CUSTOM' && (value.from || value.to)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'from and to are only valid for CUSTOM periods.' });
});

export const KpiValueSchema = z.object({ value:z.number(), previousValue:z.number().nullable(), changeValue:z.number().nullable(), changePercentage:z.number().nullable() }).strict();
export const MoneyKpiValueSchema = KpiValueSchema.extend({ currency:z.string().length(3) }).strict();
const PeriodSchema = z.object({ preset:AnalyticsPresetSchema, from:z.string().datetime(), to:z.string().datetime(), previousFrom:z.string().datetime(), previousTo:z.string().datetime(), timezone:z.string(), localFrom:z.string().date(), localTo:z.string().date() }).strict();

export const DashboardOverviewResponseSchema = z.object({
  period: PeriodSchema,
  currency: z.string().length(3),
  bookings: z.object({ total:KpiValueSchema, completed:KpiValueSchema, cancelled:KpiValueSchema, noShow:KpiValueSchema, cancellationRate:KpiValueSchema, noShowRate:KpiValueSchema }).strict(),
  revenue: z.object({ recordedRevenue:MoneyKpiValueSchema, refundedAmount:MoneyKpiValueSchema, netRecordedRevenue:MoneyKpiValueSchema, outstandingAmount:MoneyKpiValueSchema, averageTransactionValue:MoneyKpiValueSchema }).strict(),
  clients: z.object({ uniqueClients:KpiValueSchema, newClients:KpiValueSchema, returningClients:KpiValueSchema }).strict(),
  operations: z.object({ todayAppointments:z.number().int(), awaitingPayment:z.number().int(), incompleteForms:z.number().int(), failedEmails:z.number().int(), failedSms:z.number().int(), openDisputes:z.number().int(), failedPayouts:z.number().int(), stripeActionRequired:z.number().int() }).strict(),
  topServices: z.array(z.object({ serviceId:z.string().uuid(), serviceName:z.string(), bookingCount:z.number().int(), completedCount:z.number().int(), recordedRevenue:z.number().int() }).strict()),
  staffUtilisation: z.array(z.object({ staffId:z.string().uuid(), staffName:z.string(), bookedMinutes:z.number().int(), availableMinutes:z.number().int().nullable(), utilisationPercentage:z.number().nullable(), completedAppointments:z.number().int(), recordedRevenue:z.number().int() }).strict()),
  dailyTrend: z.array(z.object({ date:z.string().date(), bookings:z.number().int(), completedAppointments:z.number().int(), recordedRevenue:z.number().int() }).strict()),
  generatedAt: z.string().datetime(),
}).strict();

export const AdvancedAnalyticsQuerySchema=z.object({
  preset:z.enum(['LAST_30_DAYS','LAST_90_DAYS','LAST_6_MONTHS','LAST_12_MONTHS','CUSTOM']).default('LAST_90_DAYS'),
  from:z.string().date().optional(),to:z.string().date().optional(),grain:z.enum(['AUTO','DAY','WEEK','MONTH']).default('AUTO'),
  retentionWindowDays:z.coerce.number().int().refine(value=>[30,60,90,180].includes(value)).default(90),
}).strict().superRefine((value,ctx)=>{if(value.preset==='CUSTOM'&&(!value.from||!value.to))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Custom periods require from and to dates.'});if(value.preset!=='CUSTOM'&&(value.from||value.to))ctx.addIssue({code:z.ZodIssueCode.custom,message:'from and to are only valid for CUSTOM periods.'});});
const AvailabilitySchema=z.object({status:z.enum(['AVAILABLE','INSUFFICIENT_DATA']),sampleSize:z.number().int().nonnegative(),explanation:z.string()}).strict();
const RateMetricSchema=AvailabilitySchema.extend({eligible:z.number().int().nonnegative(),matched:z.number().int().nonnegative(),percentage:z.number().nullable()}).strict();
const AnalyticsBucketSchema=z.object({bucket:z.string(),createdBookings:z.number().int(),appointments:z.number().int(),completed:z.number().int(),cancelled:z.number().int(),noShow:z.number().int()}).strict();
export const AdvancedAnalyticsResponseSchema=z.object({
  period:z.object({preset:AnalyticsPresetSchema,from:z.string().datetime(),to:z.string().datetime(),previousFrom:z.string().datetime(),previousTo:z.string().datetime(),timezone:z.string(),localFrom:z.string().date(),localTo:z.string().date(),grain:z.enum(['DAY','WEEK','MONTH'])}).strict(),currency:z.string().length(3),minimumSampleSize:z.number().int(),
  bookingTrend:z.array(AnalyticsBucketSchema),revenueTrend:z.array(z.object({bucket:z.string(),grossRecordedRevenue:z.number().int(),refundedAmount:z.number().int(),netRecordedRevenue:z.number().int(),transactionCount:z.number().int(),averageTransactionValue:z.number().int()}).strict()),
  retention:RateMetricSchema.extend({windowDays:z.number().int()}).strict(),rebooking:RateMetricSchema,
  leadTime:AvailabilitySchema.extend({medianHours:z.number().nullable(),averageHours:z.number().nullable(),distribution:z.array(z.object({bucket:z.enum(['SAME_DAY','1_3_DAYS','4_7_DAYS','8_14_DAYS','15_30_DAYS','31_PLUS_DAYS']),count:z.number().int()}).strict())}).strict(),
  serviceDemand:z.array(z.object({serviceId:z.string().uuid(),serviceName:z.string(),bookings:z.number().int(),completed:z.number().int(),cancelled:z.number().int(),noShows:z.number().int(),uniqueClients:z.number().int(),recordedRevenue:z.number().int(),cancellationRate:z.number().nullable(),noShowRate:z.number().nullable(),rateStatus:z.enum(['AVAILABLE','INSUFFICIENT_DATA'])}).strict()),
  staffUtilisationTrend:z.array(z.object({bucket:z.string(),bookedMinutes:z.number().int(),availableMinutes:z.number().int().nullable(),utilisationPercentage:z.number().nullable()}).strict()),
  bookingPatterns:z.array(z.object({dimension:z.enum(['SERVICE','WEEKDAY','TIME_OF_DAY','STAFF','CHANNEL']),key:z.string(),label:z.string(),eligible:z.number().int(),noShows:z.number().int(),noShowRate:z.number().nullable(),status:z.enum(['AVAILABLE','INSUFFICIENT_DATA'])}).strict()),
  revenueMix:z.array(z.object({dimension:z.enum(['PAYMENT_METHOD','SOURCE']),key:z.string(),grossRecordedRevenue:z.number().int(),transactionCount:z.number().int()}).strict()),
  clientFrequency:z.array(z.object({bucket:z.enum(['ONE_VISIT','TWO_VISITS','THREE_TO_FIVE','SIX_PLUS']),clients:z.number().int()}).strict()),
  forwardBookings:z.object({horizonDays:z.number().int(),confirmedAppointmentCount:z.number().int(),confirmedBookingValue:z.number().int(),currentBookingPace:z.number().int(),previousBookingPace:z.number().int(),paceChangePercentage:z.number().nullable(),label:z.literal('Projected from bookings already confirmed')}).strict(),
  limitations:z.array(z.string()),generatedAt:z.string().datetime(),
}).strict();

export type AnalyticsPreset = z.infer<typeof AnalyticsPresetSchema>;
export type DashboardOverviewQuery = z.infer<typeof DashboardOverviewQuerySchema>;
export type KpiValue = z.infer<typeof KpiValueSchema>;
export type DashboardOverviewResponse = z.infer<typeof DashboardOverviewResponseSchema>;
export type AdvancedAnalyticsQuery=z.infer<typeof AdvancedAnalyticsQuerySchema>;
export type AdvancedAnalyticsResponse=z.infer<typeof AdvancedAnalyticsResponseSchema>;
