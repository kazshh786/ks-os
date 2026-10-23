import { sql } from '@ks-os/database';
import { z } from 'zod';
import { validateMobileDeviceSession, type MobileDeviceBinding } from '../authentication/mobile-devices.service.js';
import { CommunicationsAuthorization, communicationError, customerId, staffId, type CommunicationsActor } from '../communications/communications.authorization.js';
import type { CommunicationsDatabase } from '../communications/communications.database.js';
import { encryptSecret, hashSecret } from '../integrations/integration-security.js';
import type { PushAdapter } from './push.types.js';

export const PushRegistrationSchema = z.object({ provider: z.enum(['APNS', 'FCM']), channel: z.enum(['ALERT', 'VOIP']), token: z.string().min(2).max(4096).refine(value => !/\s/.test(value)) }).strict();
const fields = sql`id,provider,channel,token_version AS "tokenVersion",last_seen_at AS "lastSeenAt",revoked_at AS "revokedAt",invalidated_at AS "invalidatedAt"`;
const missing = () => communicationError(404, 'PUSH_REGISTRATION_NOT_FOUND', 'Push registration is unavailable.');
export class MobilePushService {
  constructor(private db: CommunicationsDatabase, private adapters: PushAdapter[]) {}
  async registrations(device: MobileDeviceBinding) { await validateMobileDeviceSession(this.db, device); return this.db.query(sql`SELECT ${fields} FROM mobile_push_registrations WHERE device_id=${device.deviceId} ORDER BY created_at`); }
  async register(device: MobileDeviceBinding, input: z.infer<typeof PushRegistrationSchema>) {
    input = PushRegistrationSchema.parse(input);
    if ((device.platform === 'IOS') !== (input.provider === 'APNS') || input.provider === 'FCM' && input.channel !== 'ALERT') throw communicationError(400, 'PUSH_PLATFORM_MISMATCH', 'Choose the push provider for this device platform.');
    if (input.provider === 'APNS' && (!/^[a-f\d]{2,512}$/i.test(input.token) || input.token.length % 2)) throw communicationError(400, 'PUSH_TOKEN_FORMAT', 'The push token has an invalid format.');
    if (!this.adapters.some(adapter => adapter.matches({ ...device, ...input }))) throw communicationError(503, 'PUSH_NOT_CONFIGURED', 'Push delivery is not configured for this application and environment.');
    const token = input.provider === 'APNS' ? input.token.toLowerCase() : input.token;
    const hash = hashSecret([device.applicationId, device.environment, input.provider, input.channel, token].join('\0'));
    const ciphertext = encryptSecret({ token });
    return this.db.transaction(async db => {
      await validateMobileDeviceSession(db, device);
      await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${hash},8241097))`);
      const current = await db.query(sql`SELECT id FROM mobile_devices WHERE id=${device.deviceId} AND auth_user_id=${device.authUserId} AND revoked_at IS NULL FOR UPDATE`); if (!current.length) throw missing();
      const prior = await db.query<{ id: string }>(sql`UPDATE mobile_push_registrations SET revoked_at=now(),token_ciphertext='',updated_at=now() WHERE token_hash=${hash} AND device_id<>${device.deviceId} AND revoked_at IS NULL RETURNING id`);
      for (const value of prior) await db.query(sql`UPDATE mobile_push_deliveries SET status='CANCELLED',last_error_code='PUSH_TOKEN_REASSIGNED',updated_at=now() WHERE registration_id=${value.id} AND status IN ('PENDING','RETRY','PROCESSING')`);
      const [row] = await db.query<{ id: string; tokenVersion: number }>(sql`INSERT INTO mobile_push_registrations(device_id,provider,channel,token_ciphertext,token_hash)
        VALUES(${device.deviceId},${input.provider},${input.channel},${ciphertext},${hash}) ON CONFLICT(device_id,provider,channel) DO UPDATE SET
        token_version=mobile_push_registrations.token_version+CASE WHEN mobile_push_registrations.token_hash<>excluded.token_hash OR mobile_push_registrations.revoked_at IS NOT NULL OR mobile_push_registrations.invalidated_at IS NOT NULL THEN 1 ELSE 0 END,
        token_ciphertext=excluded.token_ciphertext,token_hash=excluded.token_hash,token_updated_at=now(),revoked_at=NULL,invalidated_at=NULL,last_seen_at=now(),updated_at=now() RETURNING ${fields}`);
      await db.query(sql`UPDATE mobile_push_deliveries SET token_version=${row.tokenVersion},updated_at=now() WHERE registration_id=${row.id} AND status IN ('PENDING','RETRY')`);
      await this.audit(db, device, 'mobile.push_registered', { registrationId: row.id, provider: input.provider, channel: input.channel });
      return row;
    });
  }
  async revoke(device: MobileDeviceBinding, id: string) {
    return this.db.transaction(async db => { await validateMobileDeviceSession(db, device);
      const rows = await db.query(sql`UPDATE mobile_push_registrations SET revoked_at=coalesce(revoked_at,now()),token_ciphertext='',updated_at=now() WHERE id=${id} AND device_id=${device.deviceId} RETURNING id`); if (!rows.length) throw missing();
      await db.query(sql`UPDATE mobile_push_deliveries SET status='CANCELLED',last_error_code='PUSH_REGISTRATION_REVOKED',updated_at=now() WHERE registration_id=${id} AND status IN ('PENDING','RETRY','PROCESSING')`);
      await this.audit(db, device, 'mobile.push_revoked', { registrationId: id }); return { revoked: true };
    });
  }
  async contexts(device: MobileDeviceBinding) { await validateMobileDeviceSession(this.db, device); return this.db.query(sql`SELECT id,tenant_id AS "tenantId",application_context AS context,user_id AS "userId",customer_relationship_id AS "relationshipId",enabled FROM mobile_push_contexts WHERE device_id=${device.deviceId} ORDER BY created_at`); }
  async enableContext(device: MobileDeviceBinding, actor: CommunicationsActor) {
    if (actor.authUserId !== device.authUserId || actor.sessionId !== device.authSessionId || (actor.kind === 'CUSTOMER') !== (device.context === 'CUSTOMER')) throw missing();
    return this.db.transaction(async db => {
      await validateMobileDeviceSession(db, device); await new CommunicationsAuthorization(db).authenticate(actor);
      const active = await db.query(sql`SELECT id FROM mobile_devices WHERE id=${device.deviceId} AND revoked_at IS NULL FOR UPDATE`);
      if (!active.length) throw missing();
      const [count] = await db.query<{ total: number }>(sql`SELECT count(*)::int AS total FROM mobile_push_contexts WHERE device_id=${device.deviceId} AND enabled AND NOT(tenant_id=${actor.tenantId} AND coalesce(user_id,customer_relationship_id)=${actor.userId})`);
      if (count.total >= 50) throw communicationError(429, 'PUSH_CONTEXT_LIMIT', 'Disable an existing push context before adding another.');
      const [version] = await db.query<{ security_version: number }>(sql`SELECT security_version FROM users WHERE id=${staffId(actor)} AND tenant_id=${actor.tenantId}`);
      const [row] = await db.query(sql`INSERT INTO mobile_push_contexts(device_id,tenant_id,application_context,user_id,customer_relationship_id,security_version)
        VALUES(${device.deviceId},${actor.tenantId},${device.context},${staffId(actor)},${customerId(actor)},${version?.security_version ?? null})
        ON CONFLICT(device_id,tenant_id,(coalesce(user_id,customer_relationship_id))) DO UPDATE SET enabled=true,security_version=excluded.security_version,updated_at=now()
        RETURNING id,tenant_id AS "tenantId",application_context AS context,user_id AS "userId",customer_relationship_id AS "relationshipId",enabled`);
      await this.audit(db, device, 'mobile.push_context_enabled', { contextId: row.id, tenantId: actor.tenantId }); return row;
    });
  }
  async disableContext(device: MobileDeviceBinding, id: string) {
    return this.db.transaction(async db => { await validateMobileDeviceSession(db, device); const rows = await db.query(sql`UPDATE mobile_push_contexts SET enabled=false,updated_at=now() WHERE id=${id} AND device_id=${device.deviceId} RETURNING id`); if (!rows.length) throw missing();
      await db.query(sql`UPDATE mobile_push_deliveries SET status='CANCELLED',last_error_code='PUSH_CONTEXT_DISABLED',updated_at=now() WHERE context_id=${id} AND status IN ('PENDING','PROCESSING','RETRY')`);
      await this.audit(db, device, 'mobile.push_context_disabled', { contextId: id }); return { disabled: true };
    });
  }
  private async audit(db: CommunicationsDatabase, device: MobileDeviceBinding, action: string, metadata: Record<string, unknown>) {
    await db.query(sql`INSERT INTO account_access_audit_events(auth_user_id,application_context,action,outcome,metadata) VALUES(${device.authUserId},${device.context},${action},'SUCCESS',${JSON.stringify(metadata)}::jsonb)`);
  }
}
