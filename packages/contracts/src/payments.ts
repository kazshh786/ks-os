import { z } from 'zod';

export const PaymentSourceSchema = z.enum([
  'STRIPE_ONLINE',
  'MANUAL_CASH',
  'EXTERNAL_TERMINAL',
  'MANUAL_SPLIT',
]);

export type PaymentSource = z.infer<typeof PaymentSourceSchema>;

export const DerivedPaymentStateSchema = z.enum([
  'PENDING',
  'SUCCEEDED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'FAILED'
]);

export type DerivedPaymentState = z.infer<typeof DerivedPaymentStateSchema>;

export const RefundStatusSchema = z.enum([
  'CREATING',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED'
]);

export type RefundStatus = z.infer<typeof RefundStatusSchema>;

export const PaymentHistoryQuerySchema = z.object({
  status: DerivedPaymentStateSchema.optional(),
  source: PaymentSourceSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type PaymentHistoryQuery = z.infer<typeof PaymentHistoryQuerySchema>;

export const PaymentHistoryItemSchema = z.object({
  transactionId: z.string().uuid(),
  appointmentId: z.string().uuid().nullable(),
  bookingReference: z.string().uuid().nullable(),
  clientDisplayName: z.string().nullable(),
  serviceName: z.string().nullable(),
  amount: z.number().int(),
  currency: z.string().length(3),
  paymentSource: PaymentSourceSchema,
  paymentMethod: z.string(),
  paymentStatus: DerivedPaymentStateSchema,
  refundedAmount: z.number().int(),
  refundableAmount: z.number().int(),
  createdAt: z.string().datetime(),
});

export type PaymentHistoryItem = z.infer<typeof PaymentHistoryItemSchema>;

export const RefundHistoryItemSchema = z.object({
  id: z.string().uuid(),
  amount: z.number().int(),
  currency: z.string().length(3),
  reason: z.string(),
  status: RefundStatusSchema,
  refundSource: z.string(),
  requestedByUserName: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type RefundHistoryItem = z.infer<typeof RefundHistoryItemSchema>;

export const PaymentDetailResponseSchema = z.object({
  transactionId: z.string().uuid(),
  appointmentId: z.string().uuid().nullable(),
  bookingReference: z.string().uuid().nullable(),
  clientDisplayName: z.string().nullable(),
  serviceName: z.string().nullable(),
  amount: z.number().int(),
  currency: z.string().length(3),
  paymentSource: PaymentSourceSchema,
  paymentMethod: z.string(),
  paymentStatus: DerivedPaymentStateSchema,
  refundedAmount: z.number().int(),
  refundableAmount: z.number().int(),
  providerVerificationState: z.enum(['VERIFIED', 'UNVERIFIED', 'NOT_APPLICABLE']),
  stripeStatus: z.string().nullable(),
  refundHistory: z.array(RefundHistoryItemSchema),
  createdAt: z.string().datetime(),
});

export type PaymentDetailResponse = z.infer<typeof PaymentDetailResponseSchema>;

export const CreateRefundRequestSchema = z.object({
  amount: z.number().int().positive().optional(),
  reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']),
  internalNote: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().uuid(),
});

export type CreateRefundRequest = z.infer<typeof CreateRefundRequestSchema>;

export const CreateRefundResponseSchema = z.object({
  id: z.string().uuid(),
  status: RefundStatusSchema,
  refundedAmount: z.number().int(),
  refundableAmount: z.number().int(),
});

export type CreateRefundResponse = z.infer<typeof CreateRefundResponseSchema>;
