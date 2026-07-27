import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  InvitationReferenceParamsSchema, PasswordResetRequestSchema, RevokeSessionParamsSchema,
  SelectWorkspaceRequestSchema, WorkspaceSessionSchema,
} from '@ks-os/contracts';
import {
  accountAccessAuditEvents, agencySessions, agencyUsers, applicationSessions, getDatabase, users,
} from '@ks-os/database';
import { supabase } from '../../lib/supabase.js';
import { getSupabaseAdmin } from '../../lib/supabase-admin.js';
import { AccountInvitationService } from './account-invitation.service.js';
import { AuthenticationService } from './authentication.service.js';

const neutralResetResponse = { success: true, data: { message: 'If an account is eligible, a password reset email will arrive shortly.' } };
const TenantUserParams = z.object({ tenantId: z.string().uuid(), userReference: z.string().uuid() }).strict();
const AgencyUserParams = z.object({ userReference: z.string().uuid() }).strict();
const AdminPasswordSchema = z.object({
  password: z.string()
    .min(12)
    .max(128)
    .regex(/[a-z]/, 'Password must include a lowercase letter.')
    .regex(/[A-Z]/, 'Password must include an uppercase letter.')
    .regex(/\d/, 'Password must include a number.')
    .regex(/[^A-Za-z0-9]/, 'Password must include a symbol.'),
  confirmPassword: z.string().min(12).max(128),
  reason: z.string().trim().min(20).max(500),
  identityVerified: z.literal(true),
}).strict().superRefine((input, ctx) => {
  if (input.password !== input.confirmPassword) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmPassword'], message: 'Password confirmation does not match.' });
  }
});

export async function authenticationRoutes(app: FastifyInstance) {
  const service = new AuthenticationService();
  const invitations = new AccountInvitationService();

  app.get('/api/v1/auth/context', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async request => ({ success: true, data: await service.context(request) }));
  app.post('/api/v1/auth/select-workspace', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async request => {
    const input = SelectWorkspaceRequestSchema.parse(request.body);
    return { success: true, data: await service.selectWorkspace(request, input.businessReference) };
  });
  app.get('/api/v1/auth/sessions', async request => ({ success: true, data: await service.listSessions(request) }));
  app.post('/api/v1/auth/sessions/:sessionReference/revoke', async request => {
    const { sessionReference } = RevokeSessionParamsSchema.parse(request.params);
    return { success: true, data: await service.revokeSession(request, sessionReference) };
  });
  app.post('/api/v1/auth/logout', async request => ({ success: true, data: await service.logout(request, false) }));
  app.post('/api/v1/auth/logout-all', async request => ({ success: true, data: await service.logout(request, true) }));

  app.get('/api/v1/workspace/session', async request => {
    request.requireContext('TENANT');
    if (request.auth?.supportMode) {
      const support = request.auth;
      return { success: true, data: WorkspaceSessionSchema.parse({
        context: 'TENANT', authenticated: true, selectionRequired: false,
        user: {
          email: support.email,
          displayName: `Agency support · ${support.tenantName}`,
          role: support.role,
          permissions: Object.fromEntries(support.permissions.map(permission => [permission, true])),
        },
        business: {
          businessReference: support.businessReference,
          name: support.tenantName,
          slug: support.tenantSubdomain,
          primaryColor: null,
          secondaryColor: null,
          accentColor: null,
        },
        memberships: [{
          membershipReference: support.membershipReference,
          businessReference: support.businessReference,
          businessName: support.tenantName,
          businessSlug: support.tenantSubdomain,
          role: support.role,
          status: 'ACTIVE',
          selected: true,
        }],
      }) };
    }
    return { success: true, data: WorkspaceSessionSchema.parse(await service.workspaceSession(request)) };
  });
  app.get('/api/v1/workspace/memberships', async request => {
    if (request.auth?.supportMode) {
      return { success: true, data: [{
        membershipReference: request.auth.membershipReference,
        businessReference: request.auth.businessReference,
        businessName: request.auth.tenantName,
        businessSlug: request.auth.tenantSubdomain,
        role: request.auth.role,
        status: 'ACTIVE',
        selected: true,
      }] };
    }
    const session = await service.workspaceSession(request);
    return { success: true, data: session.memberships };
  });
  app.post('/api/v1/workspace/invitations/:invitationReference/accept', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async request => {
    request.requireContext('TENANT');
    const identity = request.requireIdentity();
    if (!identity.email) throw Object.assign(new Error('The signed-in email address is unavailable.'), { statusCode: 403, code: 'INVITATION_EMAIL_MISMATCH' });
    const { invitationReference } = InvitationReferenceParamsSchema.parse(request.params);
    return { success: true, data: await invitations.accept(invitationReference, { authUserId: identity.authUserId, email: identity.email }, 'TENANT') };
  });
  app.get('/api/v1/workspace/invitations/:invitationReference', async request => {
    request.requireContext('TENANT'); const identity = request.requireIdentity();
    if (!identity.email) throw Object.assign(new Error('The signed-in email address is unavailable.'), { statusCode: 403, code: 'INVITATION_EMAIL_MISMATCH' });
    const { invitationReference } = InvitationReferenceParamsSchema.parse(request.params);
    return { success: true, data: await invitations.preview(invitationReference, { authUserId: identity.authUserId, email: identity.email }, 'TENANT') };
  });
  app.post('/api/v1/agency/invitations/:invitationReference/accept', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async request => {
    request.requireContext('AGENCY');
    const identity = request.requireIdentity();
    if (!identity.email) throw Object.assign(new Error('The signed-in email address is unavailable.'), { statusCode: 403, code: 'INVITATION_EMAIL_MISMATCH' });
    const { invitationReference } = InvitationReferenceParamsSchema.parse(request.params);
    return { success: true, data: await invitations.accept(invitationReference, { authUserId: identity.authUserId, email: identity.email }, 'AGENCY') };
  });
  app.get('/api/v1/agency/invitations/:invitationReference', async request => {
    request.requireContext('AGENCY'); const identity = request.requireIdentity();
    if (!identity.email) throw Object.assign(new Error('The signed-in email address is unavailable.'), { statusCode: 403, code: 'INVITATION_EMAIL_MISMATCH' });
    const { invitationReference } = InvitationReferenceParamsSchema.parse(request.params);
    return { success: true, data: await invitations.preview(invitationReference, { authUserId: identity.authUserId, email: identity.email }, 'AGENCY') };
  });

  app.post('/api/v1/agency/tenants/:tenantId/users/:userReference/password-reset', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async request => {
    request.requireAgency('tenants.manage');
    const { tenantId, userReference } = TenantUserParams.parse(request.params);
    const db = getDatabase();
    const [target] = await db.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.publicReference, userReference))).limit(1);
    if (!target) throw Object.assign(new Error('Business user not found.'), { statusCode: 404, code: 'TENANT_USER_NOT_FOUND' });
    if (!target.authUserId) throw Object.assign(new Error('This user has not completed account setup yet. Resend their invitation instead.'), { statusCode: 409, code: 'TENANT_USER_NOT_ACTIVATED' });

    const origin = process.env.TENANT_PASSWORD_RESET_REDIRECT_URL
      || (process.env.PUBLIC_APP_ORIGIN ? `${process.env.PUBLIC_APP_ORIGIN}/auth/callback` : null);
    if (!origin) throw Object.assign(new Error('Tenant password recovery is not configured.'), { statusCode: 503, code: 'PASSWORD_RESET_NOT_CONFIGURED' });
    const redirect = new URL(origin);
    redirect.searchParams.set('context', 'TENANT');
    redirect.searchParams.set('recovery', '1');
    const email = target.emailNormalized.trim().toLowerCase();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirect.toString() });
    if (error) throw Object.assign(new Error('The recovery email could not be sent.'), { statusCode: 502, code: 'PASSWORD_RESET_DELIVERY_FAILED' });

    const now = new Date();
    await db.transaction(async tx => {
      await tx.update(users).set({
        sessionsValidAfter: now,
        securityVersion: sql`${users.securityVersion} + 1`,
        updatedAt: now,
      }).where(eq(users.id, target.id));
      await tx.update(applicationSessions).set({ revokedAt: now, revokeReason: 'AGENCY_PASSWORD_RECOVERY' }).where(and(
        eq(applicationSessions.authUserId, target.authUserId!),
        eq(applicationSessions.applicationContext, 'TENANT'),
        isNull(applicationSessions.revokedAt),
      ));
      await tx.insert(accountAccessAuditEvents).values({
        authUserId: target.authUserId,
        agencyUserId: request.agencyAuth!.agencyUserId,
        tenantId,
        tenantUserId: target.id,
        applicationContext: 'TENANT',
        action: 'AGENCY_PASSWORD_RECOVERY_SENT',
        requestId: request.id,
        metadata: { sessionsRevoked: true },
      });
    });
    return { success: true, data: { sent: true, email } };
  });

  app.post('/api/v1/agency/tenants/:tenantId/users/:userReference/password', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async request => {
    const agency = request.requireAgency('tenants.manage');
    const { tenantId, userReference } = TenantUserParams.parse(request.params);
    const input = AdminPasswordSchema.parse(request.body);
    const db = getDatabase();
    const [target] = await db.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.publicReference, userReference))).limit(1);
    if (!target) throw Object.assign(new Error('Business user not found.'), { statusCode: 404, code: 'TENANT_USER_NOT_FOUND' });
    if (!target.authUserId) throw Object.assign(new Error('This user does not yet have a Supabase login identity.'), { statusCode: 409, code: 'TENANT_USER_NOT_ACTIVATED' });

    const now = new Date();
    await db.transaction(async tx => {
      await tx.update(users).set({
        sessionsValidAfter: now,
        securityVersion: sql`${users.securityVersion} + 1`,
        updatedAt: now,
      }).where(eq(users.id, target.id));
      await tx.update(applicationSessions).set({ revokedAt: now, revokeReason: 'AGENCY_PASSWORD_SET' }).where(and(
        eq(applicationSessions.authUserId, target.authUserId!),
        eq(applicationSessions.applicationContext, 'TENANT'),
        isNull(applicationSessions.revokedAt),
      ));
      await tx.insert(accountAccessAuditEvents).values({
        authUserId: target.authUserId,
        agencyUserId: agency.agencyUserId,
        tenantId,
        tenantUserId: target.id,
        applicationContext: 'TENANT',
        action: 'AGENCY_PASSWORD_SET',
        outcome: 'REQUESTED',
        reason: input.reason,
        requestId: request.id,
        metadata: { targetRole: target.role, sessionsRevoked: true },
      });
    });

    const { error } = await getSupabaseAdmin().auth.admin.updateUserById(target.authUserId, { password: input.password });
    if (error) {
      await db.insert(accountAccessAuditEvents).values({
        authUserId: target.authUserId,
        agencyUserId: agency.agencyUserId,
        tenantId,
        tenantUserId: target.id,
        applicationContext: 'TENANT',
        action: 'AGENCY_PASSWORD_SET',
        outcome: 'FAILED',
        reason: input.reason,
        requestId: request.id,
        metadata: { providerCode: String(error.code || error.name || 'PROVIDER_REJECTED').slice(0, 100), sessionsRevoked: true },
      });
      throw Object.assign(new Error('The user password could not be changed.'), { statusCode: 502, code: 'PASSWORD_ADMINISTRATION_FAILED' });
    }

    await db.insert(accountAccessAuditEvents).values({
      authUserId: target.authUserId,
      agencyUserId: agency.agencyUserId,
      tenantId,
      tenantUserId: target.id,
      applicationContext: 'TENANT',
      action: 'AGENCY_PASSWORD_SET',
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: request.id,
      metadata: { targetRole: target.role, sessionsRevoked: true },
    });
    return { success: true, data: { updated: true, email: target.emailNormalized, sessionsRevoked: true } };
  });

  app.post('/api/v1/agency/users/:userReference/password', { config: { rateLimit: { max: 3, timeWindow: '15 minutes' } } }, async request => {
    const agency = request.requireAgency('agency.users.manage');
    if (agency.role !== 'PLATFORM_OWNER') {
      throw Object.assign(new Error('Only a platform owner can change agency-user passwords.'), { statusCode: 403, code: 'AGENCY_FORBIDDEN' });
    }
    const { userReference } = AgencyUserParams.parse(request.params);
    const input = AdminPasswordSchema.parse(request.body);
    const db = getDatabase();
    const [target] = await db.select().from(agencyUsers).where(eq(agencyUsers.publicReference, userReference)).limit(1);
    if (!target) throw Object.assign(new Error('Agency user not found.'), { statusCode: 404, code: 'AGENCY_USER_NOT_FOUND' });
    if (!target.authUserId) throw Object.assign(new Error('This agency user does not yet have a Supabase login identity.'), { statusCode: 409, code: 'AGENCY_USER_NOT_ACTIVATED' });

    const now = new Date();
    await db.transaction(async tx => {
      await tx.update(agencyUsers).set({
        sessionsValidAfter: now,
        securityVersion: sql`${agencyUsers.securityVersion} + 1`,
        updatedAt: now,
      }).where(eq(agencyUsers.id, target.id));
      await tx.update(agencySessions).set({ revokedAt: now, revokeReason: 'PLATFORM_OWNER_PASSWORD_SET' }).where(and(
        eq(agencySessions.agencyUserId, target.id),
        isNull(agencySessions.revokedAt),
      ));
      await tx.update(applicationSessions).set({ revokedAt: now, revokeReason: 'PLATFORM_OWNER_PASSWORD_SET' }).where(and(
        eq(applicationSessions.authUserId, target.authUserId!),
        eq(applicationSessions.applicationContext, 'AGENCY'),
        isNull(applicationSessions.revokedAt),
      ));
      await tx.insert(accountAccessAuditEvents).values({
        authUserId: target.authUserId,
        agencyUserId: agency.agencyUserId,
        applicationContext: 'AGENCY',
        action: 'PLATFORM_OWNER_PASSWORD_SET',
        outcome: 'REQUESTED',
        reason: input.reason,
        requestId: request.id,
        metadata: { targetAgencyUserId: target.id, targetRole: target.role, sessionsRevoked: true },
      });
    });

    const { error } = await getSupabaseAdmin().auth.admin.updateUserById(target.authUserId, { password: input.password });
    if (error) {
      await db.insert(accountAccessAuditEvents).values({
        authUserId: target.authUserId,
        agencyUserId: agency.agencyUserId,
        applicationContext: 'AGENCY',
        action: 'PLATFORM_OWNER_PASSWORD_SET',
        outcome: 'FAILED',
        reason: input.reason,
        requestId: request.id,
        metadata: { targetAgencyUserId: target.id, providerCode: String(error.code || error.name || 'PROVIDER_REJECTED').slice(0, 100), sessionsRevoked: true },
      });
      throw Object.assign(new Error('The agency-user password could not be changed.'), { statusCode: 502, code: 'PASSWORD_ADMINISTRATION_FAILED' });
    }

    await db.insert(accountAccessAuditEvents).values({
      authUserId: target.authUserId,
      agencyUserId: agency.agencyUserId,
      applicationContext: 'AGENCY',
      action: 'PLATFORM_OWNER_PASSWORD_SET',
      outcome: 'SUCCESS',
      reason: input.reason,
      requestId: request.id,
      metadata: { targetAgencyUserId: target.id, targetRole: target.role, sessionsRevoked: true },
    });
    return { success: true, data: { updated: true, email: target.emailNormalized, sessionsRevoked: true } };
  });

  app.post('/api/v1/auth/password-reset', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async request => {
    const input = PasswordResetRequestSchema.parse(request.body);
    const redirectBase = input.context === 'AGENCY'
      ? process.env.AGENCY_PASSWORD_RESET_REDIRECT_URL
      : input.context === 'CUSTOMER' ? process.env.CUSTOMER_PASSWORD_RESET_REDIRECT_URL : process.env.TENANT_PASSWORD_RESET_REDIRECT_URL;
    const origin = redirectBase || (process.env.PUBLIC_APP_ORIGIN ? `${process.env.PUBLIC_APP_ORIGIN}/auth/callback` : null);
    if (!origin) return neutralResetResponse;
    const redirect = new URL(origin);
    redirect.searchParams.set('context', input.context);
    redirect.searchParams.set('recovery', '1');
    const { error } = await supabase.auth.resetPasswordForEmail(input.email.trim().toLowerCase(), { redirectTo: redirect.toString() });
    if (error) request.log.warn({ code: error.code }, 'Password reset request was not delivered');
    return neutralResetResponse;
  });
}
