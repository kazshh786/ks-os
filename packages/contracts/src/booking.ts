import { z } from 'zod';

// ============================================================================
// PUBLIC TENANT CATALOGUE
// ============================================================================

export const PublicServiceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  duration: z.number().int().positive(),
  price: z.number().int().nonnegative(),
  discount: z.number().int().nonnegative().optional().nullable(),
  requiresDeposit: z.boolean(),
});
export type PublicService = z.infer<typeof PublicServiceSchema>;

export const PublicStaffOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type PublicStaffOption = z.infer<typeof PublicStaffOptionSchema>;

export const PublicBookingChannelSchema = z.object({
  id: z.enum(['in_shop', 'mobile']),
  label: z.string(),
});
export type PublicBookingChannel = z.infer<typeof PublicBookingChannelSchema>;

export const PublicTenantCatalogSchema = z.object({
  tenant: z.object({
    id: z.string().uuid(),
    name: z.string(),
    timezone: z.string(),
    currency: z.string(),
    colors: z.object({
      primary: z.string(),
      secondary: z.string(),
      accent: z.string(),
    }),
  }),
  paymentMode: z.enum(['pay_now', 'pay_later', 'deposit_required']),
  bookingChannels: z.array(PublicBookingChannelSchema),
  services: z.array(PublicServiceSchema),
  staff: z.array(PublicStaffOptionSchema),
});
export type PublicTenantCatalog = z.infer<typeof PublicTenantCatalogSchema>;

// ============================================================================
// AVAILABILITY
// ============================================================================

export const AvailabilityQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  serviceId: z.string().uuid(),
  staffId: z.string().optional(),
  locationId: z.string().uuid().optional(),
  resourceId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  bookingChannel: z.enum(['in_shop', 'mobile'])
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;

export const AvailabilitySlotSchema = z.object({
  start: z.string().datetime(), // ISO string
  end: z.string().datetime(),
  staffId: z.string(),
  staffName: z.string(),
  price: z.number().int().nonnegative(),
  duration: z.number().int().positive()
});
export type AvailabilitySlot = z.infer<typeof AvailabilitySlotSchema>;

export const AvailabilityResultSchema = z.object({
  date: z.string(),
  timezone: z.string(),
  currency: z.string(),
  bookingChannel: z.enum(['in_shop', 'mobile']),
  slots: z.array(AvailabilitySlotSchema)
});
export type AvailabilityResult = z.infer<typeof AvailabilityResultSchema>;

// ============================================================================
// BOOKING CREATION & UPDATES
// ============================================================================

const safeString = (min: number, max: number) =>
  z.string()
    .transform(val => val.normalize('NFC').trim())
    .refine(val => val.length >= min, { message: `Must be at least ${min} characters` })
    .refine(val => val.length <= max, { message: `Must be at most ${max} characters` })
    .refine(val => !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(val), { message: 'Control characters are not allowed.' })
    .refine(val => !/<script|javascript:|onerror=|onload=|<iframe|<embed|eval\(/i.test(val), { message: 'Executable or script payloads are not allowed.' });

export const CustomerBookingDetailsSchema = z.object({
  name: safeString(2, 255),
  email: z.string()
    .transform(val => val.normalize('NFC').trim().toLowerCase())
    .refine(val => val.length >= 5 && val.length <= 255, { message: 'Email must be between 5 and 255 characters' })
    .refine(val => !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(val), { message: 'Control characters are not allowed.' })
    .refine(val => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), { message: 'Invalid email address' }),
  phone: z.string()
    .transform(val => val.normalize('NFC').trim())
    .refine(val => val.length >= 7 && val.length <= 30, { message: 'Phone must be between 7 and 30 characters' })
    .refine(val => !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(val), { message: 'Control characters are not allowed.' })
    .refine(val => !/<script|javascript:|onerror=|onload=|<iframe|<embed|eval\(/i.test(val), { message: 'Executable or script payloads are not allowed.' })
    .refine(val => /^[+\d\s().-]{7,30}$/.test(val), { message: 'Invalid phone number' }),
}).strict();
export type CustomerBookingDetails = z.infer<typeof CustomerBookingDetailsSchema>;

export const MobileAddressSchema = z.preprocess(
  (raw: any) => {
    if (typeof raw !== 'object' || raw === null) return raw;
    return {
      ...raw,
      line1: raw.line1 ?? raw.addressLine1,
      line2: raw.line2 ?? raw.addressLine2,
      county: raw.county ?? raw.region,
      countryCode: raw.countryCode ?? raw.country ?? 'GB',
      accessNotes: raw.accessNotes ?? raw.accessInstructions,
    };
  },
  z.object({
    line1: safeString(1, 255),
    line2: safeString(0, 255).optional().nullable(),
    city: safeString(1, 100),
    county: safeString(0, 100).optional().nullable(),
    postcode: safeString(1, 20).refine(val => /^[A-Za-z0-9\s-]{1,20}$/.test(val), { message: 'Invalid postcode' }),
    countryCode: z.string()
      .transform(v => v.trim().toUpperCase())
      .refine(v => /^[A-Z]{2}$/.test(v), { message: 'Invalid 2-letter ISO country code' })
      .default('GB'),
    accessNotes: safeString(0, 1000).optional().nullable(),
  }).strict().refine(val => {
    const allowed = ['line1','line2','city','county','postcode','countryCode','accessNotes'];
    return Object.keys(val).every(k => allowed.includes(k));
  }, { message: 'Unexpected fields in address' })
);
export type MobileAddress = z.infer<typeof MobileAddressSchema>;

export const CreateBookingRequestSchema = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().uuid(),
  startTime: z.string().datetime().refine(val => {
    const time = new Date(val).getTime();
    return !isNaN(time) && time >= Date.now() - 5 * 60 * 1000;
  }, { message: 'Selected slot start time cannot be in the past' }),
  client: CustomerBookingDetailsSchema,
  bookingChannel: z.enum(['in_shop', 'mobile']),
  mobileAddress: MobileAddressSchema.optional().nullable(),
  paymentMode: z.enum(['pay_later', 'pay_now', 'deposit_required']),
  payNow: z.boolean().default(false),
  idempotencyKey: z.string().uuid(),
  resourceId: z.string().uuid().optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  holdId: z.string().uuid().optional().nullable(),
  holdToken: z.string().min(32).max(200).optional().nullable(),
  source: z.enum(['PUBLIC_BOOKING_PAGE', 'EMBEDDED_WIDGET', 'CUSTOMER_PORTAL', 'GOOGLE_BUSINESS_PROFILE', 'INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'WHATSAPP', 'REFERRAL', 'OTHER']).default('PUBLIC_BOOKING_PAGE'),
  sourceMedium: z.string().transform(v => v.normalize('NFC').trim()).pipe(z.string().max(80).regex(/^[a-zA-Z0-9._-]+$/)).optional(),
  sourceCampaign: z.string().transform(v => v.normalize('NFC').trim()).pipe(z.string().max(120).regex(/^[a-zA-Z0-9._ -]+$/)).optional(),
  intakeSubmissionIds: z.array(z.string().uuid()).max(20).default([]),
  analyticsSessionId: z.string().uuid().optional().nullable(),
  customerNotes: safeString(0, 2000).optional().nullable(),
}).strict().superRefine((value, context) => {
  if (value.bookingChannel === 'mobile' && !value.mobileAddress) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['mobileAddress'], message: 'An appointment address is required for mobile bookings.' });
  }
});
export type CreateBookingRequest = z.infer<typeof CreateBookingRequestSchema>;

export const BookingConfirmationSchema = z.object({
  reference: z.string(),
  status: z.enum(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'AWAITING_PAYMENT', 'COMPLETED', 'NO_SHOW', 'CANCELLED']),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  bookingChannel: z.enum(['in_shop', 'mobile']),
  serviceName: z.string().optional(),
  staffName: z.string().optional(),
});
export type BookingConfirmation = z.infer<typeof BookingConfirmationSchema>;

export const CreateBookingResponseSchema = z.object({
  booking: BookingConfirmationSchema,
  payment: z.object({
    required: z.boolean(),
    amount: z.number(),
    currency: z.string(),
    status: z.enum(['NOT_REQUIRED', 'OPEN', 'COMPLETED', 'FAILED']).optional(),
    checkoutUrl: z.string().optional()
  }),
});
export type CreateBookingResponse = z.infer<typeof CreateBookingResponseSchema>;

export const BookingStatusResponseSchema = z.object({
  booking: BookingConfirmationSchema,
  payment: z.object({
    amount: z.number(),
    currency: z.string(),
  }),
});
export type BookingStatusResponse = z.infer<typeof BookingStatusResponseSchema>;

// ============================================================================
// STAFF MUTATIONS
// ============================================================================

export const StaffCreateBookingRequestSchema = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().uuid(),
  startTime: z.string().datetime(),
  client: CustomerBookingDetailsSchema,
  bookingChannel: z.enum(['in_shop', 'mobile']),
  mobileAddress: MobileAddressSchema.optional().nullable(),
  paymentMode: z.enum(['pay_later', 'pay_now', 'deposit_required']),
  payNow: z.boolean().default(false),
  resourceId: z.string().uuid().optional().nullable(),
  internalNote: z.string().trim().max(2000).optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  intakeFormIds: z.array(z.string().uuid()).max(20).default([]),
  notifyCustomer: z.boolean().default(true),
  confirmPastBooking: z.boolean().default(false),
  walkIn: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.bookingChannel === 'mobile' && !value.mobileAddress) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['mobileAddress'], message: 'An appointment address is required for mobile bookings.' });
  }
});
export type StaffCreateBookingRequest = z.infer<typeof StaffCreateBookingRequestSchema>;

export const CreateBlockedTimeRequestSchema = z.object({
  staffId: z.string().uuid(),
  startTime: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(1_440),
  reason: z.string().trim().min(1).max(500),
}).strict();
export type CreateBlockedTimeRequest = z.infer<typeof CreateBlockedTimeRequestSchema>;

export const RescheduleBookingRequestSchema = z.object({
  startTime: z.string().datetime(),
  staffId: z.string().uuid().optional(),
  resourceId: z.string().uuid().optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  notifyCustomer: z.boolean().default(true),
  reason: z.string().trim().max(500).optional(),
}).strict();
export type RescheduleBookingRequest = z.infer<typeof RescheduleBookingRequestSchema>;

export const UpdateBookingStatusRequestSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'AWAITING_PAYMENT', 'COMPLETED', 'NO_SHOW', 'CANCELLED']),
}).strict();
export type UpdateBookingStatusRequest = z.infer<typeof UpdateBookingStatusRequestSchema>;

export const CancelBookingRequestSchema = z.object({}).strict();
export type CancelBookingRequest = z.infer<typeof CancelBookingRequestSchema>;
