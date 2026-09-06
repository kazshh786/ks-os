import { z } from 'zod';
import { WorkspacePlanSummarySchema } from './workspace-plan.js';

// 1. Tenant Roles Zod definition and type
export const TenantRoleSchema = z.enum([
  'agency_admin',
  'owner',
  'manager',
  'staff',
  'receptionist'
]);

export type TenantRole = z.infer<typeof TenantRoleSchema>;

// 2. Health Response Zod definition and type
export const HealthResponseSchema = z.object({
  status: z.enum(['OK', 'ERROR']),
  uptime: z.number(),
  timestamp: z.string(),
  version: z.string()
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// 3. API Error response definition
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional()
  })
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

// 4. API Success wrapper
export function createApiSuccessSchema<T extends z.ZodTypeAny>(dataSchema: T): z.ZodType<{
  success: true;
  data: z.infer<T>;
}> {
  return z.object({
    success: z.literal(true),
    data: dataSchema
  }) as any;
}

// 5. Session Response Zod definition and type
export const UserSessionSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: TenantRoleSchema,
  permissions: z.record(z.any())
});

export const TenantSessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  subdomain: z.string(),
  customDomain: z.string().nullable(),
  primaryColor: z.string(),
  secondaryColor: z.string(),
  accentColor: z.string()
});

export const SessionResponseSchema = z.object({
  authenticated: z.boolean(),
  user: UserSessionSchema.nullable(),
  tenant: TenantSessionSchema.nullable(),
  devMode: z.boolean()
});

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

// Workspace response definition
export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  subdomain: z.string(),
  customDomain: z.string().nullable(),
  packageTier: z.enum(['core', 'growth', 'scale']),
  plan: z.lazy(() => WorkspacePlanSummarySchema).optional(),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

export * from './booking.js';
export * from './booking-payment-policy.js';
export * from './errors.js';
export * from './clients.js';
export * from './pos.js';
export * from './retail-pos.js';
export * from './products.js';
export * from './payments.js';
export * from './finance.js';
export * from './communications.js';
export * from './conversations.js';
export * from './automations.js';
export * from './analytics.js';
export * from './reports.js';
export * from './forms.js';
export * from './team.js';
export * from './operations.js';
export * from './tasks.js';
export * from './team-operations.js';
export * from './reporting.js';
export * from './customer-portal.js';
export * from './customer-booking-management.js';
export * from './reputation.js';
export * from './agency.js';
export * from './authentication.js';
export * from './compliance.js';
export * from './integrations.js';
export * from './booking-operations.js';
export * from './booking-detail.js';
export * from './workspace-plan.js';
export * from './sites.js';
export * from './site-design.js';
export * from './template-intelligence.js';
export * from './template-import.js';
export * from './site-blueprints.js';

export * from './business-profile.js';
export * from './sales.js';
export * from './diagnostics.js';
export * from './work.js';
