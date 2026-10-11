import { sql } from '@ks-os/database';
import type { ChatPreferences } from '@ks-os/contracts';
import type { CommunicationsDatabase } from './communications.database.js';
import type { CommunicationsActor } from './communications.authorization.js';

export const defaultChatPreferences:ChatPreferences={browser:false,inApp:true,sound:false,dnd:false,directMessages:true};
export async function notifyMessage(db:CommunicationsDatabase,actor:CommunicationsActor,id:string,messageId:string) {
  // One persisted record per message/recipient. No private content is copied into the general inbox.
  // DND suppresses transient delivery, while the persistent centre remains recoverable.
  const rows=await db.query<{id:string;recipient:string}>(sql`
    INSERT INTO internal_notifications(tenant_id,recipient_user_id,type,title,message,source_type,source_id,chat_conversation_id,chat_message_id)
    SELECT ${actor.tenantId},m.user_id,
      CASE WHEN EXISTS(SELECT 1 FROM communication_mentions x WHERE x.message_id=msg.id AND x.user_id=m.user_id) THEN 'CHAT_MENTION'
      WHEN msg.reply_to_message_id IS NOT NULL THEN 'CHAT_THREAD' ELSE 'CHAT_MESSAGE' END,
      'Chat update','Open Chat to view this update.','CHAT',msg.id,c.id,msg.id
    FROM conversation_members m JOIN conversations c ON c.id=m.conversation_id
    JOIN users u ON u.id=m.user_id AND u.tenant_id=m.tenant_id
    JOIN conversation_messages msg ON msg.id=${messageId} AND msg.conversation_id=c.id
    LEFT JOIN communication_preferences p ON p.user_id=m.user_id AND p.tenant_id=m.tenant_id
    WHERE c.id=${id} AND c.tenant_id=${actor.tenantId} AND m.left_at IS NULL AND u.account_status='ACTIVE'
      AND m.user_id<>${actor.userId} AND m.notification_preference<>'NONE'
      AND (coalesce(p.in_app,true) OR coalesce(p.browser,false))
      AND (c.conversation_type<>'DIRECT' OR coalesce(p.direct_messages,true))
      AND (m.notification_preference='ALL' OR EXISTS(SELECT 1 FROM communication_mentions x WHERE x.message_id=msg.id AND x.user_id=m.user_id))
    ON CONFLICT DO NOTHING RETURNING id,recipient_user_id AS recipient`);
  for(const row of rows) await db.query(sql`INSERT INTO communication_events(tenant_id,conversation_id,type,resource_id,recipient_user_id) VALUES(${actor.tenantId},${id},'notification.created',${row.id},${row.recipient})`);
}
export async function notifyInvitation(db:CommunicationsDatabase,actor:CommunicationsActor,id:string,userId:string,sourceId:string) {
  if(userId===actor.userId)return;
  const [row]=await db.query<{id:string}>(sql`INSERT INTO internal_notifications(tenant_id,recipient_user_id,type,title,message,source_type,source_id,chat_conversation_id)
    SELECT ${actor.tenantId},${userId},'CHAT_INVITATION','Chat invitation','Open Chat to view this update.','CHAT',${sourceId},${id}
    WHERE NOT EXISTS(SELECT 1 FROM communication_preferences WHERE user_id=${userId} AND in_app=false AND browser=false)
    ON CONFLICT DO NOTHING RETURNING id`);
  if(row)await db.query(sql`INSERT INTO communication_events(tenant_id,conversation_id,type,resource_id,recipient_user_id) VALUES(${actor.tenantId},${id},'notification.created',${row.id},${userId})`);
}
