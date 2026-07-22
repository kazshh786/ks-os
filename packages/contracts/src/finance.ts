import { z } from 'zod';

export const StripeBalanceSchema = z.object({
  available: z.array(z.object({ currency: z.string(), amount: z.number().int() })),
  pending: z.array(z.object({ currency: z.string(), amount: z.number().int() })),
  lastSyncedAt: z.string().datetime(),
});

export type StripeBalance = z.infer<typeof StripeBalanceSchema>;

export const PayoutStatusSchema = z.enum([
  'PENDING',
  'IN_TRANSIT',
  'PAID',
  'FAILED',
  'CANCELLED'
]);

export type PayoutStatus = z.infer<typeof PayoutStatusSchema>;

export const ReconciliationStatusSchema = z.enum([
  'MATCHED',
  'MISMATCHED',
  'INCOMPLETE'
]);

export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;

export const ReconciliationSummarySchema = z.object({
  payoutAmount: z.number().int(),
  grossPayments: z.number().int(),
  refunds: z.number().int(),
  disputes: z.number().int(),
  stripeFees: z.number().int(),
  applicationFees: z.number().int(),
  otherAdjustments: z.number().int(),
  calculatedNet: z.number().int(),
  difference: z.number().int(),
  status: ReconciliationStatusSchema,
});

export type ReconciliationSummary = z.infer<typeof ReconciliationSummarySchema>;

export const PayoutListQuerySchema = z.object({
  status: PayoutStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

export type PayoutListQuery = z.infer<typeof PayoutListQuerySchema>;

export const PayoutListItemSchema = z.object({
  id: z.string().uuid(),
  amount: z.number().int(),
  currency: z.string().length(3),
  status: PayoutStatusSchema,
  arrivalDate: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  automatic: z.boolean(),
  reconciliationStatus: ReconciliationStatusSchema,
  transactionCount: z.number().int(),
});

export type PayoutListItem = z.infer<typeof PayoutListItemSchema>;

export const PayoutItemSchema = z.object({
  id: z.string().uuid(),
  sourceType: z.string().nullable(),
  grossAmount: z.number().int(),
  stripeFee: z.number().int(),
  netAmount: z.number().int(),
  currency: z.string().length(3),
  availableOn: z.string().datetime().nullable(),
  checkoutTransactionId: z.string().uuid().nullable(),
  stripeRefundId: z.string().nullable(),
  stripeDisputeId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type PayoutItem = z.infer<typeof PayoutItemSchema>;

export const PayoutDetailResponseSchema = z.object({
  payout: PayoutListItemSchema,
  reconciliation: ReconciliationSummarySchema,
  items: z.array(PayoutItemSchema),
  failureCode: z.string().nullable(),
  failureMessageSafe: z.string().nullable(),
  lastSyncedAt: z.string().datetime(),
});

export type PayoutDetailResponse = z.infer<typeof PayoutDetailResponseSchema>;

export const DisputeStateSchema = z.enum([
  'WARNING_NEEDS_RESPONSE',
  'WARNING_UNDER_REVIEW',
  'WARNING_CLOSED',
  'NEEDS_RESPONSE',
  'UNDER_REVIEW',
  'WON',
  'LOST',
  'CHARGE_REFUNDED'
]);

export type DisputeState = z.infer<typeof DisputeStateSchema>;

export const DisputeListQuerySchema = z.object({
  status: DisputeStateSchema.optional(),
  reason: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

export type DisputeListQuery = z.infer<typeof DisputeListQuerySchema>;

export const DisputeListItemSchema = z.object({
  id: z.string().uuid(),
  bookingReference: z.string().uuid().nullable(),
  appointmentId: z.string().uuid().nullable(),
  checkoutTransactionId: z.string().uuid().nullable(),
  amount: z.number().int(),
  currency: z.string().length(3),
  reason: z.string(),
  status: DisputeStateSchema,
  evidenceDueBy: z.string().datetime().nullable(),
  actionRequired: z.boolean(),
  lastSyncedAt: z.string().datetime(),
});

export type DisputeListItem = z.infer<typeof DisputeListItemSchema>;

export const DisputeDetailResponseSchema = DisputeListItemSchema.extend({
  dashboardUrl: z.string().url().nullable(),
  timeline: z.array(z.object({
    date: z.string().datetime(),
    description: z.string(),
  })),
  payoutImpact: z.number().int().nullable(),
});

export type DisputeDetailResponse = z.infer<typeof DisputeDetailResponseSchema>;
