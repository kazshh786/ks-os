import { z } from 'zod';

export const RelatedSaleSchema = z.object({
  reference: z.string().uuid(), title: z.string().max(255),
  stage: z.string().max(120), state: z.enum(['OPEN', 'WON', 'LOST']),
  value: z.number().int().nonnegative().nullable(), currency: z.string().regex(/^[A-Z]{3}$/),
}).strict();
export type RelatedSale = z.infer<typeof RelatedSaleSchema>;
export const SalesAppointmentSchema = z.object({
  reference: z.string().uuid(), title: z.string(), status: z.string(),
  startTime: z.string().datetime(), endTime: z.string().datetime(), timezone: z.string(),
  staffName: z.string().nullable(), route: z.string().startsWith('/app/bookings?'),
  canReschedule: z.boolean(),
}).strict();
export type SalesAppointment = z.infer<typeof SalesAppointmentSchema>;
export const SalesBookingContextQuerySchema = z.object({
  clientReference: z.string().uuid().optional(), opportunityReference: z.string().uuid().optional(),
}).strict().refine(v => Boolean(v.clientReference) !== Boolean(v.opportunityReference), 'Choose a customer or sale.');
export const SalesBookingContextSchema = z.object({
  customer: z.object({ reference: z.string().uuid(), name: z.string(), email: z.string().nullable(), phone: z.string().nullable() }).strict(),
  sales: z.array(RelatedSaleSchema).max(100), selectedReference: z.string().uuid().nullable(),
  suggestedStaffId: z.string().uuid().nullable(), hasMore: z.boolean(),
}).strict();
export type SalesBookingContext = z.infer<typeof SalesBookingContextSchema>;

// Suggestions describe canonical state; they never change a stage or schedule.
export function salesAppointmentSuggestion(appointments: SalesAppointment[], open: boolean, hasQuote: boolean, now = new Date()) {
  if (!open || !appointments.length) return null;
  if (appointments.some(a => !['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(a.status) && Date.parse(a.startTime) >= now.getTime())) return null;
  const recent = [...appointments].sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
  if (Date.parse(recent.endTime) < now.getTime() - 30 * 86400000) return null;
  if (recent.status === 'CANCELLED' || recent.status === 'NO_SHOW') return { code: 'SALES_BOOKING_CANCELLED' as const, label: 'Arrange another appointment', reason: `${recent.title} was ${recent.status === 'NO_SHOW' ? 'missed' : 'cancelled'}. Review the sale and arrange another appointment or contact the customer.` };
  if (recent.status === 'COMPLETED' && !hasQuote) return { code: 'SALES_BOOKING_COMPLETED' as const, label: 'Prepare a quote or proposal', reason: `${recent.title} is completed and this sale has no active quote. Review the next commercial step.` };
  return null;
}
