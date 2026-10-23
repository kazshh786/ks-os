import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type {} from '../../plugins/auth.js';
import { z } from 'zod';
import { sql } from '@ks-os/database';
import { MobileDeviceRegistrationSchema } from '@ks-os/contracts';
import { communicationsDatabase, type CommunicationsDatabase } from '../communications/communications.database.js';

const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const denied = () => fail(401, 'MOBILE_SESSION_REQUIRED', 'Sign in on this device again.');
type Context = 'TENANT' | 'CUSTOMER';
export type MobileIdentity = { authUserId: string; authSessionId: string; context: Context; issuedAt: string; expiresAt: string };
export type MobileDeviceBinding = { deviceId: string; authUserId: string; authSessionId: string; context: Context; platform: 'IOS' | 'ANDROID'; applicationId: string; environment: 'SANDBOX' | 'PRODUCTION'; authIssuedAt: string; hardExpiresAt: string };
const applicationSchema = z.object({ applicationId: MobileDeviceRegistrationSchema.shape.applicationId, platform: MobileDeviceRegistrationSchema.shape.platform, environment: MobileDeviceRegistrationSchema.shape.environment, redirectUri: z.string().url() }).strict();
export function mobileApplications(env: Record<string, string | undefined> = process.env) {
  if (!env.MOBILE_APPLICATIONS_JSON) return [];
  let applications: z.infer<typeof applicationSchema>[];
  try { applications = z.array(applicationSchema).min(1).max(20).parse(JSON.parse(env.MOBILE_APPLICATIONS_JSON)); }
  catch { throw fail(503, 'MOBILE_NOT_CONFIGURED', 'Mobile sign-in is not configured.'); }
  const keys = new Set<string>();
  for (const app of applications) {
    const uri = new URL(app.redirectUri), key = `${app.platform}:${app.applicationId}:${app.environment}`;
    // Production uses claimed HTTPS links. A configured custom scheme is allowed
    // only for sandbox apps; no wildcard, arbitrary redirects, or credentials.
    if (keys.has(key) || uri.username || uri.password || uri.search || uri.hash || app.redirectUri.includes('*') || (uri.protocol !== 'https:' && (app.environment !== 'SANDBOX' || ['http:', 'javascript:', 'data:', 'file:'].includes(uri.protocol)))) throw fail(503, 'MOBILE_NOT_CONFIGURED', 'Mobile sign-in is not configured.');
    keys.add(key);
  }
  return applications;
}
function identity(request: FastifyRequest): MobileIdentity {
  const value = request.requireIdentity();
  const context = request.applicationContext;
  if (context !== 'TENANT' && context !== 'CUSTOMER' || request.auth?.supportMode || request.agencyAuth) throw fail(403, 'MOBILE_CONTEXT_DENIED', 'Use your business or customer account.');
  if (!value.authSessionId || !value.issuedAt || !value.expiresAt || !Number.isFinite(Date.parse(value.issuedAt)) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw denied();
  return { authUserId: value.authUserId, authSessionId: value.authSessionId, issuedAt: value.issuedAt, expiresAt: value.expiresAt, context };
}
const iso = (value: unknown) => new Date(value as string | Date).toISOString();
async function currentContext(db: CommunicationsDatabase, input: { authUserId: string; authSessionId: string; context: Context; startedAt: string }) {
  const [session] = await db.query<{ hardExpiresAt: Date }>(sql`SELECT coalesce(s.hard_expires_at,s.expires_at) AS "hardExpiresAt" FROM application_sessions s
    WHERE s.auth_user_id=${input.authUserId} AND s.auth_session_id=${input.authSessionId} AND s.application_context=${input.context}
      AND s.revoked_at IS NULL AND coalesce(s.hard_expires_at,s.expires_at)>now()
      AND ${input.context === 'TENANT' ? sql`EXISTS(SELECT 1 FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.auth_user_id=s.auth_user_id AND u.account_status='ACTIVE' AND t.is_active=true AND t.lifecycle_status IN ('ACTIVE','ONBOARDING') AND (u.sessions_valid_after IS NULL OR u.sessions_valid_after<${input.startedAt}::timestamptz))`
        : sql`NOT EXISTS(SELECT 1 FROM customer_accounts a WHERE a.auth_user_id=s.auth_user_id AND (a.status<>'ACTIVE' OR a.sessions_valid_after>=${input.startedAt}::timestamptz))`} LIMIT 1`);
  if (!session) throw denied();
  return iso(session.hardExpiresAt);
}
export async function mobileProviderSessionCurrent(db: CommunicationsDatabase, input: { authSessionId: string; authUserId: string }) {
  const [row] = await db.query<{ startedAt: Date }>(sql`SELECT started_at AS "startedAt" FROM public.mobile_provider_session(${input.authSessionId}::uuid,${input.authUserId}::uuid)`);
  if (!row?.startedAt) throw denied();
  return iso(row.startedAt);
}
/** Resolve the original sign-in before selecting a workspace. A refreshed JWT's
 * iat must never move an existing native session past a membership cutoff. */
export async function registeredMobileSessionStartedAt(db: CommunicationsDatabase, input: { authSessionId: string; authUserId: string }): Promise<string | null> {
  try {
    const [device] = await db.query<{ authIssuedAt: Date; revokedAt: Date | null }>(sql`SELECT auth_issued_at AS "authIssuedAt",revoked_at AS "revokedAt" FROM mobile_devices WHERE auth_session_id=${input.authSessionId} AND auth_user_id=${input.authUserId}`);
    if (!device) return null;
    if (device.revokedAt) throw denied();
    const startedAt = await mobileProviderSessionCurrent(db, input);
    if (startedAt !== iso(device.authIssuedAt)) throw denied();
    return startedAt;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    throw fail(503, 'MOBILE_SESSION_UNAVAILABLE', 'Session verification is temporarily unavailable.');
  }
}
/** Background authorization deliberately checks the refreshable provider session
 * and immutable app hard expiry, not the last access JWT's short expiry. */
export async function validateMobileDeviceSession(db: CommunicationsDatabase, input: { deviceId: string; authUserId: string; context: Context }): Promise<MobileDeviceBinding> {
  const [device] = await db.query<{ deviceId: string; authUserId: string; authSessionId: string; platform: 'IOS' | 'ANDROID'; applicationId: string; environment: 'SANDBOX' | 'PRODUCTION'; authIssuedAt: Date }>(sql`SELECT id AS "deviceId",auth_user_id AS "authUserId",auth_session_id AS "authSessionId",platform,application_id AS "applicationId",environment,auth_issued_at AS "authIssuedAt" FROM mobile_devices WHERE id=${input.deviceId} AND auth_user_id=${input.authUserId} AND revoked_at IS NULL`);
  if (!device) throw denied();
  const startedAt = await mobileProviderSessionCurrent(db, device);
  if (startedAt !== iso(device.authIssuedAt)) throw denied();
  const hardExpiresAt = await currentContext(db, { ...device, context: input.context, startedAt });
  return { ...device, context: input.context, authIssuedAt: startedAt, hardExpiresAt };
}
export async function requireMobileDevice(request: FastifyRequest, db: CommunicationsDatabase = communicationsDatabase()): Promise<MobileDeviceBinding> {
  const actor = identity(request), parsed = z.string().uuid().safeParse(request.headers['x-ks-device-id']);
  if (!parsed.success) throw denied();
  const device = await validateMobileDeviceSession(db, { deviceId: parsed.data, authUserId: actor.authUserId, context: actor.context });
  if (device.authSessionId !== actor.authSessionId) throw denied();
  if (actor.context === 'TENANT' && request.auth) {
    const [principal] = await db.query(sql`SELECT id FROM users WHERE id=${request.auth.tenantUserId} AND tenant_id=${request.auth.tenantId} AND auth_user_id=${actor.authUserId}
      AND account_status='ACTIVE' AND (sessions_valid_after IS NULL OR sessions_valid_after<${device.authIssuedAt}::timestamptz)`);
    if (!principal) throw denied();
  }
  const updated = await db.query(sql`UPDATE mobile_devices SET last_seen_at=now(),last_authenticated_at=greatest(last_authenticated_at,${actor.issuedAt}::timestamptz),updated_at=now() WHERE id=${device.deviceId} AND revoked_at IS NULL RETURNING id`);
  if (!updated.length) throw denied();
  return device;
}
/** A registered native JWT cannot avoid device revocation by omitting its header. */
export async function checkRegisteredMobileSession(db: CommunicationsDatabase, actor: MobileIdentity) {
  try {
    const [row] = await db.query<{ id: string }>(sql`SELECT id FROM mobile_devices WHERE auth_session_id=${actor.authSessionId} AND auth_user_id=${actor.authUserId}`);
    return row ? await validateMobileDeviceSession(db, { deviceId: row.id, authUserId: actor.authUserId, context: actor.context }) : null;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    // The auth plugin must not retain an already resolved staff context when
    // the mandatory replay check cannot reach its authoritative session store.
    throw fail(503, 'MOBILE_SESSION_UNAVAILABLE', 'Session verification is temporarily unavailable.');
  }
}
const fields = sql`id,platform,application_id AS "applicationId",environment,device_name AS "deviceName",created_at AS "createdAt",last_seen_at AS "lastSeenAt",revoked_at AS "revokedAt",auth_session_id AS "sessionId"`;
function dto(row: Record<string, unknown>, session: string) { return { id: row.id, platform: row.platform, applicationId: row.applicationId, environment: row.environment, deviceName: row.deviceName, current: row.sessionId === session, createdAt: iso(row.createdAt), lastSeenAt: iso(row.lastSeenAt), revokedAt: row.revokedAt ? iso(row.revokedAt) : null }; }
export class MobileDevices {
  constructor(private db: CommunicationsDatabase = communicationsDatabase(), private env: Record<string, string | undefined> = process.env) {}
  async register(request: FastifyRequest, raw: unknown) {
    const actor = identity(request), input = MobileDeviceRegistrationSchema.parse(raw);
    if (!mobileApplications(this.env).some(app => app.applicationId === input.applicationId && app.platform === input.platform && app.environment === input.environment)) throw fail(403, 'MOBILE_APPLICATION_DENIED', 'This mobile application is not enabled.');
    return this.db.transaction(async db => {
      await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.authUserId},8241096))`);
      const startedAt = await mobileProviderSessionCurrent(db, actor);
      await currentContext(db, { ...actor, startedAt });
      const installationHash = createHash('sha256').update(`${actor.authUserId}:${input.applicationId}:${input.environment}:${input.installationId}`).digest('hex');
      const [existing] = await db.query(sql`SELECT ${fields},installation_hash AS "installationHash" FROM mobile_devices WHERE auth_session_id=${actor.authSessionId}`);
      if (existing) {
        if (existing.revokedAt || existing.installationHash !== installationHash || existing.platform !== input.platform || existing.applicationId !== input.applicationId || existing.environment !== input.environment) throw fail(409, 'MOBILE_SESSION_BOUND', 'Sign in separately on this installation.');
        await db.query(sql`UPDATE mobile_devices SET device_name=${input.deviceName ?? null},last_seen_at=now(),last_authenticated_at=${actor.issuedAt}::timestamptz,updated_at=now() WHERE id=${existing.id}`);
        return dto({ ...existing, deviceName: input.deviceName ?? null, lastSeenAt: new Date() }, actor.authSessionId);
      }
      const [count] = await db.query<{ count: number }>(sql`SELECT count(*)::int AS count FROM mobile_devices WHERE auth_user_id=${actor.authUserId} AND revoked_at IS NULL`);
      if (count.count >= 20) throw fail(429, 'MOBILE_DEVICE_LIMIT', 'Remove an unused device before adding another.');
      const [row] = await db.query(sql`INSERT INTO mobile_devices(auth_user_id,auth_session_id,platform,application_id,environment,installation_hash,device_name,auth_issued_at,last_authenticated_at)
        VALUES(${actor.authUserId},${actor.authSessionId},${input.platform},${input.applicationId},${input.environment},${installationHash},${input.deviceName ?? null},${startedAt}::timestamptz,${actor.issuedAt}::timestamptz) RETURNING ${fields}`);
      await db.query(sql`INSERT INTO account_access_audit_events(auth_user_id,application_context,action,metadata) VALUES(${actor.authUserId},${actor.context},'MOBILE_DEVICE_REGISTERED',${JSON.stringify({ deviceId: row.id, platform: input.platform, applicationId: input.applicationId })}::jsonb)`);
      return dto(row, actor.authSessionId);
    });
  }
  private async management(request: FastifyRequest, db = this.db) {
    const actor = identity(request), startedAt = await mobileProviderSessionCurrent(db, actor);
    await currentContext(db, { ...actor, startedAt });
    await checkRegisteredMobileSession(db, actor);
    return actor;
  }
  async list(request: FastifyRequest) {
    const actor = await this.management(request);
    const rows = await this.db.query(sql`SELECT ${fields} FROM mobile_devices WHERE auth_user_id=${actor.authUserId} ORDER BY (revoked_at IS NULL) DESC,created_at DESC,id DESC LIMIT 100`);
    return { data: rows.map(row => dto(row, actor.authSessionId)) };
  }
  async revoke(request: FastifyRequest, deviceId: string) {
    const actor = identity(request);
    return this.db.transaction(async db => {
      await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.authUserId},8241096))`);
      await this.management(request, db);
      const [row] = await db.query<{ revoked: boolean }>(sql`SELECT public.revoke_mobile_device(${deviceId}::uuid,${actor.authUserId}::uuid,'SELF_SERVICE_REVOCATION') AS revoked`);
      if (!row?.revoked) throw fail(404, 'MOBILE_DEVICE_NOT_FOUND', 'Device not found.');
      await db.query(sql`INSERT INTO account_access_audit_events(auth_user_id,application_context,action,metadata) VALUES(${actor.authUserId},${actor.context},'MOBILE_DEVICE_REVOKED',${JSON.stringify({ deviceId })}::jsonb)`);
      return { revoked: true };
    });
  }
  async revokeOthers(request: FastifyRequest) {
    const actor = identity(request);
    return this.db.transaction(async db => {
      await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.authUserId},8241096))`);
      const current = await requireMobileDevice(request, db);
      const rows = await db.query<{ id: string }>(sql`SELECT id FROM mobile_devices WHERE auth_user_id=${current.authUserId} AND id<>${current.deviceId} AND revoked_at IS NULL ORDER BY id`);
      for (const row of rows) await db.query(sql`SELECT public.revoke_mobile_device(${row.id}::uuid,${current.authUserId}::uuid,'OTHER_MOBILE_SESSIONS_REVOKED')`);
      await db.query(sql`INSERT INTO account_access_audit_events(auth_user_id,application_context,action,metadata) VALUES(${current.authUserId},${current.context},'OTHER_MOBILE_SESSIONS_REVOKED',${JSON.stringify({ count: rows.length })}::jsonb)`);
      return { revoked: rows.length, scope: 'OTHER_MOBILE_DEVICES' as const };
    });
  }
}
