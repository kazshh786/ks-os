import fp from 'fastify-plugin';
import { type FastifyPluginAsync, type FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import {
  accountAccessAuditEvents, agencySessions, agencySupportSessions, agencyUsers, applicationSessions,
  customerAccounts, getDatabase, platformAuditEvents, tenants, users,
} from '@ks-os/database';
import { effectiveCapabilities, type Permission } from '@ks-os/auth';
import {
  AgencyRoleSchema, ApplicationContextSchema, agencyRoleNeedsMfa, capabilitiesForAgencyRole,
  isSupportPathBlocked, type AgencyCapability, type AgencyRole, type ApplicationContext,
} from '@ks-os/contracts';
import { supabase } from '../lib/supabase.js';

export interface AuthContext {
  authUserId: string;
  tenantUserId: string;
  membershipReference: string;
  email: string | null;
  tenantId: string;
  businessReference: string;
  tenantName: string;
  tenantSubdomain: string;
  role: 'owner' | 'staff';
  permissions: Permission[];
  supportMode?: boolean;
  agencyUserId?: string;
  supportSessionId?: string;
  supportExpiresAt?: string;
  supportReason?: string;
  supportScope?: 'READ_ONLY' | 'STANDARD_SUPPORT';
}

export interface AuthIdentity {
  authUserId: string;
  email: string | null;
  authSessionId: string | null;
  assuranceLevel: 'aal1' | 'aal2';
  expiresAt: string | null;
  issuedAt: string | null;
}

export interface AgencyAuthContext {
  agencyUserId: string;
  agencyUserReference: string;
  authUserId: string;
  email: string;
  displayName: string;
  role: AgencyRole;
  capabilities: readonly AgencyCapability[];
  assuranceLevel: 'aal1' | 'aal2';
  authSessionId: string;
  expiresAt: string;
  mfaRequired: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
    authIdentity?: AuthIdentity;
    agencyAuth?: AgencyAuthContext;
    applicationContext?: ApplicationContext;
    requireAuth: () => void;
    requireIdentity: () => AuthIdentity;
    requireContext: (context: ApplicationContext) => void;
    requireAgency: (capability?: AgencyCapability) => AgencyAuthContext;
  }
}

const ipHashFor = (request: FastifyRequest) => createHash('sha256')
  .update(`${process.env.AUDIT_IP_HASH_SECRET || 'local-development'}:${request.ip}`).digest('hex');

const safeDeviceSummary = (request: FastifyRequest) => {
  const value = request.headers['user-agent'];
  return typeof value === 'string' ? value.replace(/[\r\n]/g, ' ').slice(0, 255) : null;
};

async function ensureApplicationSession(input: {
  request: FastifyRequest;
  context: ApplicationContext;
  authUserId: string;
  authSessionId: string;
  assuranceLevel: 'aal1' | 'aal2';
  jwtExpiresAt: Date;
  securityVersion: number | null;
  hardTtlHours: number;
}) {
  const db = getDatabase();
  const [existing] = await db.select().from(applicationSessions).where(and(
    eq(applicationSessions.authSessionId, input.authSessionId),
    eq(applicationSessions.applicationContext, input.context),
  )).limit(1);
  const hardExpiry = new Date((existing?.createdAt?.getTime() || Date.now()) + input.hardTtlHours * 60 * 60 * 1000);
  const expiresAt = input.jwtExpiresAt < hardExpiry ? input.jwtExpiresAt : hardExpiry;
  if (expiresAt <= new Date() || existing?.revokedAt || (existing && input.securityVersion !== null && existing.securityVersion !== input.securityVersion)) return null;
  const [session] = await db.insert(applicationSessions).values({
    authSessionId: input.authSessionId, authUserId: input.authUserId, applicationContext: input.context,
    securityVersion: input.securityVersion ?? 1, assuranceLevel: input.assuranceLevel,
    deviceSummary: safeDeviceSummary(input.request), ipHash: ipHashFor(input.request), expiresAt, lastSeenAt: new Date(),
  }).onConflictDoUpdate({
    target: [applicationSessions.authSessionId, applicationSessions.applicationContext],
    set: { assuranceLevel: input.assuranceLevel, expiresAt, lastSeenAt: new Date(), deviceSummary: safeDeviceSummary(input.request) },
  }).returning();
  return session.revokedAt ? null : session;
}

async function resolveAgency(request: FastifyRequest, claims: Record<string, unknown>) {
  const authUserId = String(claims.sub);
  const db = getDatabase();
  const [agencyUser] = await db.select().from(agencyUsers).where(and(
    eq(agencyUsers.authUserId, authUserId), eq(agencyUsers.status, 'ACTIVE'),
  )).limit(1);
  if (!agencyUser || !AgencyRoleSchema.safeParse(agencyUser.role).success) return;
  const issuedAt = typeof claims.iat === 'number' ? new Date(claims.iat * 1000) : null;
  if (agencyUser.sessionsValidAfter && (!issuedAt || issuedAt <= agencyUser.sessionsValidAfter)) return;
  const role = agencyUser.role as AgencyRole;
  const aal = claims.aal === 'aal2' ? 'aal2' : 'aal1';
  const authSessionId = typeof claims.session_id === 'string' ? claims.session_id : null;
  if (!authSessionId) return;
  const jwtExpiresAt = new Date(Number(claims.exp || 0) * 1000);
  const applicationSession = await ensureApplicationSession({
    request, context: 'AGENCY', authUserId, authSessionId, assuranceLevel: aal,
    jwtExpiresAt, securityVersion: agencyUser.securityVersion, hardTtlHours: 8,
  });
  if (!applicationSession) return;

  // Retain the Phase 12 agency session ledger and its explicit eight-hour cap.
  const [existingAgencySession] = await db.select().from(agencySessions).where(eq(agencySessions.authSessionId, authSessionId)).limit(1);
  const hardExpiry = new Date((existingAgencySession?.createdAt?.getTime() || Date.now()) + 8 * 60 * 60 * 1000);
  const expiresAt = jwtExpiresAt < hardExpiry ? jwtExpiresAt : hardExpiry;
  const [session] = await db.insert(agencySessions).values({
    agencyUserId: agencyUser.id, authSessionId, assuranceLevel: aal, expiresAt, lastSeenAt: new Date(),
  }).onConflictDoUpdate({
    target: agencySessions.authSessionId,
    set: { assuranceLevel: aal, expiresAt, lastSeenAt: new Date() },
  }).returning();
  if (session.revokedAt) return;
  if (!existingAgencySession || (existingAgencySession.assuranceLevel !== 'aal2' && aal === 'aal2')) {
    await db.insert(accountAccessAuditEvents).values({
      authUserId, agencyUserId: agencyUser.id, applicationContext: 'AGENCY',
      action: !existingAgencySession ? 'AGENCY_LOGIN_SUCCESS' : 'AGENCY_MFA_VERIFIED',
      requestId: request.id, ipHash: ipHashFor(request),
    });
  }
  request.agencyAuth = {
    agencyUserId: agencyUser.id, agencyUserReference: agencyUser.publicReference, authUserId, email: agencyUser.emailNormalized,
    displayName: agencyUser.displayName, role, capabilities: capabilitiesForAgencyRole(role),
    assuranceLevel: aal, authSessionId, expiresAt: expiresAt.toISOString(),
    mfaRequired: agencyUser.mfaRequired && agencyRoleNeedsMfa(role) && aal !== 'aal2',
  };
  await db.update(agencyUsers).set({
    lastAuthenticatedAt: new Date(), lastLoginAt: new Date(), updatedAt: new Date(),
  }).where(eq(agencyUsers.id, agencyUser.id));
}

async function resolveSupport(request: FastifyRequest, authUserId: string) {
  const supportToken = request.headers['x-ks-support-session'];
  if (typeof supportToken !== 'string' || !request.agencyAuth || request.agencyAuth.mfaRequired) return false;
  const db = getDatabase();
  const tokenHash = createHash('sha256').update(supportToken).digest('hex');
  const [support] = await db.select().from(agencySupportSessions).where(and(
    eq(agencySupportSessions.tokenHash, tokenHash),
    eq(agencySupportSessions.agencyUserId, request.agencyAuth.agencyUserId),
    isNull(agencySupportSessions.revokedAt), gt(agencySupportSessions.expiresAt, new Date()),
  )).limit(1);
  if (!support) return false;
  if (isSupportPathBlocked(request.url)) throw Object.assign(new Error('This high-risk operation is blocked during support access.'), { statusCode: 403, code: 'SUPPORT_ACTION_BLOCKED' });
  if (support.scope === 'READ_ONLY' && !['GET','HEAD','OPTIONS'].includes(request.method)) throw Object.assign(new Error('This support session is read-only.'), { statusCode: 403, code: 'SUPPORT_READ_ONLY' });
  const [supportTenant] = await db.select().from(tenants).where(eq(tenants.id, support.tenantId)).limit(1);
  if (!supportTenant) return false;
  request.auth = {
    authUserId, tenantUserId: request.agencyAuth.agencyUserId, membershipReference: supportTenant.businessReference,
    email: request.agencyAuth.email, tenantId: supportTenant.id, businessReference: supportTenant.businessReference,
    tenantName: supportTenant.name, tenantSubdomain: supportTenant.subdomain, role: 'owner',
    permissions: effectiveCapabilities('owner') as Permission[], supportMode: true,
    agencyUserId: request.agencyAuth.agencyUserId, supportSessionId: support.id,
    supportExpiresAt: support.expiresAt.toISOString(), supportReason: support.reason,
    supportScope: support.scope as 'READ_ONLY' | 'STANDARD_SUPPORT',
  };
  await db.update(agencySupportSessions).set({ lastUsedAt: new Date() }).where(eq(agencySupportSessions.id, support.id));
  return true;
}

async function resolveTenant(request: FastifyRequest, claims: Record<string, unknown>) {
  const authUserId = String(claims.sub);
  const authSessionId = typeof claims.session_id === 'string' ? claims.session_id : null;
  if (!authSessionId) return;
  const db = getDatabase();
  const memberships = await db.select().from(users).where(and(
    eq(users.authUserId, authUserId), eq(users.accountStatus, 'ACTIVE'),
  ));
  const issuedAt = typeof claims.iat === 'number' ? new Date(claims.iat * 1000) : null;
  const activeMemberships = [] as typeof memberships;
  for (const membership of memberships) {
    if (membership.sessionsValidAfter && (!issuedAt || issuedAt <= membership.sessionsValidAfter)) continue;
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, membership.tenantId)).limit(1);
    if (tenant?.isActive !== false && !['SUSPENDED','OFFBOARDING','OFFBOARDED'].includes(tenant?.lifecycleStatus || '')) activeMemberships.push(membership);
  }
  if (!activeMemberships.length) return;

  const aal = claims.aal === 'aal2' ? 'aal2' : 'aal1';
  const jwtExpiresAt = new Date(Number(claims.exp || 0) * 1000);
  const tenantTtl = Number(process.env.TENANT_SESSION_HARD_TTL_HOURS || 24);
  const applicationSession = await ensureApplicationSession({
    request, context: 'TENANT', authUserId, authSessionId, assuranceLevel: aal,
    jwtExpiresAt, securityVersion: null, hardTtlHours: tenantTtl,
  });
  if (!applicationSession) return;
  let membership = activeMemberships.length === 1
    ? activeMemberships[0]
    : activeMemberships.find(item => item.id === applicationSession.selectedTenantUserId);
  if (!membership) return;
  if (applicationSession.selectedTenantUserId === membership.id && applicationSession.securityVersion !== membership.securityVersion) return;
  if (applicationSession.selectedTenantUserId !== membership.id) {
    await db.update(applicationSessions).set({
      selectedTenantUserId: membership.id, securityVersion: membership.securityVersion, lastSeenAt: new Date(),
    }).where(eq(applicationSessions.id, applicationSession.id));
  }
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, membership.tenantId)).limit(1);
  if (!tenant) return;
  if (tenant.isActive === false || ['SUSPENDED','OFFBOARDING','OFFBOARDED'].includes(tenant.lifecycleStatus)) {
    request.log.warn({ authUserId, tenantId: tenant.id, lifecycleStatus: tenant.lifecycleStatus }, 'Inactive tenant access denied');
    return;
  }
  if (membership.role !== 'owner' && membership.role !== 'staff') return;
  request.auth = {
    authUserId, tenantUserId: membership.id, membershipReference: membership.publicReference,
    email: membership.emailNormalized, tenantId: tenant.id, businessReference: tenant.businessReference,
    tenantName: tenant.name, tenantSubdomain: tenant.subdomain, role: membership.role,
    permissions: effectiveCapabilities(membership.role, (membership.accessProfile || 'PRACTITIONER') as any,
      (membership.permissions || {}) as Record<string, boolean>) as Permission[],
  };
  await db.update(users).set({ lastLoginAt: new Date(), lastActiveAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, membership.id));
}

const authPlugin: FastifyPluginAsync = async fastify => {
  fastify.decorateRequest('auth', null);
  fastify.decorateRequest('authIdentity', null);
  fastify.decorateRequest('agencyAuth', null);
  fastify.decorateRequest('applicationContext', null);
  fastify.decorateRequest('requireAuth', function (this: FastifyRequest) {
    if (!this.auth) throw Object.assign(new Error('Authentication required'), { statusCode: 401, code: 'AUTH_REQUIRED' });
  });
  fastify.decorateRequest('requireIdentity', function (this: FastifyRequest) {
    if (!this.authIdentity) throw Object.assign(new Error('Authentication required'), { statusCode: 401, code: 'AUTH_REQUIRED' });
    return this.authIdentity;
  });
  fastify.decorateRequest('requireContext', function (this: FastifyRequest, context: ApplicationContext) {
    if (this.applicationContext !== context) throw Object.assign(new Error('This sign-in context is not allowed here.'), { statusCode: 403, code: 'AUTH_CONTEXT_NOT_ALLOWED' });
  });
  fastify.decorateRequest('requireAgency', function (this: FastifyRequest, capability?: AgencyCapability) {
    this.requireContext('AGENCY');
    if (!this.agencyAuth) throw Object.assign(new Error('Agency authentication required'), { statusCode: 401, code: 'AGENCY_ACCESS_DENIED' });
    if (this.agencyAuth.mfaRequired) throw Object.assign(new Error('Multi-factor authentication is required for this agency role.'), { statusCode: 403, code: 'AGENCY_MFA_REQUIRED' });
    if (capability && !this.agencyAuth.capabilities.includes(capability)) throw Object.assign(new Error('Agency capability required'), { statusCode: 403, code: 'AGENCY_FORBIDDEN' });
    return this.agencyAuth;
  });

  fastify.addHook('onRequest', async request => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return;
    const { data: decodedData, error } = await supabase.auth.getClaims(authHeader.slice(7));
    if (error || !decodedData) return;
    const claims = ((decodedData as any).claims || decodedData) as Record<string, unknown>;
    if (!claims.sub) return;
    const parsedContext = ApplicationContextSchema.safeParse(request.headers['x-ks-application-context']);
    request.applicationContext = parsedContext.success ? parsedContext.data : undefined;
    const assuranceLevel = claims.aal === 'aal2' ? 'aal2' : 'aal1';
    request.authIdentity = {
      authUserId: String(claims.sub), email: typeof claims.email === 'string' ? claims.email : null,
      authSessionId: typeof claims.session_id === 'string' ? claims.session_id : null,
      assuranceLevel, expiresAt: claims.exp ? new Date(Number(claims.exp) * 1000).toISOString() : null,
      issuedAt: claims.iat ? new Date(Number(claims.iat) * 1000).toISOString() : null,
    };
    if (!request.applicationContext) return;
    try {
      if (request.applicationContext === 'AGENCY') await resolveAgency(request, claims);
      if (request.applicationContext === 'TENANT') {
        if (typeof request.headers['x-ks-support-session'] === 'string') {
          await resolveAgency(request, claims);
          if (await resolveSupport(request, String(claims.sub))) return;
        }
        await resolveTenant(request, claims);
      }
      if (request.applicationContext === 'CUSTOMER' && request.authIdentity.authSessionId) {
        const [customer] = await getDatabase().select().from(customerAccounts).where(eq(customerAccounts.authUserId, request.authIdentity.authUserId)).limit(1);
        const issuedAt = request.authIdentity.issuedAt ? new Date(request.authIdentity.issuedAt) : null;
        if (customer?.sessionsValidAfter && (!issuedAt || issuedAt <= customer.sessionsValidAfter)) { request.authIdentity = undefined; return; }
        const contextSession = await ensureApplicationSession({
          request, context: 'CUSTOMER', authUserId: request.authIdentity.authUserId,
          authSessionId: request.authIdentity.authSessionId, assuranceLevel,
          jwtExpiresAt: new Date(Number(claims.exp || 0) * 1000), securityVersion: 1,
          hardTtlHours: Number(process.env.CUSTOMER_SESSION_HARD_TTL_HOURS || 720),
        });
        if (!contextSession) request.authIdentity = undefined;
      }
    } catch (error) {
      if ((error as any)?.statusCode) throw error;
      request.log.error({ error }, 'Authentication context resolution failed');
    }
  });

  fastify.addHook('onResponse', async (request, reply) => {
    if (!request.auth?.supportMode || !request.agencyAuth) return;
    try {
      await getDatabase().insert(platformAuditEvents).values({
        agencyUserId: request.agencyAuth.agencyUserId, supportSessionId: request.auth.supportSessionId,
        tenantId: request.auth.tenantId, action: `SUPPORT_${request.method}`, targetType: 'TENANT_ROUTE',
        targetId: request.routeOptions.url, outcome: reply.statusCode < 400 ? 'SUCCESS' : 'FAILED',
        requestId: request.id, ipHash: ipHashFor(request), metadata: { statusCode: reply.statusCode },
      });
      await getDatabase().insert(accountAccessAuditEvents).values({
        authUserId: request.auth.authUserId, agencyUserId: request.agencyAuth.agencyUserId,
        tenantId: request.auth.tenantId, applicationContext: 'TENANT', action: `SUPPORT_${request.method}`,
        outcome: reply.statusCode < 400 ? 'SUCCESS' : 'FAILED', requestId: request.id,
        ipHash: ipHashFor(request), metadata: { route: request.routeOptions.url, statusCode: reply.statusCode },
      });
    } catch (error) { request.log.error({ error }, 'Support audit write failed'); }
  });
};

export default fp(authPlugin);
