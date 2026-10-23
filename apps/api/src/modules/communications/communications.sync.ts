import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { sql } from '@ks-os/database';
import { MobileSyncResponseSchema, type MobileSyncQuery } from '@ks-os/contracts';
import { z } from 'zod';
import { CommunicationsAuthorization, communicationError, isCustomer, type CommunicationsActor } from './communications.authorization.js';
import { ClientMeetings } from './communications.client-meetings.js';
import { currentMeetingAccessSql } from './communications.meeting-notifications.js';
import type { CommunicationsDatabase } from './communications.database.js';

const cursorSchema = z.object({ v: z.literal(1), tenant: z.string().uuid(), user: z.string().uuid(),
  auth: z.string().uuid(), kind: z.enum(['TENANT', 'CUSTOMER']), after: z.string().regex(/^(0|[1-9][0-9]{0,18})$/), expires: z.number().int() }).strict();
const lifetime = 7 * 86400000;
const aad = Buffer.from('ksos-communications-sync-v1');
const reset = () => communicationError(410, 'SYNC_RESET_REQUIRED', 'Clear this context cache and request a new sync snapshot.');

/** Cursors are encrypted, authenticated, finite-lived and scoped to an identity + principal + tenant. */
export class CommunicationsSync {
  constructor(private db: CommunicationsDatabase, private keySource = () => process.env.MOBILE_SYNC_CURSOR_KEY ?? '', private now = Date.now) {}
  private key() {
    const key = this.keySource();
    if (!/^[a-f0-9]{64}$/i.test(key)) throw communicationError(503, 'SYNC_UNAVAILABLE', 'Incremental sync has not been configured.');
    return Buffer.from(key, 'hex');
  }
  private encode(actor: CommunicationsActor, after: string) {
    const expires = this.now() + lifetime, iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(aad);
    const value = { v: 1, tenant: actor.tenantId, user: actor.userId, auth: actor.authUserId, kind: isCustomer(actor) ? 'CUSTOMER' : 'TENANT', after, expires };
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return { cursor: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url'), cursorExpiresAt: new Date(expires).toISOString() };
  }
  private decode(actor: CommunicationsActor, token: string) {
    const key = this.key();
    let value: z.infer<typeof cursorSchema>;
    try {
      if (!/^[A-Za-z0-9_-]{40,1500}$/.test(token)) throw new Error('Encoding');
      const bytes = Buffer.from(token, 'base64url'), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(aad); decipher.setAuthTag(bytes.subarray(12, 28));
      value = cursorSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString()));
    } catch { throw reset(); }
    if (value.tenant !== actor.tenantId || value.user !== actor.userId || value.auth !== actor.authUserId || value.kind !== (isCustomer(actor) ? 'CUSTOMER' : 'TENANT')) {
      throw communicationError(403, 'SYNC_CONTEXT_MISMATCH', 'Use a sync cursor belonging to the selected account and organisation.');
    }
    if (value.expires <= this.now()) throw reset();
    return value.after;
  }
  async page(actor: CommunicationsActor, query: MobileSyncQuery) {
    return this.db.transaction(async db => {
      // Match mutation lock order; the state row is also held through our read.
      await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.tenantId},8241))`);
      await new CommunicationsAuthorization(db).authenticate(actor);
      await db.query(sql`INSERT INTO communication_sync_state(tenant_id) VALUES(${actor.tenantId}) ON CONFLICT DO NOTHING`);
      const [state] = await db.query<{ position: string; floor: string }>(sql`SELECT position::text,replay_floor::text AS floor FROM communication_sync_state WHERE tenant_id=${actor.tenantId} FOR UPDATE`);
      if (!query.cursor) return MobileSyncResponseSchema.parse({ version: 1, mode: 'SNAPSHOT_REQUIRED', changes: [], ...this.encode(actor, state.position), hasMore: false });
      const after = this.decode(actor, query.cursor);
      if (BigInt(after) < BigInt(state.floor) || BigInt(after) > BigInt(state.position)) throw reset();
      const access = isCustomer(actor) ? { all: false, own: false } : await new ClientMeetings(db).eventAccess(actor);
      const ownRemoval = sql`(e.type='conversation.member_left' AND EXISTS(SELECT 1 FROM conversation_members removed
        WHERE removed.tenant_id=e.tenant_id AND removed.conversation_id=e.conversation_id
          AND coalesce(removed.user_id,removed.customer_relationship_id)=${actor.userId}
          AND (e.resource_id=removed.id OR (${isCustomer(actor)} AND e.resource_id=removed.customer_relationship_id))))`;
      const rows = await db.query<{ id: string; position: string; type: string; conversationId: string | null; meetingId: string | null; resourceId: string | null; occurredAt: Date; visible: boolean; purge: boolean }>(sql`
        WITH batch AS (SELECT * FROM communication_events WHERE tenant_id=${actor.tenantId}
          AND sync_position>${after}::bigint ORDER BY sync_position LIMIT ${query.limit + 1})
        SELECT e.id::text,e.sync_position::text AS position,e.type,e.conversation_id AS "conversationId",e.meeting_id AS "meetingId",e.resource_id AS "resourceId",e.occurred_at AS "occurredAt",
          ${ownRemoval} AS purge,
          ((coalesce(e.recipient_user_id,e.recipient_customer_relationship_id) IS NULL OR coalesce(e.recipient_user_id,e.recipient_customer_relationship_id)=${actor.userId}) AND (
            ${ownRemoval}
            OR EXISTS(SELECT 1 FROM conversation_members m JOIN conversations c ON c.id=m.conversation_id AND c.tenant_id=m.tenant_id
              WHERE m.tenant_id=e.tenant_id AND m.conversation_id=e.conversation_id AND c.access_mode='MEMBERS'
                AND coalesce(m.user_id,m.customer_relationship_id)=${actor.userId} AND m.left_at IS NULL
                AND (NOT ${isCustomer(actor)} OR (c.external_client_channel AND c.client_id=(SELECT client_id FROM customer_collaboration_relationships WHERE id=${actor.userId}))))
            OR (e.conversation_id IS NULL AND EXISTS(SELECT 1 FROM communication_meetings cm WHERE cm.id=e.meeting_id AND cm.tenant_id=e.tenant_id AND ${currentMeetingAccessSql(actor, 'cm', access)}))
          )) AS visible
        FROM batch e ORDER BY e.sync_position`);
      const page = rows.slice(0, query.limit), last = page.at(-1)?.position ?? state.position;
      return MobileSyncResponseSchema.parse({ version: 1, mode: 'CHANGES', hasMore: rows.length > query.limit, ...this.encode(actor, last),
        changes: page.filter(row => row.visible).map(({ visible: _visible, purge, ...row }) => ({ ...row, action: purge ? 'PURGE_CONVERSATION' : 'REFRESH', occurredAt: new Date(row.occurredAt).toISOString() })) });
    });
  }
}
