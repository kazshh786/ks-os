import { z } from 'zod';

/**
 * Payment method recorded for a completed transaction.
 */
export const PaymentMethodSchema = z.enum([
  'CASH',
  'CARD', // Legacy compatibility mapped to EXTERNAL_CARD
  'BANK_TRANSFER',
  'EXTERNAL_CARD',
  'OTHER',
  'STRIPE_ONLINE',
  'STRIPE_TERMINAL',
  'SPLIT',
]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const VerificationSourceSchema = z.enum(['PROVIDER_CONFIRMED', 'STAFF_CONFIRMED']);
export type VerificationSource = z.infer<typeof VerificationSourceSchema>;

export const PaymentComponentMethodSchema = z.enum([
  'CASH',
  'BANK_TRANSFER',
  'EXTERNAL_CARD',
  'OTHER',
  'STRIPE_TERMINAL',
]);

export const PaymentComponentInputSchema = z.object({
  method: PaymentComponentMethodSchema,
  amountInCents: z.number().int().positive(),
  externalProvider: z.string().max(80).optional(),
  externalProviderName: z.string().max(120).optional(),
  externalReference: z.string().max(255).optional(),
  methodDescription: z.string().max(255).optional(),
});
export type PaymentComponentInput = z.infer<typeof PaymentComponentInputSchema>;

export const PaymentComponentSchema = PaymentComponentInputSchema.extend({
  id: z.string().uuid(),
  verificationSource: VerificationSourceSchema,
});
export type PaymentComponent = z.infer<typeof PaymentComponentSchema>;

export const PosStripePaymentModeSchema = z.enum([
  'AUTOMATED_TERMINAL',
  'TAP_TO_PAY_MANUAL',
  'TERMINAL_MANUAL',
]);
export type PosStripePaymentMode = z.infer<typeof PosStripePaymentModeSchema>;

/**
 * Stripe is the only integrated card provider for the POS launch.
 *
 * AUTOMATED_TERMINAL is verified against Stripe before checkout is finalised.
 * The manual modes are explicit staff confirmations for payments taken directly
 * in Stripe's own mobile app or on a standalone Stripe Terminal device.
 */
export const PosStripePaymentConfirmationSchema = z.object({
  mode: PosStripePaymentModeSchema,
  paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/).optional(),
  manuallyConfirmed: z.boolean().optional().default(false),
  manualReference: z.string().trim().max(255).optional(),
});
export type PosStripePaymentConfirmation = z.infer<typeof PosStripePaymentConfirmationSchema>;

// Product schemas have been moved to products.ts

export const CheckoutAppointmentSchema = z.object({
  appointmentId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().nullable().optional(),
  serviceName: z.string().optional(),
});
export type CheckoutAppointment = z.infer<typeof CheckoutAppointmentSchema>;

export const CheckoutCandidateSchema = z.object({
  appointmentId: z.string().uuid(),
  clientName: z.string().nullable(),
  serviceName: z.string().nullable(),
  staffName: z.string().nullable(),
  startTime: z.string(),
  endTime: z.string(),
  status: z.string(),
  paymentStatus: z.string(),
  quotedAmount: z.number().int().nonnegative(),
  checkoutState: z.enum(['ready', 'already_checked_out']),
});
export type CheckoutCandidate = z.infer<typeof CheckoutCandidateSchema>;

export const CheckoutCandidateListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(CheckoutCandidateSchema),
});
export type CheckoutCandidateListResponse = z.infer<typeof CheckoutCandidateListResponseSchema>;

export const CheckoutBasketItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
});
export type CheckoutBasketItem = z.infer<typeof CheckoutBasketItemSchema>;

export const SplitPaymentAmountsSchema = z.object({
  cashInCents: z.number().int().nonnegative(),
  cardInCents: z.number().int().nonnegative(),
});
export type SplitPaymentAmounts = z.infer<typeof SplitPaymentAmountsSchema>;

export const CheckoutCalculationSchema = z.object({
  serviceAmountInCents: z.number().int().nonnegative(),
  retailAmountInCents: z.number().int().nonnegative(),
  tipAmountInCents: z.number().int().nonnegative(),
  grandTotalInCents: z.number().int().nonnegative(),
});
export type CheckoutCalculation = z.infer<typeof CheckoutCalculationSchema>;

export const CheckoutPreviewRequestSchema = z.object({
  appointmentId: z.string().uuid(),
  paymentMethod: PaymentMethodSchema,
  paymentComponents: z.array(PaymentComponentInputSchema).optional(),
  splitAmounts: SplitPaymentAmountsSchema.optional(), // Legacy compat
  tipAmountInCents: z.number().int().nonnegative().default(0),
  purchasedProducts: z.array(CheckoutBasketItemSchema).default([]),
});
export type CheckoutPreviewRequest = z.infer<typeof CheckoutPreviewRequestSchema>;

export const CheckoutPreviewResponseSchema = z.object({
  success: z.literal(true),
  data: CheckoutCalculationSchema,
});
export type CheckoutPreviewResponse = z.infer<typeof CheckoutPreviewResponseSchema>;

export const CheckoutRequestSchema = z.object({
  idempotencyKey: z.string().min(1).max(255),
  appointmentId: z.string().uuid(),
  paymentMethod: PaymentMethodSchema,
  paymentComponents: z.array(PaymentComponentInputSchema).optional(),
  splitAmounts: SplitPaymentAmountsSchema.optional(), // Legacy compat
  tipAmountInCents: z.number().int().nonnegative().default(0),
  purchasedProducts: z.array(CheckoutBasketItemSchema).default([]),
  stripePayment: PosStripePaymentConfirmationSchema.optional(),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

export const PosStripeReaderSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.string(),
  deviceType: z.string(),
  locationId: z.string().nullable(),
  serialNumber: z.string().nullable(),
  online: z.boolean(),
  supportsServerDriven: z.boolean(),
});
export type PosStripeReader = z.infer<typeof PosStripeReaderSchema>;

export const PosConfigSchema = z.object({
  plan: z.object({
    key: z.enum(['CORE', 'GROWTH', 'SCALE']),
    name: z.string(),
    monthlyPriceMinor: z.number().int().nonnegative(),
    currency: z.string(),
  }).nullable(),
  inventoryEnabled: z.boolean(),
  inventoryFromPriceMinor: z.number().int().nonnegative(),
  stripe: z.object({
    connected: z.boolean(),
    ready: z.boolean(),
    accountIdMasked: z.string().nullable(),
  }),
});
export type PosConfig = z.infer<typeof PosConfigSchema>;

/**
 * Starts an automated server-driven Stripe Terminal payment. The amount is not
 * accepted from the browser; the API recalculates it from the appointment,
 * products and tip before creating the PaymentIntent.
 */
export const StartPosStripePaymentRequestSchema = z.object({
  appointmentId: z.string().uuid(),
  readerId: z.string().min(1).max(255),
  idempotencyKey: z.string().min(1).max(255),
  tipAmountInCents: z.number().int().nonnegative().default(0),
  purchasedProducts: z.array(CheckoutBasketItemSchema).default([]),
});
export type StartPosStripePaymentRequest = z.infer<typeof StartPosStripePaymentRequestSchema>;

export const StartPosStripePaymentResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    paymentIntentId: z.string(),
    readerId: z.string(),
    amountInCents: z.number().int().positive(),
    currency: z.string(),
    status: z.string(),
  }),
});
export type StartPosStripePaymentResponse = z.infer<typeof StartPosStripePaymentResponseSchema>;

export const PosStripePaymentStatusSchema = z.object({
  paymentIntentId: z.string(),
  amountInCents: z.number().int().nonnegative(),
  amountReceivedInCents: z.number().int().nonnegative(),
  currency: z.string(),
  status: z.string(),
  succeeded: z.boolean(),
  failed: z.boolean(),
  failureMessage: z.string().nullable(),
});
export type PosStripePaymentStatus = z.infer<typeof PosStripePaymentStatusSchema>;

export const TransactionSummarySchema = z.object({
  transactionId: z.string().uuid(),
  appointment: CheckoutAppointmentSchema,
  calculation: CheckoutCalculationSchema,
  paymentMethod: PaymentMethodSchema,
  paymentComponents: z.array(PaymentComponentSchema).optional(),
  splitAmounts: SplitPaymentAmountsSchema.optional(), // Legacy compat
  paymentStatus: z.string(),
  date: z.string(),
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number().int(),
    priceInCents: z.number().int(),
    totalInCents: z.number().int(),
  })),
});
export type TransactionSummary = z.infer<typeof TransactionSummarySchema>;

export const CheckoutResponseSchema = z.object({
  success: z.literal(true),
  data: TransactionSummarySchema,
  message: z.string().optional(),
});
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;

export const PosErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }),
});
export type PosErrorResponse = z.infer<typeof PosErrorResponseSchema>;
