import { z } from 'zod';
import {
  CheckoutBasketItemSchema,
  CheckoutCalculationSchema,
  PaymentComponentInputSchema,
  PaymentComponentSchema,
  PaymentMethodSchema,
  PosStripePaymentConfirmationSchema,
} from './pos.js';

export const RetailSalePreviewRequestSchema = z.object({
  paymentMethod: PaymentMethodSchema,
  paymentComponents: z.array(PaymentComponentInputSchema).optional(),
  tipAmountInCents: z.number().int().nonnegative().default(0),
  purchasedProducts: z.array(CheckoutBasketItemSchema).min(1).max(100),
});
export type RetailSalePreviewRequest = z.infer<typeof RetailSalePreviewRequestSchema>;

export const RetailSalePreviewResponseSchema = z.object({
  success: z.literal(true),
  data: CheckoutCalculationSchema,
});
export type RetailSalePreviewResponse = z.infer<typeof RetailSalePreviewResponseSchema>;

export const RetailSaleCheckoutRequestSchema = RetailSalePreviewRequestSchema.extend({
  idempotencyKey: z.string().min(1).max(255),
  stripePayment: PosStripePaymentConfirmationSchema.optional(),
});
export type RetailSaleCheckoutRequest = z.infer<typeof RetailSaleCheckoutRequestSchema>;

export const StartRetailStripePaymentRequestSchema = z.object({
  readerId: z.string().min(1).max(255),
  idempotencyKey: z.string().min(1).max(255),
  tipAmountInCents: z.number().int().nonnegative().default(0),
  purchasedProducts: z.array(CheckoutBasketItemSchema).min(1).max(100),
});
export type StartRetailStripePaymentRequest = z.infer<typeof StartRetailStripePaymentRequestSchema>;

export const RetailSaleItemSchema = z.object({
  name: z.string(),
  quantity: z.number().int().positive(),
  priceInCents: z.number().int().nonnegative(),
  totalInCents: z.number().int().nonnegative(),
});

export const RetailSaleSummarySchema = z.object({
  transactionId: z.string().uuid(),
  customerLabel: z.string(),
  calculation: CheckoutCalculationSchema,
  paymentMethod: PaymentMethodSchema,
  paymentComponents: z.array(PaymentComponentSchema).optional(),
  paymentStatus: z.string(),
  date: z.string(),
  items: z.array(RetailSaleItemSchema),
});
export type RetailSaleSummary = z.infer<typeof RetailSaleSummarySchema>;

export const RetailSaleCheckoutResponseSchema = z.object({
  success: z.literal(true),
  data: RetailSaleSummarySchema,
  message: z.string().optional(),
});
export type RetailSaleCheckoutResponse = z.infer<typeof RetailSaleCheckoutResponseSchema>;
