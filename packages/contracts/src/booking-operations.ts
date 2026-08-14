import { z } from 'zod';
import { DepositTypeSchema } from './booking-payment-policy.js';

export const OperationalBookingStatusSchema = z.enum([
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_SERVICE',
  'AWAITING_PAYMENT',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'BLOCKED',
]);
export type OperationalBookingStatus = z.infer<typeof OperationalBookingStatusSchema>;

export const BookingSourceSchema = z.enum([
  'PUBLIC_BOOKING_PAGE',
  'EMBEDDED_WIDGET',
  'STAFF_CREATED',
  'ADMIN_CREATED',
  'CUSTOMER_PORTAL',
  'GOOGLE_BUSINESS_PROFILE',
  'INSTAGRAM',
  'FACEBOOK',
  'TIKTOK',
  'WHATSAPP',
  'REFERRAL',
  'API',
  'ZAPIER',
  'MAKE',
  'IMPORTED',
  'OTHER',
]);
export type BookingSource = z.infer<typeof BookingSourceSchema>;

export const BookingPageSlugSchema = z.string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lower-case letters, numbers and single hyphens.');

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const BookingPageThemeSchema = z.object({
  primaryColor: hexColour.default('#0f172a'),
  secondaryColor: hexColour.default('#475569'),
  accentColor: hexColour.default('#4f46e5'),
  surfaceColor: hexColour.default('#ffffff'),
  textColor: hexColour.default('#0f172a'),
  fontFamily: z.enum(['system', 'sans', 'serif']).default('system'),
  borderRadius: z.enum(['compact', 'medium', 'rounded']).default('rounded'),
  mode: z.enum(['light', 'dark', 'system']).default('light'),
}).strict();
export type BookingPageTheme = z.infer<typeof BookingPageThemeSchema>;

export const BookingChannelSchema = z.enum(['in_shop', 'mobile']);
export type BookingChannel = z.infer<typeof BookingChannelSchema>;

const bookingRulesSchema = z.object({
  minimumNoticeMinutes: z.number().int().min(0).max(525_600).default(60),
  maximumFutureDays: z.number().int().min(1).max(730).default(90),
  slotIntervalMinutes: z.number().int().min(5).max(120).default(30),
  allowAnyStaff: z.boolean().default(true),
  allowGuestBooking: z.boolean().default(true),
  customerNotesEnabled: z.boolean().default(true),
  enabledBookingChannels: z.array(BookingChannelSchema).min(1).max(2).default(['in_shop']),
}).strict();

const paymentSettingsSchema = z.object({
  mode: z.enum(['NONE', 'DEPOSIT', 'FULL', 'PAY_LATER', 'CUSTOMER_CHOICE']).default('PAY_LATER'),
  depositType: DepositTypeSchema.optional(),
  depositPercentage: z.number().min(0).max(100).default(0),
  depositFixedAmount: z.number().int().min(1).max(100_000_000).optional(),
  promotionCodesEnabled: z.boolean().default(false),
  giftCardsEnabled: z.boolean().default(false),
}).strict();

const intakeSettingsSchema = z.object({
  requiredBeforeConfirmation: z.boolean().default(false),
  allowCompleteAfterBooking: z.boolean().default(true),
  showEstimatedTime: z.boolean().default(true),
}).strict();

const cancellationSettingsSchema = z.object({
  customerCancellationEnabled: z.boolean().default(true),
  customerReschedulingEnabled: z.boolean().default(true),
  minimumNoticeMinutes: z.number().int().min(0).max(525_600).default(1_440),
  policyText: z.string().trim().max(4_000).default(''),
}).strict();

const seoSettingsSchema = z.object({
  title: z.string().trim().max(70).default(''),
  description: z.string().trim().max(180).default(''),
  socialTitle: z.string().trim().max(90).default(''),
  socialDescription: z.string().trim().max(220).default(''),
  socialImageUrl: z.string().url().max(1_000).nullable().default(null),
  allowIndexing: z.boolean().default(true),
  canonicalUrl: z.string().url().max(1_000).nullable().default(null),
}).strict();

export const BookingPageUpdateSchema = z.object({
  publicSlug: BookingPageSlugSchema.optional(),
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(4_000).optional(),
  enabled: z.boolean().optional(),
  logoUrl: z.string().url().max(1_000).nullable().optional(),
  coverImageUrl: z.string().url().max(1_000).nullable().optional(),
  layout: z.enum(['STANDARD', 'COMPACT', 'EDITORIAL']).optional(),
  theme: BookingPageThemeSchema.optional(),
  defaultLanguage: z.string().trim().min(2).max(12).optional(),
  supportedLanguages: z.array(z.string().trim().min(2).max(12)).min(1).max(20).optional(),
  defaultLocationId: z.string().uuid().nullable().optional(),
  allowedLocationIds: z.array(z.string().uuid()).max(100).optional(),
  allowedServiceIds: z.array(z.string().uuid()).max(250).optional(),
  allowedStaffIds: z.array(z.string().uuid()).max(250).optional(),
  bookingRules: bookingRulesSchema.optional(),
  paymentSettings: paymentSettingsSchema.optional(),
  intakeFormSettings: intakeSettingsSchema.optional(),
  cancellationSettings: cancellationSettingsSchema.optional(),
  seoSettings: seoSettingsSchema.optional(),
  analyticsSettings: z.object({ enabled: z.boolean().default(true) }).strict().optional(),
}).strict();
export type BookingPageUpdate = z.infer<typeof BookingPageUpdateSchema>;

export const BookingCustomDomainSchema = z.object({
  domain: z.string().trim().toLowerCase().max(255).regex(/^(?=.{4,255}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/).nullable(),
}).strict();

export const BookingPageResponseSchema = z.object({
  id: z.string().uuid(),
  publicSlug: BookingPageSlugSchema,
  publicUrl: z.string().url(),
  previewUrl: z.string().url(),
  title: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  published: z.boolean(),
  logoUrl: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  layout: z.enum(['STANDARD', 'COMPACT', 'EDITORIAL']),
  theme: BookingPageThemeSchema,
  defaultLanguage: z.string(),
  supportedLanguages: z.array(z.string()),
  defaultLocationId: z.string().uuid().nullable(),
  allowedLocationIds: z.array(z.string().uuid()),
  allowedServiceIds: z.array(z.string().uuid()),
  allowedStaffIds: z.array(z.string().uuid()),
  bookingRules: bookingRulesSchema,
  paymentSettings: paymentSettingsSchema,
  intakeFormSettings: intakeSettingsSchema,
  cancellationSettings: cancellationSettingsSchema,
  seoSettings: seoSettingsSchema,
  analyticsSettings: z.object({ enabled: z.boolean() }),
  customDomain: z.string().nullable(),
  customDomainStatus: z.enum(['NOT_CONFIGURED', 'PENDING', 'VERIFIED', 'FAILED']),
  publishedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type BookingPageResponse = z.infer<typeof BookingPageResponseSchema>;

const csvArray = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(
  value => typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  z.array(schema).max(100),
).optional();

export const BookingOperationsQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(100),
  search: z.string().trim().max(120).optional(),
  staffIds: csvArray(z.string().uuid()),
  serviceIds: csvArray(z.string().uuid()),
  locationIds: csvArray(z.string().uuid()),
  statuses: csvArray(OperationalBookingStatusSchema),
  paymentStatuses: csvArray(z.string().trim().min(1).max(30)),
  intakeStatuses: csvArray(z.enum(['NOT_REQUIRED', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE'])),
  sources: csvArray(BookingSourceSchema),
  requiresAttention: z.preprocess(value => value === 'true' ? true : value === 'false' ? false : value, z.boolean()).optional(),
  sort: z.enum(['START_ASC', 'START_DESC', 'CREATED_DESC']).default('START_ASC'),
}).strict().superRefine((value, context) => {
  const from = new Date(value.from).getTime();
  const to = new Date(value.to).getTime();
  if (to <= from) context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'End must be after start.' });
  if (to - from > 93 * 24 * 60 * 60 * 1_000) context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Date range cannot exceed 93 days.' });
});
export type BookingOperationsQuery = z.infer<typeof BookingOperationsQuerySchema>;

export const BookingOperationsItemSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  timezone: z.string(),
  status: OperationalBookingStatusSchema,
  customer: z.object({ id: z.string().uuid().nullable(), name: z.string(), email: z.string().nullable(), phone: z.string().nullable() }),
  service: z.object({ id: z.string().uuid().nullable(), name: z.string(), durationMinutes: z.number().int().nonnegative() }),
  staff: z.object({ id: z.string().uuid(), name: z.string() }),
  location: z.object({ id: z.string().uuid().nullable(), name: z.string().nullable() }),
  bookingChannel: BookingChannelSchema,
  paymentStatus: z.string(),
  quotedAmount: z.number().int().nonnegative(),
  intakeStatus: z.enum(['NOT_REQUIRED', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE']),
  source: BookingSourceSchema,
  notes: z.string().nullable(),
  customerNotes: z.string().nullable(),
  attentionReasons: z.array(z.string()),
  createdAt: z.string().datetime(),
});
export type BookingOperationsItem = z.infer<typeof BookingOperationsItemSchema>;

export const BookingOperationsResponseSchema = z.object({
  items: z.array(BookingOperationsItemSchema),
  meta: z.object({ page: z.number().int(), limit: z.number().int(), total: z.number().int().nonnegative(), hasMore: z.boolean() }),
  summary: z.object({
    total: z.number().int().nonnegative(),
    confirmed: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    noShow: z.number().int().nonnegative(),
    awaitingPayment: z.number().int().nonnegative(),
    incompleteForms: z.number().int().nonnegative(),
    requiresAttention: z.number().int().nonnegative(),
  }),
});
export type BookingOperationsResponse = z.infer<typeof BookingOperationsResponseSchema>;

export const CreateBookingHoldSchema = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().uuid(),
  locationId: z.string().uuid().nullable().optional(),
  resourceId: z.string().uuid().nullable().optional(),
  startTime: z.string().datetime(),
  bookingChannel: BookingChannelSchema.default('in_shop'),
  idempotencyKey: z.string().uuid(),
}).strict();
export type CreateBookingHold = z.infer<typeof CreateBookingHoldSchema>;

export const BookingHoldResponseSchema = z.object({
  id: z.string().uuid(),
  token: z.string().min(32),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  expiresAt: z.string().datetime(),
  remainingSeconds: z.number().int().positive(),
});
export type BookingHoldResponse = z.infer<typeof BookingHoldResponseSchema>;

export const PublicBookingAnalyticsEventSchema = z.object({
  event: z.enum(['PAGE_VIEW', 'BOOKING_STARTED', 'SERVICE_SELECTED', 'STAFF_SELECTED', 'DATE_SELECTED', 'TIME_SELECTED', 'CHECKOUT_STARTED', 'BOOKING_COMPLETED', 'BOOKING_ABANDONED']),
  sessionId: z.string().uuid(),
  serviceId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  occurredAt: z.string().datetime().optional(),
  source: BookingSourceSchema.optional(),
  medium: z.string().trim().max(80).regex(/^[a-zA-Z0-9._-]+$/).optional(),
  campaign: z.string().trim().max(120).regex(/^[a-zA-Z0-9._ -]+$/).optional(),
}).strict();
