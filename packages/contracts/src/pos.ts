import { z } from 'zod';

/**
 * Payment method for the transaction.
 * - CASH: manually confirmed cash payment
 * - CARD: externally confirmed card-terminal payment (not verified or processed by KS OS)
 * - SPLIT: manually confirmed split payment
 */
export const PaymentMethodSchema = z.enum(['CASH', 'CARD', 'SPLIT']);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

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
  splitAmounts: SplitPaymentAmountsSchema.optional(),
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
  idempotencyKey: z.string().min(1),
  appointmentId: z.string().uuid(),
  paymentMethod: PaymentMethodSchema,
  splitAmounts: SplitPaymentAmountsSchema.optional(),
  tipAmountInCents: z.number().int().nonnegative().default(0),
  purchasedProducts: z.array(CheckoutBasketItemSchema).default([]),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

export const TransactionSummarySchema = z.object({
  transactionId: z.string().uuid(),
  appointment: CheckoutAppointmentSchema,
  calculation: CheckoutCalculationSchema,
  paymentMethod: PaymentMethodSchema,
  splitAmounts: SplitPaymentAmountsSchema.optional(),
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
