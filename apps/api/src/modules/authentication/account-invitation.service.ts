import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  accountAccessAuditEvents, accountInvitations, agencySessions, agencyUsers, applicationSessions,
  getDatabase, tenants, users,
} from '@ks-os/database';
import type { AgencyRole } from '@ks-os/contracts';
import { getSupabaseAdmin, provisionSupabaseInvitation } from '../../lib/supabase-admin.js';
import { AccountInvitationEmailService } from './account-invitation-email.service.js';

const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const normalizeEmail = (email: string) => email.trim().toLocaleLowerCase('en-US');
const invitationExpiry = () => new Date(Date.now() + 7 * 86_400_000);

function callbackUrl(context: 'AGENCY' | 'TENANT', invitationReference: string) {
  const configured = context === 'AGENCY' ? process.env.AGENCY_INVITE_REDIRECT_URL : process.env.TENANT_INVITE_REDIRECT_URL || process.env.TEAM_INVITE_REDIRECT_URL;
  const origin = configured || (process.env.PUBLIC_APP_ORIGIN ? `${process.env.PUBLIC_APP_ORIGIN}/auth/callback` : null);
  if (!origin) throw fail(503, 'INVITATION_DELIVERY_FAILED', 'Invitation redirects are not configured.');
  const url = new URL(origin);
  url.searchParams.set('context', context);
  url.searchParams.set('invitation', invitationReference);
  return url.toString();
}

function acceptanceUrl(context: 'AGENCY' | 'TENANT', invitationReference: string) {
  const origin = process.env.PUBLIC_APP_ORIGIN;
  if (!origin) return callbackUrl(context, invitationReference);
  const path = context === 'AGENCY' ? '/agency/accept-invite' : '/accept-invite';
  const url = new URL(path, origin);
  url.searchParams.set('invitation', invitationReference);
  return url.toString();
}

async function audit(input: {
  authUserId?: string | null; agencyUserId?: string | null; tenantId?: string | null;
  tenantUserId?: string | null; context: 'AGENCY' | 'TENANT'; action: string;
  outcome?: string; reason?: string; metadata?: Record<string, unknown>;
}) {
  await getDatabase().insert(accountAccessAuditEvents).values({
    authUserId: input.authUserId, agencyUserId: input.agencyUserId, tenantId: input.tenantId,
    tenantUserId: input.tenantUserId, applicationContext: input.context, action: input.action,
    outcome: input.outcome || 'SUCCESS', reason: input.reason, metadata: input.metadata || {},
  });
}

export class AccountInvitationService {
  private db = getDatabase();
  private email = new AccountInvitationEmailService();

  private async deliver(input: {
    invitationId: string; invitationReference: string; email: string; displayName: string;
    context: 'AGENCY' | 'TENANT'; accessLabel: string;
  }) {
    const redirectTo = callbackUrl(input.context, input.invitationReference);
    const provisioning = await provisionSupabaseInvitation(input.email, redirectTo);
    if (provisioning.delivery === 'EXISTING_ACCOUNT') {
      await this.email.sendExistingAccountNotice({
        recipientEmail: input.email, recipientName: input.displayName, accessLabel: input.accessLabel,
        invitationUrl: acceptanceUrl(input.context, input.invitationReference),
        idempotencyKey: `account-invitation:${input.invitationId}`,
      });
    }
    const now = new Date();
    await this.db.update(accountInvitations).set({
      supabaseAuthUserId: provisioning.authUserId, lastSentAt: now,
      provisioningMode: provisioning.delivery, sendCount: 1, updatedAt: now,
    }).where(eq(accountInvitations.id, input.invitationId));
    return provisioning;
  }

  async createAgencyInvitation(invitedByAgencyUserId: string, input: { email: string; displayName: string; role: AgencyRole }) {
    const emailNormalized = normalizeEmail(input.email);
    const [inviter] = await this.db.select().from(agencyUsers).where(eq(agencyUsers.id, invitedByAgencyUserId)).limit(1);
    if (!inviter?.authUserId || inviter.role !== 'PLATFORM_OWNER') throw fail(403, 'AGENCY_ACCESS_DENIED', 'Only a platform owner can invite agency users.');
    const [existing] = await this.db.select().from(agencyUsers).where(eq(agencyUsers.emailNormalized, emailNormalized)).limit(1);
    if (existing && existing.status !== 'DEACTIVATED') throw fail(409, 'INVITATION_ALREADY_ACCEPTED', 'This address already has agency access or a pending invitation.');

    const created = await this.db.transaction(async tx => {
      const [agencyUser] = existing
        ? await tx.update(agencyUsers).set({ displayName: input.displayName, role: input.role, status: 'INVITED', authUserId: null, invitedByAgencyUserId, invitedAt: new Date(), deactivatedAt: null, updatedAt: new Date() }).where(eq(agencyUsers.id, existing.id)).returning()
        : await tx.insert(agencyUsers).values({ emailNormalized, displayName: input.displayName, role: input.role, status: 'INVITED', mfaRequired: input.role !== 'FULFILMENT_ADMINISTRATOR', invitedByAgencyUserId, invitedAt: new Date() }).returning();
      const [invitation] = await tx.insert(accountInvitations).values({
        invitationType: 'AGENCY', emailNormalized, agencyRole: input.role, status: 'PENDING',
        invitedByAuthUserId: inviter.authUserId!, invitedByAgencyUserId, expiresAt: invitationExpiry(),
      }).returning();
      return { agencyUser, invitation };
    }).catch(error => {
      if ((error as any)?.code === '23505') throw fail(409, 'INVITATION_ALREADY_ACCEPTED', 'A pending invitation already exists.');
      throw error;
    });
    try {
      const delivery = await this.deliver({ invitationId: created.invitation.id, invitationReference: created.invitation.publicReference, email: emailNormalized, displayName: input.displayName, context: 'AGENCY', accessLabel: 'the KS OS agency control plane' });
      await this.db.update(agencyUsers).set({ authUserId: delivery.authUserId, updatedAt: new Date() }).where(eq(agencyUsers.id, created.agencyUser.id));
      await audit({ authUserId: inviter.authUserId, agencyUserId: invitedByAgencyUserId, context: 'AGENCY', action: 'AGENCY_INVITATION_CREATED', metadata: { agencyRole: input.role, delivery: delivery.delivery } });
      return { invitationReference: created.invitation.publicReference, status: 'PENDING', delivery: delivery.delivery };
    } catch (error) {
      await audit({ authUserId: inviter.authUserId, agencyUserId: invitedByAgencyUserId, context: 'AGENCY', action: 'AGENCY_INVITATION_DELIVERY_FAILED', outcome: 'FAILED', reason: (error as any)?.code || 'DELIVERY_FAILED' });
      throw error;
    }
  }

  async createTenantInvitation(input: {
    tenantId: string; invitedByAuthUserId: string; invitedByTenantUserId?: string;
    invitedByAgencyUserId?: string; email: string; displayName: string; role: 'owner' | 'staff';
  }) {
    const emailNormalized = normalizeEmail(input.email);
    const [tenant] = await this.db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
    if (!tenant) throw fail(404, 'AUTH_WORKSPACE_NOT_FOUND', 'Business not found.');
    const [existing] = await this.db.select().from(users).where(and(eq(users.tenantId, input.tenantId), eq(users.emailNormalized, emailNormalized))).limit(1);
    if (existing && existing.accountStatus !== 'DEACTIVATED') throw fail(409, 'INVITATION_ALREADY_ACCEPTED', 'This address already has access or a pending invitation.');
    const invitationType = input.role === 'owner' ? 'TENANT_OWNER' : 'TENANT_STAFF';
    const created = await this.db.transaction(async tx => {
      const [membership] = existing
        ? await tx.update(users).set({ name: input.displayName, role: input.role, accountStatus: 'INVITED', authUserId: null, invitedByUserId: input.invitedByTenantUserId, invitedByAgencyUserId: input.invitedByAgencyUserId, invitedAt: new Date(), acceptedAt: null, deactivatedAt: null, updatedAt: new Date() }).where(eq(users.id, existing.id)).returning()
        : await tx.insert(users).values({ tenantId: input.tenantId, authUserId: null, email: emailNormalized, emailNormalized, name: input.displayName, role: input.role, accountStatus: 'INVITED', bookingEnabled: input.role === 'staff', invitedByUserId: input.invitedByTenantUserId, invitedByAgencyUserId: input.invitedByAgencyUserId, invitedAt: new Date() }).returning();
      const [invitation] = await tx.insert(accountInvitations).values({
        invitationType, emailNormalized, tenantId: input.tenantId, tenantRole: input.role, status: 'PENDING',
        invitedByAuthUserId: input.invitedByAuthUserId, invitedByTenantUserId: input.invitedByTenantUserId,
        invitedByAgencyUserId: input.invitedByAgencyUserId, expiresAt: invitationExpiry(),
      }).returning();
      return { membership, invitation };
    }).catch(error => {
      if ((error as any)?.code === '23505') throw fail(409, 'INVITATION_ALREADY_ACCEPTED', 'A pending invitation already exists.');
      throw error;
    });
    try {
      const delivery = await this.deliver({ invitationId: created.invitation.id, invitationReference: created.invitation.publicReference, email: emailNormalized, displayName: input.displayName, context: 'TENANT', accessLabel: tenant.name });
      await this.db.update(users).set({ authUserId: delivery.authUserId, updatedAt: new Date() }).where(eq(users.id, created.membership.id));
      await audit({ authUserId: input.invitedByAuthUserId, agencyUserId: input.invitedByAgencyUserId, tenantId: input.tenantId, tenantUserId: input.invitedByTenantUserId, context: 'TENANT', action: `${invitationType}_INVITATION_CREATED`, metadata: { delivery: delivery.delivery } });
      return { invitationReference: created.invitation.publicReference, status: 'PENDING', delivery: delivery.delivery };
    } catch (error) {
      await audit({ authUserId: input.invitedByAuthUserId, agencyUserId: input.invitedByAgencyUserId, tenantId: input.tenantId, tenantUserId: input.invitedByTenantUserId, context: 'TENANT', action: `${invitationType}_INVITATION_DELIVERY_FAILED`, outcome: 'FAILED', reason: (error as any)?.code || 'DELIVERY_FAILED' });
      throw error;
    }
  }

  async accept(invitationReference: string, identity: { authUserId: string; email: string }, expectedContext: 'AGENCY' | 'TENANT') {
    const normalized = normalizeEmail(identity.email);
    const { data: authRecord, error: authError } = await getSupabaseAdmin().auth.admin.getUserById(identity.authUserId);
    if (authError || !authRecord.user) throw fail(401, 'AUTH_REQUIRED', 'Authentication could not be verified.');
    if (!authRecord.user.email_confirmed_at) throw fail(403, 'AUTH_EMAIL_NOT_VERIFIED', 'Verify your email address before accepting this invitation.');
    if (normalizeEmail(authRecord.user.email || '') !== normalized) throw fail(403, 'INVITATION_EMAIL_MISMATCH', 'Sign in with the address that received this invitation.');
    return this.db.transaction(async tx => {
      const [invitation] = await tx.select().from(accountInvitations).where(eq(accountInvitations.publicReference, invitationReference)).for('update').limit(1);
      if (!invitation || (expectedContext === 'AGENCY') !== (invitation.invitationType === 'AGENCY')) throw fail(404, 'INVITATION_NOT_FOUND', 'Invitation not found.');
      if (invitation.status === 'ACCEPTED') throw fail(409, 'INVITATION_ALREADY_ACCEPTED', 'This invitation has already been accepted.');
      if (invitation.status === 'CANCELLED' || invitation.status === 'SUPERSEDED') throw fail(409, 'INVITATION_CANCELLED', 'This invitation is no longer available.');
      if (invitation.expiresAt <= new Date() || invitation.status === 'EXPIRED') {
        await tx.update(accountInvitations).set({ status: 'EXPIRED', updatedAt: new Date() }).where(eq(accountInvitations.id, invitation.id));
        throw fail(410, 'INVITATION_EXPIRED', 'This invitation has expired. Ask an administrator to resend it.');
      }
      if (invitation.emailNormalized !== normalized || (invitation.supabaseAuthUserId && invitation.supabaseAuthUserId !== identity.authUserId)) throw fail(403, 'INVITATION_EMAIL_MISMATCH', 'Sign in with the address that received this invitation.');
      const now = new Date();
      if (invitation.invitationType === 'AGENCY') {
        const [record] = await tx.update(agencyUsers).set({ authUserId: identity.authUserId, status: 'ACTIVE', activatedAt: now, lastLoginAt: now, suspendedAt: null, deactivatedAt: null, updatedAt: now }).where(eq(agencyUsers.emailNormalized, normalized)).returning();
        if (!record) throw fail(409, 'INVITATION_ACCEPTANCE_FAILED', 'Agency access could not be activated.');
      } else {
        const [record] = await tx.update(users).set({ authUserId: identity.authUserId, accountStatus: 'ACTIVE', acceptedAt: now, lastLoginAt: now, suspendedAt: null, deactivatedAt: null, updatedAt: now }).where(and(eq(users.tenantId, invitation.tenantId!), eq(users.emailNormalized, normalized), eq(users.accountStatus, 'INVITED'))).returning();
        if (!record) throw fail(409, 'INVITATION_ACCEPTANCE_FAILED', 'Business access could not be activated.');
      }
      await tx.update(accountInvitations).set({ status: 'ACCEPTED', acceptedAt: now, supabaseAuthUserId: identity.authUserId, updatedAt: now }).where(eq(accountInvitations.id, invitation.id));
      await tx.update(accountInvitations).set({ status: 'SUPERSEDED', updatedAt: now }).where(and(
        eq(accountInvitations.emailNormalized, normalized),
        invitation.tenantId ? eq(accountInvitations.tenantId, invitation.tenantId) : isNull(accountInvitations.tenantId),
        eq(accountInvitations.status, 'PENDING'),
      ));
      await tx.insert(accountAccessAuditEvents).values({ authUserId: identity.authUserId, tenantId: invitation.tenantId, applicationContext: expectedContext, action: 'INVITATION_ACCEPTED', metadata: { invitationType: invitation.invitationType } });
      return { accepted: true, context: expectedContext };
    });
  }

  async preview(invitationReference: string, identity: { authUserId: string; email: string }, expectedContext: 'AGENCY' | 'TENANT') {
    const normalized = normalizeEmail(identity.email);
    const [invitation] = await this.db.select().from(accountInvitations).where(eq(accountInvitations.publicReference, invitationReference)).limit(1);
    if (!invitation || (expectedContext === 'AGENCY') !== (invitation.invitationType === 'AGENCY')) throw fail(404, 'INVITATION_NOT_FOUND', 'Invitation not found.');
    if (invitation.emailNormalized !== normalized || (invitation.supabaseAuthUserId && invitation.supabaseAuthUserId !== identity.authUserId)) throw fail(403, 'INVITATION_EMAIL_MISMATCH', 'Sign in with the address that received this invitation.');
    if (invitation.status === 'ACCEPTED') throw fail(409, 'INVITATION_ALREADY_ACCEPTED', 'This invitation has already been accepted.');
    if (invitation.status !== 'PENDING') throw fail(409, 'INVITATION_CANCELLED', 'This invitation is no longer available.');
    if (invitation.expiresAt <= new Date()) throw fail(410, 'INVITATION_EXPIRED', 'This invitation has expired. Ask an administrator to resend it.');
    return { status: 'PENDING', requiresPasswordSetup: invitation.provisioningMode === 'SUPABASE_INVITE', expiresAt: invitation.expiresAt.toISOString() };
  }

  async resend(publicReference: string, actor: { authUserId: string; tenantId?: string; agencyUserId?: string }) {
    const [invitation] = await this.db.select().from(accountInvitations).where(eq(accountInvitations.publicReference, publicReference)).limit(1);
    if (!invitation || (actor.tenantId && invitation.tenantId !== actor.tenantId)) throw fail(404, 'INVITATION_NOT_FOUND', 'Invitation not found.');
    if (invitation.status !== 'PENDING') throw fail(409, invitation.status === 'ACCEPTED' ? 'INVITATION_ALREADY_ACCEPTED' : 'INVITATION_CANCELLED', 'This invitation cannot be resent.');
    const context = invitation.invitationType === 'AGENCY' ? 'AGENCY' : 'TENANT';
    const [membership] = invitation.tenantId
      ? await this.db.select({ name: users.name }).from(users).where(and(eq(users.tenantId, invitation.tenantId), eq(users.emailNormalized, invitation.emailNormalized))).limit(1)
      : await this.db.select({ name: agencyUsers.displayName }).from(agencyUsers).where(eq(agencyUsers.emailNormalized, invitation.emailNormalized)).limit(1);
    const newExpiry = invitationExpiry();
    await this.db.update(accountInvitations).set({ expiresAt: newExpiry, updatedAt: new Date() }).where(eq(accountInvitations.id, invitation.id));
    const delivery = await provisionSupabaseInvitation(invitation.emailNormalized, callbackUrl(context, invitation.publicReference));
    if (delivery.delivery === 'EXISTING_ACCOUNT') await this.email.sendExistingAccountNotice({ recipientEmail: invitation.emailNormalized, recipientName: membership?.name || 'there', accessLabel: context === 'AGENCY' ? 'the KS OS agency control plane' : 'your KS OS business', invitationUrl: acceptanceUrl(context, invitation.publicReference), idempotencyKey: `account-invitation-resend:${invitation.id}:${invitation.sendCount + 1}` });
    await this.db.update(accountInvitations).set({ supabaseAuthUserId: delivery.authUserId, lastSentAt: new Date(), sendCount: invitation.sendCount + 1, updatedAt: new Date() }).where(eq(accountInvitations.id, invitation.id));
    await audit({ authUserId: actor.authUserId, agencyUserId: actor.agencyUserId, tenantId: invitation.tenantId, context, action: 'INVITATION_RESENT', metadata: { invitationType: invitation.invitationType, delivery: delivery.delivery } });
    return { invitationReference: invitation.publicReference, status: 'PENDING', delivery: delivery.delivery };
  }

  async cancel(publicReference: string, actor: { authUserId: string; tenantId?: string; agencyUserId?: string }) {
    const [invitation] = await this.db.select().from(accountInvitations).where(eq(accountInvitations.publicReference, publicReference)).limit(1);
    if (!invitation || (actor.tenantId && invitation.tenantId !== actor.tenantId)) throw fail(404, 'INVITATION_NOT_FOUND', 'Invitation not found.');
    if (invitation.status !== 'PENDING') throw fail(409, 'INVITATION_CANCELLED', 'This invitation is no longer pending.');
    const now = new Date();
    await this.db.transaction(async tx => {
      await tx.update(accountInvitations).set({ status: 'CANCELLED', cancelledAt: now, updatedAt: now }).where(eq(accountInvitations.id, invitation.id));
      if (invitation.invitationType === 'AGENCY') await tx.update(agencyUsers).set({ status: 'DEACTIVATED', deactivatedAt: now, securityVersion: sql`${agencyUsers.securityVersion} + 1`, updatedAt: now }).where(eq(agencyUsers.emailNormalized, invitation.emailNormalized));
      else await tx.update(users).set({ accountStatus: 'DEACTIVATED', deactivatedAt: now, securityVersion: sql`${users.securityVersion} + 1`, updatedAt: now }).where(and(eq(users.tenantId, invitation.tenantId!), eq(users.emailNormalized, invitation.emailNormalized), eq(users.accountStatus, 'INVITED')));
      await tx.insert(accountAccessAuditEvents).values({ authUserId: actor.authUserId, agencyUserId: actor.agencyUserId, tenantId: invitation.tenantId, applicationContext: invitation.invitationType === 'AGENCY' ? 'AGENCY' : 'TENANT', action: 'INVITATION_CANCELLED', metadata: { invitationType: invitation.invitationType } });
    });
  }
}
