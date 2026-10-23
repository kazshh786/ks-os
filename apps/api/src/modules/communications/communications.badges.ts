import { sql } from '@ks-os/database';
import { MobileBadgesSchema } from '@ks-os/contracts';
import { CommunicationsAuthorization, isCustomer, type CommunicationsActor } from './communications.authorization.js';
import type { CommunicationsDatabase } from './communications.database.js';
import { currentNotificationVisibility } from './communications.notification-visibility.js';

export class CommunicationBadges {
  constructor(private db: CommunicationsDatabase) {}
  async count(actor: CommunicationsActor) {
    return this.db.transaction(async db => {
      await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.tenantId},8241))`);
      await new CommunicationsAuthorization(db).authenticate(actor);
      const [conversations] = await db.query(sql`WITH unread AS (
        SELECT c.conversation_type AS type,(SELECT count(*) FROM conversation_messages msg
          WHERE msg.tenant_id=c.tenant_id AND msg.conversation_id=c.id AND msg.channel_type='NATIVE'
            AND msg.native_position>m.last_read_position AND msg.deleted_at IS NULL
            AND coalesce(msg.sender_user_id,msg.sender_customer_relationship_id) IS DISTINCT FROM ${actor.userId}::uuid) AS count
        FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id AND m.tenant_id=c.tenant_id
        WHERE c.tenant_id=${actor.tenantId} AND c.access_mode='MEMBERS' AND c.archived_at IS NULL
          AND coalesce(m.user_id,m.customer_relationship_id)=${actor.userId} AND m.left_at IS NULL
          AND (NOT ${isCustomer(actor)} OR (c.external_client_channel AND c.conversation_type='CLIENT'
            AND c.client_id=(SELECT client_id FROM customer_collaboration_relationships WHERE id=${actor.userId})))
      ) SELECT count(*) FILTER(WHERE count>0)::int AS "unreadConversations",
        coalesce(sum(count) FILTER(WHERE type IN ('DIRECT','GROUP_DIRECT')),0)::int AS "unreadDirectMessages",
        count(*) FILTER(WHERE count>0 AND type='CLIENT')::int AS "unreadClientConversations" FROM unread`);
      const visible = await currentNotificationVisibility(db, actor);
      const [notifications] = await db.query(sql`SELECT count(*)::int AS "unreadNotifications",
        count(*) FILTER(WHERE n.type='CALL_MISSED')::int AS "missedCalls" FROM internal_notifications n WHERE n.read_at IS NULL AND ${visible}`);
      return MobileBadgesSchema.parse({ ...conversations, ...notifications });
    });
  }
}
