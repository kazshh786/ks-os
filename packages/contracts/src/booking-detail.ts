import { z } from 'zod';
import { BookingOperationsItemSchema, BookingSourceSchema } from './booking-operations.js';

export const BookingFormAnswerSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string(),
  displayValue: z.string(),
  sensitiveClassification: z.string().nullable(),
});
export type BookingFormAnswer = z.infer<typeof BookingFormAnswerSchema>;

export const BookingFormResponseSchema = z.object({
  assignmentId: z.string().uuid(),
  formTitle: z.string(),
  status: z.string(),
  submittedAt: z.string().datetime().nullable(),
  completionPercentage: z.number().int().min(0).max(100).nullable(),
  answers: z.array(BookingFormAnswerSchema),
});
export type BookingFormResponse = z.infer<typeof BookingFormResponseSchema>;

export const BookingCustomerBreakdownSchema = z.object({
  repeatCustomer: z.boolean(),
  previousCompletedVisits: z.number().int().nonnegative(),
  completedVisits: z.number().int().nonnegative(),
  totalBookings: z.number().int().nonnegative(),
  upcomingBookings: z.number().int().nonnegative(),
  cancellations: z.number().int().nonnegative(),
  noShows: z.number().int().nonnegative(),
  firstVisitAt: z.string().datetime().nullable(),
  lastVisitAt: z.string().datetime().nullable(),
  memberSince: z.string().datetime().nullable(),
  loyaltyPoints: z.number().int().nonnegative(),
  patchTestDate: z.string().datetime().nullable(),
  medicalNotes: z.string().nullable(),
});
export type BookingCustomerBreakdown = z.infer<typeof BookingCustomerBreakdownSchema>;

export const BookingAcquisitionSchema = z.object({
  source: BookingSourceSchema,
  medium: z.string().nullable(),
  campaign: z.string().nullable(),
  referrerHost: z.string().nullable(),
  bookedAt: z.string().datetime(),
  bookingPageId: z.string().uuid().nullable(),
});
export type BookingAcquisition = z.infer<typeof BookingAcquisitionSchema>;

export const BookingDetailSchema = BookingOperationsItemSchema.extend({
  acquisition: BookingAcquisitionSchema,
  customerBreakdown: BookingCustomerBreakdownSchema,
  formResponses: z.array(BookingFormResponseSchema),
  mobileAddress: z.record(z.unknown()).nullable(),
});
export type BookingDetail = z.infer<typeof BookingDetailSchema>;
