import type { FastifyInstance } from 'fastify';
import {
  InvitationReferenceParamsSchema, PasswordResetRequestSchema, RevokeSessionParamsSchema,
  SelectWorkspaceRequestSchema, WorkspaceSessionSchema,
} from '@ks-os/contracts';
import { supabase } from '../../lib/supabase.js';
import { AccountInvitationService } from './account-invitation.service.js';
import { AuthenticationService } from './authentication.service.js';

const neutralResetResponse = { success: true, data: { message: 'If an account is eligible, a password reset email will arrive shortly.' } };

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

  app.get('/api/v1/workspace/session', async request => ({ success: true, data: WorkspaceSessionSchema.parse(await service.workspaceSession(request)) }));
  app.get('/api/v1/workspace/memberships', async request => {
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
