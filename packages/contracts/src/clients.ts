import { z } from 'zod';
import { ERROR_CODES } from './errors.js';

// ============================================================================
// CLIENT DIRECTORY
// ============================================================================

export const ClientDirectoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().trim().max(255).optional()
});
export type ClientDirectoryQuery = z.infer<typeof ClientDirectoryQuerySchema>;

export const ClientDirectoryItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  lastVisitDate: z.string().datetime().nullable(),
  upcomingBookingCount: z.number().int().nonnegative(),
  totalBookingCount: z.number().int().nonnegative()
});
export type ClientDirectoryItem = z.infer<typeof ClientDirectoryItemSchema>;

export const PaginatedClientListSchema = z.object({
  data: z.array(ClientDirectoryItemSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    totalPages: z.number().int().nonnegative()
  })
});
export type PaginatedClientList = z.infer<typeof PaginatedClientListSchema>;

// ============================================================================
// CLIENT PROFILE
// ============================================================================

export const ClientProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  patchTestDate: z.string().datetime().nullable(),
  lastVisitDate: z.string().datetime().nullable(),
  loyaltyPoints: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type ClientProfile = z.infer<typeof ClientProfileSchema>;

export const ClientBookingHistoryItemSchema = z.object({
  id: z.string().uuid(),
  serviceName: z.string().nullable(),
  staffName: z.string().nullable(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  status: z.enum(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'BLOCKED']),
  price: z.number().int().nonnegative()
});
export type ClientBookingHistoryItem = z.infer<typeof ClientBookingHistoryItemSchema>;

export const ClientDetailResponseSchema = z.object({
  profile: ClientProfileSchema,
  bookingHistory: z.array(ClientBookingHistoryItemSchema),
  medicalNotes: z.string().nullable().optional() // Only present if authorized
});
export type ClientDetailResponse = z.infer<typeof ClientDetailResponseSchema>;

// ============================================================================
// ERRORS
// ============================================================================

export const ClientNotFoundResponseSchema = z.object({
  error: z.object({
    code: z.literal(ERROR_CODES.CLIENT_NOT_FOUND).or(z.literal('CLIENT_NOT_FOUND')),
    message: z.string()
  })
});
export type ClientNotFoundResponse = z.infer<typeof ClientNotFoundResponseSchema>;
