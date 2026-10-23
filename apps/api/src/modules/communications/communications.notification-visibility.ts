import { sql, type SQL } from '@ks-os/database';
import type { CommunicationsActor } from './communications.authorization.js';
import type { CommunicationsDatabase } from './communications.database.js';
import { meetingNotificationVisibility } from './communications.meeting-notifications.js';

/** Self-contained predicate for a canonical notification row. Caller authenticates the actor first. */
export function notificationVisibility(actor: CommunicationsActor, alias = 'n'): SQL {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error('Invalid notification alias');
  const n = sql.raw(alias);
  return sql`(${n}.tenant_id=${actor.tenantId} AND coalesce(${n}.recipient_user_id,${n}.recipient_customer_relationship_id)=${actor.userId}
    AND ${n}.source_type IN ('CHAT','MEETING')
    AND ((${n}.chat_conversation_id IS NOT NULL AND EXISTS(SELECT 1 FROM conversations nc JOIN conversation_members nm ON nm.conversation_id=nc.id AND nm.tenant_id=nc.tenant_id
      WHERE nc.id=${n}.chat_conversation_id AND nc.tenant_id=${n}.tenant_id AND nc.access_mode='MEMBERS' AND nm.left_at IS NULL AND coalesce(nm.user_id,nm.customer_relationship_id)=${actor.userId}
      ${actor.kind === 'CUSTOMER' ? sql`AND nc.external_client_channel AND nc.conversation_type='CLIENT' AND EXISTS(SELECT 1 FROM customer_collaboration_relationships nr WHERE nr.id=nm.customer_relationship_id AND nr.tenant_id=nc.tenant_id AND nr.client_id=nc.client_id AND nr.status='ACTIVE' AND nr.revoked_at IS NULL)` : sql``}))
      OR (${n}.source_type='MEETING' AND ${n}.chat_conversation_id IS NULL AND ${actor.kind !== 'CUSTOMER'}))
    AND (${n}.chat_message_id IS NULL OR EXISTS(SELECT 1 FROM conversation_messages nx WHERE nx.id=${n}.chat_message_id AND nx.tenant_id=${n}.tenant_id AND nx.conversation_id=${n}.chat_conversation_id AND nx.deleted_at IS NULL))
    AND (${n}.chat_meeting_id IS NULL OR ${meetingNotificationVisibility(actor, alias)}))`;
}
/** Async boundary retained for callers that also compose permission-aware badge queries. */
export async function currentNotificationVisibility(_db: CommunicationsDatabase, actor: CommunicationsActor, alias = 'n'): Promise<SQL> { return notificationVisibility(actor, alias); }
