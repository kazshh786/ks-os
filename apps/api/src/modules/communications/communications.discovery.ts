import { sql } from '@ks-os/database';
import { z } from 'zod';
import type { ChatPreferences, ChatSearchQuerySchema } from '@ks-os/contracts';
import { CommunicationsAuthorization, notFound, type CommunicationsActor } from './communications.authorization.js';
import { defaultChatPreferences } from './communications.notifications.js';
import type { CommunicationsDatabase } from './communications.database.js';

export class CommunicationsDiscovery {
 constructor(private db:CommunicationsDatabase){}
 private async scoped<T>(actor:CommunicationsActor,work:(db:CommunicationsDatabase)=>Promise<T>){
   return this.db.transaction(async db=>{
     await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.tenantId},8241))`);
     await new CommunicationsAuthorization(db).authenticate(actor);return work(db);
   });
 }
 async search(actor:CommunicationsActor,q:z.infer<typeof ChatSearchQuerySchema>){
  return this.scoped(actor,async db=>{
   const rows=await db.query<{id:string;position:string}>(sql`SELECT msg.id,msg.conversation_id AS "conversationId",msg.reply_to_message_id AS "parentMessageId",
    msg.sender_user_id AS "senderId",msg.sender_name AS "senderName",left(msg.body,500) AS excerpt,msg.created_at AS "createdAt",msg.native_position::text AS position,
    CASE WHEN c.conversation_type='DIRECT' THEN coalesce((SELECT u.name FROM conversation_members peer JOIN users u ON u.id=peer.user_id WHERE peer.conversation_id=c.id AND peer.user_id<>${actor.userId} AND peer.left_at IS NULL LIMIT 1),'Former colleague') ELSE c.name END AS "conversationName"
    FROM conversation_messages msg JOIN conversations c ON c.id=msg.conversation_id AND c.tenant_id=msg.tenant_id
    JOIN conversation_members m ON m.conversation_id=c.id AND m.tenant_id=c.tenant_id AND m.user_id=${actor.userId} AND m.left_at IS NULL
    WHERE msg.tenant_id=${actor.tenantId} AND c.access_mode='MEMBERS' AND msg.channel_type='NATIVE' AND msg.deleted_at IS NULL
    ${q.q?sql`AND to_tsvector('english',msg.body) @@ websearch_to_tsquery('english',${q.q})`:sql``}
    ${q.conversationId?sql`AND c.id=${q.conversationId}`:sql``}
    ${q.senderId?sql`AND msg.sender_user_id=${q.senderId}`:sql``}
    ${q.from?sql`AND msg.created_at>=${q.from}::timestamptz`:sql``}
    ${q.to?sql`AND msg.created_at<=${q.to}::timestamptz`:sql``}
    ${q.before?sql`AND msg.native_position<${q.before}::bigint`:sql``}
    ${q.attachments?sql`AND EXISTS(SELECT 1 FROM conversation_attachments a WHERE a.message_id=msg.id AND a.status='AVAILABLE' AND a.deleted_at IS NULL)`:sql``}
    ORDER BY msg.native_position DESC LIMIT ${q.limit+1}`);
   return {data:rows.slice(0,q.limit),nextCursor:rows.length>q.limit?rows[q.limit-1].position:null};
  });
 }
 async preferences(actor:CommunicationsActor,input?:ChatPreferences){
  return this.scoped(actor,async db=>{
   if(input)await db.query(sql`INSERT INTO communication_preferences(tenant_id,user_id,browser,in_app,sound,dnd,direct_messages)
     VALUES(${actor.tenantId},${actor.userId},${input.browser},${input.inApp},${input.sound},${input.dnd},${input.directMessages})
     ON CONFLICT(user_id) DO UPDATE SET browser=excluded.browser,in_app=excluded.in_app,sound=excluded.sound,dnd=excluded.dnd,direct_messages=excluded.direct_messages`);
   const [row]=await db.query(sql`SELECT browser,in_app AS "inApp",sound,dnd,direct_messages AS "directMessages" FROM communication_preferences WHERE tenant_id=${actor.tenantId} AND user_id=${actor.userId}`);
   return row??defaultChatPreferences;
  });
 }
 async conversationPreference(actor:CommunicationsActor,id:string,mode?:string){
  return this.scoped(actor,async db=>{
   await new CommunicationsAuthorization(db).requireConversation(actor,id);
   if(mode) {
    await db.query(sql`UPDATE conversation_members SET notification_preference=${mode} WHERE conversation_id=${id} AND user_id=${actor.userId} AND tenant_id=${actor.tenantId}`);
    await db.query(sql`INSERT INTO communication_events(tenant_id,conversation_id,type,resource_id,recipient_user_id) VALUES(${actor.tenantId},${id},'notification.preferences_updated',${actor.userId},${actor.userId})`);
   }
   const [row]=await db.query(sql`SELECT notification_preference AS mode FROM conversation_members WHERE conversation_id=${id} AND user_id=${actor.userId}`);return row;
  });
 }
 async notifications(actor:CommunicationsActor,after?:string){
  return this.scoped(actor,async db=>{
   let cursor:{at:string;id:string}|undefined;
   if(after)cursor=z.object({at:z.string().datetime(),id:z.string().uuid()}).parse(JSON.parse(Buffer.from(after,'base64url').toString()));
   const rows=await db.query<{id:string;createdAt:string}>(sql`SELECT n.id,n.type,n.chat_conversation_id AS "conversationId",n.chat_message_id AS "messageId",
     msg.reply_to_message_id AS "parentMessageId",msg.sender_name AS "senderName",left(msg.body,160) AS preview,
     CASE WHEN c.conversation_type='DIRECT' THEN coalesce(msg.sender_name,'Direct message') ELSE c.name END AS "conversationName",
     n.read_at AS "readAt",to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"
     FROM internal_notifications n JOIN conversations c ON c.id=n.chat_conversation_id AND c.tenant_id=n.tenant_id
     JOIN conversation_members m ON m.conversation_id=c.id AND m.tenant_id=c.tenant_id AND m.user_id=${actor.userId} AND m.left_at IS NULL
     LEFT JOIN conversation_messages msg ON msg.id=n.chat_message_id AND msg.conversation_id=c.id AND msg.deleted_at IS NULL
     WHERE n.tenant_id=${actor.tenantId} AND n.recipient_user_id=${actor.userId} AND n.source_type='CHAT'
       AND (n.chat_message_id IS NULL OR msg.id IS NOT NULL)
       ${cursor?sql`AND (n.created_at,n.id)<(${cursor.at}::timestamptz,${cursor.id}::uuid)`:sql``}
     ORDER BY n.created_at DESC,n.id DESC LIMIT 31`);
   const last=rows[29];
   return {data:rows.slice(0,30),nextCursor:rows.length>30?Buffer.from(JSON.stringify({at:last.createdAt,id:last.id})).toString('base64url'):null};
  });
 }
 async readNotification(actor:CommunicationsActor,id:string){
  return this.scoped(actor,async db=>{
   const [row]=await db.query<{conversationId:string}>(sql`UPDATE internal_notifications n SET read_at=coalesce(read_at,now())
    WHERE n.id=${id} AND n.tenant_id=${actor.tenantId} AND n.recipient_user_id=${actor.userId} AND n.source_type='CHAT'
    AND EXISTS(SELECT 1 FROM conversation_members m WHERE m.conversation_id=n.chat_conversation_id AND m.user_id=${actor.userId} AND m.left_at IS NULL)
    RETURNING n.chat_conversation_id AS "conversationId"`);
   if(!row)throw notFound();
   await db.query(sql`INSERT INTO communication_events(tenant_id,conversation_id,type,resource_id,recipient_user_id) VALUES(${actor.tenantId},${row.conversationId},'notification.read',${id},${actor.userId})`);
   return {read:true};
  });
 }
}
