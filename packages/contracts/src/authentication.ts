import { z } from 'zod';
import { BusinessProfileSchema, BusinessTypeSchema, ProductOnboardingConfigurationSchema } from './business-profile.js';

export const ApplicationContextSchema = z.enum(['AGENCY', 'TENANT', 'CUSTOMER']);
export type ApplicationContext = z.infer<typeof ApplicationContextSchema>;

export const AccountStatusSchema = z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const AccountInvitationTypeSchema = z.enum(['AGENCY', 'TENANT_OWNER', 'TENANT_STAFF']);
export const AccountInvitationStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED']);
export type AccountInvitationType = z.infer<typeof AccountInvitationTypeSchema>;
export type AccountInvitationStatus = z.infer<typeof AccountInvitationStatusSchema>;

export const AuthContextRequestSchema = z.object({
  requestedContext: ApplicationContextSchema,
}).strict();

export const SelectWorkspaceRequestSchema = z.object({
  businessReference: z.string().uuid(),
}).strict();

export const InvitationReferenceParamsSchema = z.object({
  invitationReference: z.string().uuid(),
}).strict();

export const WorkspaceMembershipSchema = z.object({
  membershipReference: z.string().uuid(),
  businessReference: z.string().uuid(),
  businessName: z.string(),
  businessSlug: z.string(),
  role: z.enum(['owner', 'staff']),
  status: AccountStatusSchema,
  selected: z.boolean(),
});

export const WorkspaceSessionSchema = z.object({
  context: z.literal('TENANT'),
  authenticated: z.literal(true),
  selectionRequired: z.boolean(),
  user: z.object({
    email: z.string().email(),
    displayName: z.string(),
    role: z.enum(['owner', 'staff']).nullable(),
    permissions: z.record(z.boolean()),
  }),
  business: z.object({
    businessReference: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    primaryColor: z.string(),
    secondaryColor: z.string(),
    accentColor: z.string(),
    businessType: BusinessTypeSchema.nullable().optional(),
    profile: BusinessProfileSchema.optional(),
    productOnboarding: ProductOnboardingConfigurationSchema.nullable().optional(),
    onboardingRequired: z.boolean().optional(),
  }).nullable(),
  memberships: z.array(WorkspaceMembershipSchema),
});

export const AuthContextResponseSchema = z.object({
  authenticated: z.literal(true),
  requestedContext: ApplicationContextSchema,
  availableContexts: z.array(ApplicationContextSchema),
  next: z.enum(['READY', 'SELECT_WORKSPACE', 'MFA_ENROL', 'MFA_CHALLENGE', 'NO_ACCESS']),
});

export const ApplicationSessionSchema = z.object({
  sessionReference: z.string().uuid(),
  context: ApplicationContextSchema,
  current: z.boolean(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  device: z.string().nullable(),
});

export const RevokeSessionParamsSchema = z.object({ sessionReference: z.string().uuid() }).strict();

export const PasswordResetRequestSchema = z.object({
  email: z.string().trim().email().max(255),
  context: ApplicationContextSchema,
}).strict();

export const AcceptInvitationRequestSchema = z.object({
  invitationReference: z.string().uuid(),
}).strict();

export const AgencyInvitationRequestSchema = z.object({
  email: z.string().trim().email().max(255),
  displayName: z.string().trim().min(1).max(255),
  role: z.enum(['AGENCY_ADMINISTRATOR', 'SUPPORT_ADMINISTRATOR', 'FULFILMENT_ADMINISTRATOR']),
}).strict();

export const TenantOwnerInvitationRequestSchema = z.object({
  email: z.string().trim().email().max(255),
  displayName: z.string().trim().min(1).max(255),
}).strict();

export const AuthErrorCodeSchema = z.enum([
  'AUTH_REQUIRED', 'AUTH_INVALID_CREDENTIALS', 'AUTH_EMAIL_NOT_VERIFIED', 'AUTH_SESSION_EXPIRED',
  'AUTH_SESSION_REVOKED', 'AUTH_CONTEXT_REQUIRED', 'AUTH_CONTEXT_NOT_ALLOWED', 'AUTH_NO_ACTIVE_WORKSPACE',
  'AUTH_WORKSPACE_NOT_FOUND', 'AUTH_WORKSPACE_ACCESS_DENIED', 'INVITATION_NOT_FOUND', 'INVITATION_EXPIRED',
  'INVITATION_ALREADY_ACCEPTED', 'INVITATION_CANCELLED', 'INVITATION_EMAIL_MISMATCH',
  'INVITATION_ACCEPTANCE_FAILED', 'AGENCY_ACCESS_DENIED', 'AGENCY_ACCOUNT_SUSPENDED',
  'AGENCY_MFA_REQUIRED', 'AGENCY_MFA_ENROLMENT_REQUIRED', 'AGENCY_MFA_CHALLENGE_FAILED',
  'TENANT_MEMBERSHIP_SUSPENDED', 'TENANT_MEMBERSHIP_DEACTIVATED', 'TENANT_ACCOUNT_SUSPENDED',
  'SUPPORT_SESSION_REQUIRED', 'SUPPORT_SESSION_EXPIRED', 'SUPPORT_SESSION_REVOKED',
]);

