import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  accountAccessAuditEvents, agencySessions, agencyUsers, applicationSessions, customerAccounts,
  getDatabase, tenants, users,
} from '@ks-os/database';
import type { FastifyRequest } from 'fastify';
import type { ApplicationContext } from '@ks-os/contracts';
import { effectiveCapabilities, type Permission } from '@ks-os/auth';

const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });

export class AuthenticationService {
  private db = getDatabase();

  private sessionIsCurrent(identity: { issuedAt: string | null }, validAfter: Date | null) {
    if (!validAfter) return true;
    if (!identity.issuedAt) return false;
    return new Date(identity.issuedAt) > validAfter;
  }

  private identity(request: FastifyRequest) {
    const identity = request.requireIdentity();
    if (!identity.authSessionId) throw fail(401, 'AUTH_SESSION_EXPIRED', 'Your session has expired. Sign in again.');
    return { ...identity, authSessionId: identity.authSessionId } as typeof identity & { authSessionId: string };
  }

  async context(request: FastifyRequest) {
    const identity = this.identity(request);
    const requestedContext = request.applicationContext;
    if (!requestedContext) throw fail(400, 'AUTH_CONTEXT_REQUIRED', 'Choose where you want to sign in.');
    const [agency, tenantMemberships, customer] = await Promise.all([
      this.db.select().from(agencyUsers).where(eq(agencyUsers.authUserId, identity.authUserId)).limit(1),
      this.db.select({ membership: users, tenant: tenants }).from(users)
        .innerJoin(tenants, eq(users.tenantId, tenants.id))
        .where(and(eq(users.authUserId, identity.authUserId), eq(users.accountStatus, 'ACTIVE'), eq(tenants.isActive, true), inArray(tenants.lifecycleStatus, ['ACTIVE','ONBOARDING']))),
      this.db.select().from(customerAccounts).where(and(eq(customerAccounts.authUserId, identity.authUserId), eq(customerAccounts.status, 'ACTIVE'))).limit(1),
    ]);
    const availableContexts: ApplicationContext[] = [];
    const currentAgency = agency[0]?.status === 'ACTIVE' && this.sessionIsCurrent(identity, agency[0].sessionsValidAfter) ? agency[0] : null;
    const currentTenantMemberships = tenantMemberships.filter(item => this.sessionIsCurrent(identity, item.membership.sessionsValidAfter));
    const currentCustomer = customer[0] && this.sessionIsCurrent(identity, customer[0].sessionsValidAfter) ? customer[0] : null;
    if (currentAgency) availableContexts.push('AGENCY');
    if (currentTenantMemberships.length) availableContexts.push('TENANT');
    if (currentCustomer) availableContexts.push('CUSTOMER');
    let next: 'READY' | 'SELECT_WORKSPACE' | 'MFA_ENROL' | 'MFA_CHALLENGE' | 'NO_ACCESS' = 'NO_ACCESS';
    if (requestedContext === 'TENANT' && currentTenantMemberships.length === 1) next = 'READY';
    if (requestedContext === 'TENANT' && currentTenantMemberships.length > 1) {
      const [session] = await this.db.select().from(applicationSessions).where(and(eq(applicationSessions.authSessionId, identity.authSessionId), eq(applicationSessions.applicationContext, 'TENANT'), isNull(applicationSessions.revokedAt))).limit(1);
      next = session?.selectedTenantUserId && currentTenantMemberships.some(item => item.membership.id === session.selectedTenantUserId) ? 'READY' : 'SELECT_WORKSPACE';
    }
    if (requestedContext === 'CUSTOMER' && currentCustomer) next = 'READY';
    if (requestedContext === 'AGENCY' && currentAgency) next = currentAgency.mfaRequired && identity.assuranceLevel !== 'aal2' ? 'MFA_CHALLENGE' : 'READY';
    return { authenticated: true as const, requestedContext, availableContexts, next };
  }

  async workspaceSession(request: FastifyRequest) {
    request.requireContext('TENANT');
    const identity = this.identity(request);
    const candidateRows = await this.db.select({ membership: users, tenant: tenants }).from(users)
      .innerJoin(tenants, eq(users.tenantId, tenants.id))
      .where(and(eq(users.authUserId, identity.authUserId), eq(users.accountStatus, 'ACTIVE'), eq(tenants.isActive, true), inArray(tenants.lifecycleStatus, ['ACTIVE','ONBOARDING'])));
    const rows = candidateRows.filter(row => this.sessionIsCurrent(identity, row.membership.sessionsValidAfter));
    if (!rows.length) {
      const [inactive] = await this.db.select().from(users).where(eq(users.authUserId, identity.authUserId)).limit(1);
      if (inactive?.accountStatus === 'SUSPENDED') throw fail(403, 'TENANT_MEMBERSHIP_SUSPENDED', 'Your access to this business is suspended.');
      if (inactive?.accountStatus === 'DEACTIVATED') throw fail(403, 'TENANT_MEMBERSHIP_DEACTIVATED', 'Your access to this business has ended.');
      throw fail(403, 'AUTH_NO_ACTIVE_WORKSPACE', 'No active business is available for this account.');
    }
    const [session] = await this.db.select().from(applicationSessions).where(and(
      eq(applicationSessions.authSessionId, identity.authSessionId), eq(applicationSessions.applicationContext, 'TENANT'),
    )).limit(1);
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw fail(401, 'AUTH_SESSION_REVOKED', 'This session is no longer active. Sign in again.');
    const selected = request.auth ? rows.find(row => row.membership.id === request.auth!.tenantUserId) : undefined;
    const permissions = selected
      ? effectiveCapabilities(selected.membership.role as 'owner' | 'staff', (selected.membership.accessProfile || 'PRACTITIONER') as any, (selected.membership.permissions || {}) as Record<string, boolean>) as Permission[]
      : [];
    return {
      context: 'TENANT' as const, authenticated: true as const,
      selectionRequired: rows.length > 1 && !selected,
      user: {
        email: identity.email || rows[0].membership.emailNormalized,
        displayName: selected?.membership.name || rows[0].membership.name,
        role: selected?.membership.role as 'owner' | 'staff' | undefined || null,
        permissions: Object.fromEntries(permissions.map(permission => [permission, true])),
      },
      business: selected ? {
        businessReference: selected.tenant.businessReference, name: selected.tenant.name,
        slug: selected.tenant.subdomain, primaryColor: selected.tenant.primaryColor,
        secondaryColor: selected.tenant.secondaryColor, accentColor: selected.tenant.accentColor,
      } : null,
      memberships: rows.map(row => ({
        membershipReference: row.membership.publicReference,
        businessReference: row.tenant.businessReference,
        businessName: row.tenant.name, businessSlug: row.tenant.subdomain,
        role: row.membership.role as 'owner' | 'staff', status: 'ACTIVE' as const,
        selected: selected?.membership.id === row.membership.id,
      })),
    };
  }

  async selectWorkspace(request: FastifyRequest, businessReference: string) {
    request.requireContext('TENANT');
    const identity = this.identity(request);
    const [match] = await this.db.select({ membership: users, tenant: tenants }).from(users)
      .innerJoin(tenants, eq(users.tenantId, tenants.id))
      .where(and(eq(users.authUserId, identity.authUserId), eq(users.accountStatus, 'ACTIVE'), eq(tenants.businessReference, businessReference), eq(tenants.isActive, true), inArray(tenants.lifecycleStatus, ['ACTIVE','ONBOARDING']))).limit(1);
    if (!match || !this.sessionIsCurrent(identity, match.membership.sessionsValidAfter)) throw fail(403, 'AUTH_WORKSPACE_ACCESS_DENIED', 'That business is not available to this account.');
    const [updated] = await this.db.update(applicationSessions).set({
      selectedTenantUserId: match.membership.id, securityVersion: match.membership.securityVersion, lastSeenAt: new Date(),
    }).where(and(eq(applicationSessions.authSessionId, identity.authSessionId), eq(applicationSessions.applicationContext, 'TENANT'), eq(applicationSessions.authUserId, identity.authUserId), isNull(applicationSessions.revokedAt))).returning();
    if (!updated) throw fail(401, 'AUTH_SESSION_EXPIRED', 'Your session has expired. Sign in again.');
    await this.db.insert(accountAccessAuditEvents).values({
      authUserId: identity.authUserId, tenantId: match.tenant.id, tenantUserId: match.membership.id,
      applicationContext: 'TENANT', action: 'WORKSPACE_SELECTED', requestId: request.id,
    });
    return { businessReference: match.tenant.businessReference, businessName: match.tenant.name };
  }

  async listSessions(request: FastifyRequest) {
    const identity = this.identity(request);
    const context = request.applicationContext;
    if (!context) throw fail(400, 'AUTH_CONTEXT_REQUIRED', 'Choose an account context.');
    const sessions = await this.db.select().from(applicationSessions).where(and(
      eq(applicationSessions.authUserId, identity.authUserId), eq(applicationSessions.applicationContext, context),
    )).orderBy(desc(applicationSessions.createdAt)).limit(50);
    return sessions.map(session => ({
      sessionReference: session.publicReference, context, current: session.authSessionId === identity.authSessionId,
      createdAt: session.createdAt.toISOString(), lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(), revokedAt: session.revokedAt?.toISOString() || null,
      device: session.deviceSummary,
    }));
  }

  async revokeSession(request: FastifyRequest, sessionReference: string) {
    const identity = this.identity(request);
    const [session] = await this.db.update(applicationSessions).set({ revokedAt: new Date(), revokeReason: 'SELF_SERVICE_REVOCATION' }).where(and(
      eq(applicationSessions.publicReference, sessionReference), eq(applicationSessions.authUserId, identity.authUserId), isNull(applicationSessions.revokedAt),
    )).returning();
    if (!session) throw fail(404, 'AUTH_SESSION_EXPIRED', 'Session not found or already ended.');
    if (session.applicationContext === 'AGENCY') await this.db.update(agencySessions).set({ revokedAt: new Date(), revokeReason: 'SELF_SERVICE_REVOCATION' }).where(and(eq(agencySessions.authSessionId, session.authSessionId), isNull(agencySessions.revokedAt)));
    await this.db.insert(accountAccessAuditEvents).values({ authUserId: identity.authUserId, applicationContext: session.applicationContext, action: 'SESSION_REVOKED', requestId: request.id, metadata: { current: session.authSessionId === identity.authSessionId } });
    return { revoked: true, current: session.authSessionId === identity.authSessionId };
  }

  async logout(request: FastifyRequest, all: boolean) {
    const identity = this.identity(request);
    const context = request.applicationContext;
    if (!context) throw fail(400, 'AUTH_CONTEXT_REQUIRED', 'Choose an account context.');
    const now = new Date();
    await this.db.transaction(async tx => {
      await tx.update(applicationSessions).set({ revokedAt: now, revokeReason: all ? 'GLOBAL_SIGN_OUT' : 'LOCAL_SIGN_OUT' }).where(and(
        eq(applicationSessions.authUserId, identity.authUserId),
        all ? sql`true` : and(eq(applicationSessions.authSessionId, identity.authSessionId), eq(applicationSessions.applicationContext, context)),
        isNull(applicationSessions.revokedAt),
      ));
      if (all) {
        await tx.update(users).set({ securityVersion: sql`${users.securityVersion} + 1`, sessionsValidAfter: now, updatedAt: now }).where(eq(users.authUserId, identity.authUserId));
        const [agency] = await tx.update(agencyUsers).set({ securityVersion: sql`${agencyUsers.securityVersion} + 1`, sessionsValidAfter: now, updatedAt: now }).where(eq(agencyUsers.authUserId, identity.authUserId)).returning({ id: agencyUsers.id });
        await tx.update(customerAccounts).set({ sessionsValidAfter: now, updatedAt: now }).where(eq(customerAccounts.authUserId, identity.authUserId));
        if (agency) await tx.update(agencySessions).set({ revokedAt: now, revokeReason: 'GLOBAL_SIGN_OUT' }).where(and(eq(agencySessions.agencyUserId, agency.id), isNull(agencySessions.revokedAt)));
      }
      await tx.insert(accountAccessAuditEvents).values({ authUserId: identity.authUserId, applicationContext: context, action: all ? 'GLOBAL_SIGN_OUT' : 'LOCAL_SIGN_OUT', requestId: request.id });
    });
    return { signedOut: true, scope: all ? 'GLOBAL' : 'LOCAL' };
  }
}
