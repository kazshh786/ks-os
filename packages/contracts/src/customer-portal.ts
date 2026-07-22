import { z } from 'zod';
import { PublicFormSubmissionSchema } from './forms.js';

export const CustomerAppointmentStatusSchema = z.enum(['UPCOMING', 'PAST', 'CANCELLED']);
export const CustomerAppointmentQuerySchema = z.object({
  business: z.string().trim().min(1).max(100).optional(),
  status: CustomerAppointmentStatusSchema.default('UPCOMING'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export const CustomerProfileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(255).optional(),
  phone: z.string().trim().max(20).nullable().optional(),
}).strict().refine((value) => value.displayName !== undefined || value.phone !== undefined, {
  message: 'Provide at least one profile field.',
});

export const CustomerClaimParamsSchema = z.object({
  token: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

export const CustomerAssignmentParamsSchema = z.object({
  assignmentReference: z.string().uuid(),
}).strict();

export const CustomerFormSubmissionSchema = PublicFormSubmissionSchema;

export type CustomerAppointmentsQuery = z.infer<typeof CustomerAppointmentQuerySchema>;
export type UpdateCustomerProfileRequest = z.infer<typeof CustomerProfileUpdateSchema>;
export type CustomerFormSubmissionRequest = z.infer<typeof CustomerFormSubmissionSchema>;
