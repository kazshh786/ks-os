import { z } from 'zod';
import { EntitlementAvailabilitySchema, EntitlementValueSchema, PlanKeySchema } from './agency.js';

export type PlanKey = z.infer<typeof PlanKeySchema>;

export const PlanUsageSchema = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  percentage: z.number().nonnegative(),
  warning: z.boolean(),
  atLimit: z.boolean(),
  overage: z.number().int().nonnegative(),
});
export type PlanUsage = z.infer<typeof PlanUsageSchema>;

export const WorkspacePlanSummarySchema = z.object({
  plan: z.object({
    key: PlanKeySchema,
    name: z.string(),
    supportLevel: z.enum(['STANDARD', 'PRIORITY', 'STRATEGIC']),
  }),
  entitlements: z.record(z.string(), EntitlementValueSchema),
  availability: z.record(z.string(), EntitlementAvailabilitySchema),
  usage: z.object({
    bookings: PlanUsageSchema,
    staff: PlanUsageSchema,
    locations: PlanUsageSchema,
  }),
  bookingLimitPolicy: z.literal('AUDITED_OVERAGE'),
});
export type WorkspacePlanSummary = z.infer<typeof WorkspacePlanSummarySchema>;
