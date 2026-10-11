import { z } from 'zod';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { sql } from '@ks-os/database';
import {
  CommunicationsEventSchema, type CommunicationsEvent, type CreateNativeConversation,
  type CreateNativeMessage, type NativeMessageQuery, type NativeConversationQuery, type AddConversationMember,
  type ChannelDiscoveryQuerySchema, type UpdateNativeMessageSchema, type UpdateNativeChannelSchema, type SetNativeReactionSchema,
} from '@ks-os/contracts';
import {
  CommunicationsActorSchema, CommunicationsAuthorization, communicationError, notFound, type CommunicationsActor,
} from './communications.authorization.js';
import { communicationsDatabase, type CommunicationsDatabase } from './communications.database.js';

const conversationFields = sql`c.id,c.conversation_type AS type,
  CASE WHEN c.conversation_type='DIRECT' THEN coalesce((SELECT u.name FROM conversation_members peer JOIN users u ON u.id=peer.user_id AND u.tenant_id=peer.tenant_id WHERE peer.conversation_id=c.id AND peer.user_id<>m.user_id AND peer.left_at IS NULL LIMIT 1),'Former colleague') ELSE c.name END AS name,c.slug,c.description,
  c.created_by_user_id AS "createdBy",c.created_at AS "createdAt",c.updated_at AS "updatedAt",c.archived_at AS "archivedAt",
  (SELECT count(*)::int FROM conversation_members cm WHERE cm.conversation_id=c.id AND cm.left_at IS NULL) AS "memberCount",
  (SELECT id FROM conversation_messages lm WHERE lm.conversation_id=c.id AND lm.native_position IS NOT NULL ORDER BY lm.native_position DESC LIMIT 1) AS "latestMessageId",
  c.last_message_at AS "lastActivityAt",
  (SELECT CASE WHEN lm.deleted_at IS NOT NULL THEN 'Message deleted' ELSE left(lm.body,160) END FROM conversation_messages lm WHERE lm.conversation_id=c.id AND lm.native_position IS NOT NULL ORDER BY lm.native_position DESC LIMIT 1) AS preview,
  (SELECT peer.user_id FROM conversation_members peer WHERE c.conversation_type='DIRECT' AND peer.conversation_id=c.id AND peer.user_id<>m.user_id AND peer.left_at IS NULL LIMIT 1) AS "peerUserId",
  m.role AS "memberRole",m.last_read_position::text AS "lastReadPosition",m.last_read_at AS "lastReadAt"`;
const messageFields = sql`m.id,m.conversation_id AS "conversationId",m.sender_user_id AS "senderId",m.sender_name AS "senderName",
  CASE WHEN m.deleted_at IS NULL THEN m.body ELSE NULL END AS body,m.message_type AS type,
  m.reply_to_message_id AS "parentMessageId",m.native_position::text AS position,
  m.created_at AS "createdAt",m.updated_at AS "updatedAt",m.edited_at AS "editedAt",m.deleted_at AS "deletedAt",
  (SELECT count(*)::int FROM conversation_messages r WHERE r.conversation_id=m.conversation_id AND r.reply_to_message_id=m.id AND r.native_position IS NOT NULL) AS "replyCount"`;

export class CommunicationsService {
  constructor(private db: CommunicationsDatabase = communicationsDatabase()) {}

  private async journalLock(db: CommunicationsDatabase, actor: CommunicationsActor) {
    await db.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.tenantId}, 8241))`);
  }

  private unreadFields(actor: CommunicationsActor) {
    return sql`(SELECT count(*)::int FROM conversation_messages msg WHERE msg.conversation_id=c.id
      AND msg.native_position > m.last_read_position AND msg.deleted_at IS NULL
      AND msg.sender_user_id IS DISTINCT FROM ${actor.userId}::uuid) AS "unreadCount"`;
  }

  async capabilities(actor: CommunicationsActor) {
    return new CommunicationsAuthorization(this.db).authenticate(actor);
  }

  async discover(actor: CommunicationsActor, query: z.infer<typeof ChannelDiscoveryQuerySchema>) {
    await new CommunicationsAuthorization(this.db).authenticate(actor);
    const rows = await this.db.query<{id:string}>(sql`SELECT c.id,c.name,c.description,c.slug
      FROM conversations c WHERE c.tenant_id=${actor.tenantId} AND c.access_mode='MEMBERS'
      AND c.conversation_type='CHANNEL' AND c.archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM conversation_members m WHERE m.conversation_id=c.id AND m.user_id=${actor.userId} AND m.left_at IS NULL)
      ${query.search ? sql`AND strpos(lower(c.name),lower(${query.search})) > 0` : sql``}
      ${query.after ? sql`AND c.id > ${query.after}::uuid` : sql``} ORDER BY c.id LIMIT ${query.limit + 1}`);
    return {data:rows.slice(0,query.limit),nextCursor:rows.length > query.limit ? rows[query.limit-1].id : null};
  }

  async join(actor: CommunicationsActor, id: string) {
    await this.db.transaction(async db => {
      await this.journalLock(db,actor);
      await new CommunicationsAuthorization(db).authenticate(actor);
      const [channel] = await db.query(sql`SELECT id FROM conversations WHERE id=${id} AND tenant_id=${actor.tenantId}
        AND access_mode='MEMBERS' AND conversation_type='CHANNEL' AND archived_at IS NULL FOR UPDATE`);
      if (!channel) throw notFound();
      const [member] = await db.query<{id:string}>(sql`INSERT INTO conversation_members(tenant_id,conversation_id,user_id,role)
        VALUES(${actor.tenantId},${id},${actor.userId},'MEMBER') ON CONFLICT(conversation_id,user_id)
        DO UPDATE SET left_at=NULL,joined_at=now(),role='MEMBER' WHERE conversation_members.left_at IS NOT NULL RETURNING id`);
      if (member) {
        await this.audit(db,actor,id,'COMMUNICATION_CHANNEL_JOINED',member.id);
        await this.event(db,actor,id,'conversation.member_joined',member.id);
      }
    });
    return this.get(actor,id);
  }

  private async requireChannel(db: CommunicationsDatabase, actor: CommunicationsActor, id: string) {
    const access = await new CommunicationsAuthorization(db).requireConversation(actor,id);
    if (!['CHANNEL','PRIVATE_CHANNEL','GROUP_DIRECT'].includes(access.type)) throw communicationError(409,'CHANNEL_REQUIRED','This action requires a channel or group conversation');
    return access;
  }

  async updateChannel(actor: CommunicationsActor, id: string, input: z.infer<typeof UpdateNativeChannelSchema>) {
    await this.locked(actor,id,'manage',async db => {
      await this.requireChannel(db,actor,id);
      await db.query(sql`UPDATE conversations SET name=coalesce(${input.name ?? null},name),
        customer_display_name=coalesce(${input.name ?? null},customer_display_name),
        description=coalesce(${input.description ?? null},description),updated_at=now() WHERE id=${id}`);
      await this.audit(db,actor,id,'COMMUNICATION_CHANNEL_UPDATED');
      await this.event(db,actor,id,'conversation.updated',id);
    });
    return this.get(actor,id);
  }

  async archive(actor: CommunicationsActor, id: string) {
    await this.locked(actor,id,'manage',async db => {
      await this.requireChannel(db,actor,id);
      await db.query(sql`UPDATE conversations SET archived_at=now(),updated_at=now() WHERE id=${id}`);
      await this.audit(db,actor,id,'COMMUNICATION_CHANNEL_ARCHIVED');
      await this.event(db,actor,id,'conversation.updated',id);
    });
    return this.get(actor,id);
  }

  async leave(actor: CommunicationsActor, id: string) {
    return this.locked(actor,id,'view',async db => {
      const access = await this.requireChannel(db,actor,id);
      if (access.role === 'OWNER' && access.type === 'GROUP_DIRECT') {
        const [next] = await db.query<{userId:string}>(sql`SELECT m.user_id AS "userId" FROM conversation_members m JOIN users u ON u.id=m.user_id
          WHERE m.conversation_id=${id} AND m.left_at IS NULL AND m.user_id<>${actor.userId} AND u.account_status='ACTIVE'
          ORDER BY m.joined_at,m.user_id LIMIT 1`);
        if (next) await db.query(sql`UPDATE conversation_members SET role='OWNER' WHERE conversation_id=${id} AND user_id=${next.userId}`);
        else await db.query(sql`UPDATE conversations SET archived_at=now() WHERE id=${id}`);
      } else if (access.role === 'OWNER') throw communicationError(409,'OWNER_REQUIRED','Transfer ownership before leaving this channel');
      const [member] = await db.query<{id:string}>(sql`UPDATE conversation_members SET left_at=now() WHERE conversation_id=${id} AND user_id=${actor.userId} AND left_at IS NULL RETURNING id`);
      await this.audit(db,actor,id,'COMMUNICATION_CHANNEL_LEFT',member.id);
      await this.event(db,actor,id,'conversation.member_left',member.id);
      return {removed:true};
    });
  }

  async transfer(actor: CommunicationsActor, id: string, userId: string) {
    return this.locked(actor,id,'manage',async db => {
      const access = await this.requireChannel(db,actor,id);
      if (access.role !== 'OWNER' || userId === actor.userId) throw communicationError(403,'COMMUNICATIONS_FORBIDDEN','Only the owner can transfer to another member');
      await this.activeUser(db,actor,userId);
      const [next] = await db.query(sql`SELECT id FROM conversation_members WHERE conversation_id=${id} AND user_id=${userId} AND left_at IS NULL AND role IN ('ADMIN','MEMBER')`);
      if (!next) throw communicationError(400,'INVALID_MEMBER','Choose an active channel member');
      await db.query(sql`UPDATE conversation_members SET role=CASE WHEN user_id=${userId} THEN 'OWNER' ELSE 'ADMIN' END WHERE conversation_id=${id} AND user_id IN (${userId},${actor.userId})`);
      await this.audit(db,actor,id,'COMMUNICATION_OWNERSHIP_TRANSFERRED',undefined,{newOwnerUserId:userId});
      await this.event(db,actor,id,'conversation.updated',id);
      return {transferred:true};
    });
  }

  async people(actor: CommunicationsActor, id: string | null, query: z.infer<typeof ChannelDiscoveryQuerySchema>, candidates = false) {
    const queryPeople=async(db:CommunicationsDatabase)=>{
    const capabilities = await new CommunicationsAuthorization(db).authenticate(actor);
    // Every authenticated workspace member may discover eligible colleagues for DMs.
    void capabilities;
    const rows = await db.query<{userId:string;name:string;role?:string}>(sql`SELECT u.id AS "userId",u.name${id && !candidates ? sql`,m.role` : sql``}
      FROM users u ${id && !candidates ? sql`JOIN conversation_members m ON m.user_id=u.id AND m.tenant_id=u.tenant_id AND m.conversation_id=${id} AND m.left_at IS NULL` : sql``}
      WHERE u.tenant_id=${actor.tenantId} AND u.account_status='ACTIVE' AND u.auth_user_id IS NOT NULL
      ${!id ? sql`AND u.id<>${actor.userId}` : sql``}
      ${id && candidates ? sql`AND NOT EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=${id} AND cm.user_id=u.id AND cm.left_at IS NULL)` : sql``}
      ${query.search ? sql`AND strpos(lower(u.name),lower(${query.search})) > 0` : sql``}
      ${query.after ? sql`AND u.id > ${query.after}::uuid` : sql``} ORDER BY u.id LIMIT ${query.limit+1}`);
    return {data:rows.slice(0,query.limit),nextCursor:rows.length > query.limit ? rows[query.limit-1].userId : null};
    };
    return id ? this.locked(actor,id,candidates?'invite':'view',queryPeople) : queryPeople(this.db);
  }

  private async annotate<T extends {id:string}>(db: CommunicationsDatabase, actor: CommunicationsActor, messages: T[]) {
    if (!messages.length) return [];
    const ids = sql.join(messages.map(m=>sql`${m.id}::uuid`),sql`, `);
    const mentions = await db.query<{messageId:string;userId:string;name:string;start:number;end:number}>(sql`SELECT message_id AS "messageId",user_id AS "userId",display_name AS name,start_offset AS start,end_offset AS end FROM communication_mentions WHERE tenant_id=${actor.tenantId} AND message_id IN (${ids}) ORDER BY start_offset`);
    const reactions = await db.query<{messageId:string;emoji:string;count:number;mine:boolean}>(sql`SELECT message_id AS "messageId",emoji,count(*)::int AS count,bool_or(user_id=${actor.userId}) AS mine FROM communication_reactions WHERE tenant_id=${actor.tenantId} AND message_id IN (${ids}) GROUP BY message_id,emoji ORDER BY emoji`);
    return messages.map(message=>({...message,mentions:mentions.filter(m=>m.messageId===message.id).map(({messageId,...m})=>m),reactions:reactions.filter(r=>r.messageId===message.id).map(({messageId,...r})=>r)}));
  }

  private async messageRow(db: CommunicationsDatabase, actor: CommunicationsActor, id: string, messageId: string) {
    const rows = await db.query<{id:string}>(sql`SELECT ${messageFields} FROM conversation_messages m WHERE m.id=${messageId} AND m.conversation_id=${id} AND m.tenant_id=${actor.tenantId} AND m.channel_type='NATIVE'`);
    if (!rows.length) throw notFound();
    return (await this.annotate(db,actor,rows))[0];
  }

  async message(actor: CommunicationsActor, id: string, messageId: string) {
    return this.locked(actor,id,'view',db=>this.messageRow(db,actor,id,messageId));
  }

  async resolveMessages(actor: CommunicationsActor, id: string, ids: string[]) {
    return this.locked(actor,id,'view',async db=>{
      const rows=await db.query<{id:string}>(sql`SELECT ${messageFields} FROM conversation_messages m WHERE m.tenant_id=${actor.tenantId} AND m.conversation_id=${id} AND m.channel_type='NATIVE'
        AND m.id IN (${sql.join(ids.map(messageId=>sql`${messageId}::uuid`),sql`, `)}) ORDER BY m.native_position`);
      return this.annotate(db,actor,rows);
    });
  }

  private async saveMentions(db: CommunicationsDatabase, actor: CommunicationsActor, id: string, messageId: string, body: string, mentions: NonNullable<CreateNativeMessage['mentions']>) {
    let previousEnd = 0;
    for (const mention of [...mentions].sort((a,b)=>a.start-b.start)) {
      const [member] = await db.query<{name:string}>(sql`SELECT u.name FROM users u JOIN conversation_members m ON m.user_id=u.id AND m.tenant_id=u.tenant_id
        WHERE m.conversation_id=${id} AND m.tenant_id=${actor.tenantId} AND m.user_id=${mention.userId} AND m.left_at IS NULL AND u.account_status='ACTIVE'`);
      if (!member || mention.start < previousEnd || mention.end > body.length || body.slice(mention.start,mention.end) !== `@${member.name}`) {
        throw communicationError(400,'INVALID_MENTION','Mentions must reference current channel members');
      }
      previousEnd=mention.end;
      await db.query(sql`INSERT INTO communication_mentions(tenant_id,conversation_id,message_id,user_id,start_offset,end_offset,display_name)
        VALUES(${actor.tenantId},${id},${messageId},${mention.userId},${mention.start},${mention.end},${member.name})`);
    }
  }

  async editMessage(actor: CommunicationsActor, id: string, messageId: string, input: z.infer<typeof UpdateNativeMessageSchema> | null) {
    return this.locked(actor,id,'post',async db => {
      const [message] = await db.query<{senderId:string;deletedAt:Date|null;updatedAt:Date}>(sql`SELECT sender_user_id AS "senderId",deleted_at AS "deletedAt",updated_at AS "updatedAt" FROM conversation_messages WHERE id=${messageId} AND conversation_id=${id} AND tenant_id=${actor.tenantId} AND channel_type='NATIVE'`);
      if (!message) throw notFound();
      if (message.senderId !== actor.userId) throw communicationError(403,'COMMUNICATIONS_FORBIDDEN','You can only change your own messages');
      if (message.deletedAt) throw communicationError(409,'MESSAGE_DELETED','This message was deleted');
      if (input?.expectedUpdatedAt && new Date(message.updatedAt).toISOString() !== input.expectedUpdatedAt) throw communicationError(409,'MESSAGE_CHANGED','This message changed. Reopen it before editing');
      await db.query(sql`DELETE FROM communication_mentions WHERE message_id=${messageId}`);
      if (!input) await db.query(sql`DELETE FROM communication_reactions WHERE message_id=${messageId}`);
      await db.query(sql`UPDATE conversation_messages SET body=${input?.body ?? ''},updated_at=now(),
        edited_at=${input ? sql`now()` : sql`edited_at`},deleted_at=${input ? sql`NULL` : sql`now()`} WHERE id=${messageId}`);
      if (input) await this.saveMentions(db,actor,id,messageId,input.body,input.mentions ?? []);
      await this.audit(db,actor,id,input ? 'COMMUNICATION_MESSAGE_EDITED' : 'COMMUNICATION_MESSAGE_DELETED',undefined,{messageId});
      await this.event(db,actor,id,input ? 'message.updated' : 'message.deleted',messageId);
      return this.messageRow(db,actor,id,messageId);
    });
  }

  async reaction(actor: CommunicationsActor, id: string, messageId: string, input: z.infer<typeof SetNativeReactionSchema>) {
    return this.locked(actor,id,'post',async db => {
      const [message] = await db.query(sql`SELECT id FROM conversation_messages WHERE id=${messageId} AND conversation_id=${id} AND tenant_id=${actor.tenantId} AND channel_type='NATIVE' AND deleted_at IS NULL`);
      if (!message) throw notFound();
      const changed = input.active
        ? await db.query(sql`INSERT INTO communication_reactions(tenant_id,conversation_id,message_id,user_id,emoji) VALUES(${actor.tenantId},${id},${messageId},${actor.userId},${input.emoji}) ON CONFLICT DO NOTHING RETURNING message_id`)
        : await db.query(sql`DELETE FROM communication_reactions WHERE message_id=${messageId} AND user_id=${actor.userId} AND emoji=${input.emoji} RETURNING message_id`);
      if (changed.length) await this.event(db,actor,id,'message.reaction',messageId);
      return this.messageRow(db,actor,id,messageId);
    });
  }

  private async locked<T>(actor: CommunicationsActor, id: string, action: 'view' | 'post' | 'manage' | 'invite' | 'remove', work: (db: CommunicationsDatabase) => Promise<T>) {
    return this.db.transaction(async db => {
      // Serialize journal commits within the tenant so workspace replay cannot skip a late commit.
      await this.journalLock(db, actor);
      // All membership/message/cursor/event mutations serialize per conversation.
      // Sequence cursors therefore have commit order within their conversation.
      await db.query(sql`SELECT id FROM conversations WHERE id=${id} AND tenant_id=${actor.tenantId} AND access_mode='MEMBERS' FOR UPDATE`);
      await new CommunicationsAuthorization(db).requireConversation(actor, id, action);
      return work(db);
    });
  }

  private async event(db: CommunicationsDatabase, actor: CommunicationsActor, id: string, type: CommunicationsEvent['type'], resourceId: string) {
    await db.query(sql`INSERT INTO communication_events(tenant_id,conversation_id,type,resource_id)
      VALUES (${actor.tenantId},${id},${type},${resourceId})`);
  }

  private async audit(db: CommunicationsDatabase, actor: CommunicationsActor, id: string, action: string, memberId?: string, details: { messageId?: string; newOwnerUserId?: string } = {}) {
    await db.query(sql`INSERT INTO account_access_audit_events(auth_user_id,tenant_id,tenant_user_id,application_context,action,outcome,metadata)
      VALUES (${actor.authUserId},${actor.tenantId},${actor.userId},'TENANT',${action},'SUCCESS',
        ${JSON.stringify({ conversationId: id, ...(memberId ? { memberId } : {}), ...details })}::jsonb)`);
  }

  private async activeUser(db: CommunicationsDatabase, actor: CommunicationsActor, userId: string) {
    const [user] = await db.query<{ id: string; name: string }>(sql`SELECT id,name FROM users
      WHERE id=${userId} AND tenant_id=${actor.tenantId} AND account_status='ACTIVE' AND auth_user_id IS NOT NULL`);
    if (!user) throw communicationError(400, 'INVALID_MEMBER', 'An active workspace member is required');
    return user;
  }

  async create(actor: CommunicationsActor, input: CreateNativeConversation) {
    const members = [...new Set([actor.userId, ...input.memberUserIds])];
    if (input.type === 'DIRECT' && members.length !== 2) throw communicationError(400, 'DIRECT_REQUIRES_TWO', 'Direct conversations require two participants');
    if (input.type === 'GROUP_DIRECT' && members.length < 3) throw communicationError(400, 'GROUP_REQUIRES_THREE', 'Group direct conversations require at least three participants');
    if (!['DIRECT','GROUP_DIRECT'].includes(input.type) && !input.name.trim()) throw communicationError(400,'NAME_REQUIRED','A conversation name is required');
    const name=input.name.trim() || 'Group conversation';
    const directKey=input.type==='DIRECT' ? [...members].sort().join(':') : null;
    let id = randomUUID();
    try {
      await this.db.transaction(async db => {
        await this.journalLock(db, actor);
        const capabilities = await new CommunicationsAuthorization(db).authenticate(actor);
        if (['CHANNEL','PRIVATE_CHANNEL'].includes(input.type) && !capabilities.canCreateChannels) throw communicationError(403, 'COMMUNICATIONS_FORBIDDEN', 'Only workspace owners can create channels');
        for (const userId of members) await this.activeUser(db, actor, userId);
        if (directKey) {
          const [existing]=await db.query<{id:string}>(sql`SELECT id FROM conversations WHERE tenant_id=${actor.tenantId} AND direct_key=${directKey}`);
          if (existing) { id=existing.id; return; }
        }
        await db.query(sql`INSERT INTO conversations(id,tenant_id,primary_channel,customer_display_name,access_mode,conversation_type,name,slug,description,created_by_user_id,direct_key)
          VALUES (${id},${actor.tenantId},'NATIVE',${name},'MEMBERS',${input.type},${name},${input.slug ?? (['CHANNEL','PRIVATE_CHANNEL'].includes(input.type) ? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,100) || id : null)},${input.description ?? null},${actor.userId},${directKey})`);
        for (const userId of members) {
          await db.query(sql`INSERT INTO conversation_members(tenant_id,conversation_id,user_id,role)
            VALUES (${actor.tenantId},${id},${userId},${userId === actor.userId ? 'OWNER' : 'MEMBER'})`);
        }
        await this.audit(db, actor, id, 'COMMUNICATION_CONVERSATION_CREATED');
        await this.event(db, actor, id, 'conversation.created', id);
      });
    } catch (error) {
      const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : error;
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '23505') {
        throw communicationError(409, 'CONVERSATION_CONFLICT', 'A conversation with this slug already exists');
      }
      throw error;
    }
    return this.get(actor, id);
  }

  async list(actor: CommunicationsActor, query: NativeConversationQuery) {
    await new CommunicationsAuthorization(this.db).authenticate(actor);
    let before: {at:string;id:string} | undefined;
    if(query.after && query.recent) {
      try { before=z.object({at:z.string().datetime(),id:z.string().uuid()}).strict().parse(JSON.parse(Buffer.from(query.after,'base64url').toString())); }
      catch { throw communicationError(400,'INVALID_CURSOR','Conversation cursor is invalid'); }
    } else if(query.after) z.string().uuid().parse(query.after);
    const rows = await this.db.query<{ id:string;lastActivityAt:Date }>(sql`SELECT ${conversationFields},${this.unreadFields(actor)}
      FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id AND m.tenant_id=c.tenant_id
      WHERE c.tenant_id=${actor.tenantId} AND c.access_mode='MEMBERS' AND c.archived_at IS NULL
        AND m.user_id=${actor.userId} AND m.left_at IS NULL
        ${query.channelsOnly ? sql`AND c.conversation_type IN ('CHANNEL','PRIVATE_CHANNEL')` : sql``}
        ${query.search ? sql`AND (strpos(lower(c.name),lower(${query.search})) > 0 OR (c.conversation_type='DIRECT' AND EXISTS(
          SELECT 1 FROM conversation_members peer JOIN users u ON u.id=peer.user_id WHERE peer.conversation_id=c.id AND peer.user_id<>${actor.userId}
          AND peer.left_at IS NULL AND strpos(lower(u.name),lower(${query.search}))>0)))` : sql``}
        ${before ? sql`AND (c.last_message_at,c.id)<(${before.at}::timestamptz,${before.id}::uuid)` : query.after ? sql`AND c.id>${query.after}::uuid` : sql``}
      ORDER BY ${query.recent ? sql`c.last_message_at DESC,c.id DESC` : sql`c.id`} LIMIT ${query.limit + 1}`);
    const data=rows.slice(0,query.limit),last=data.at(-1);
    return {data,nextCursor:rows.length>query.limit && last ? query.recent ? Buffer.from(JSON.stringify({at:new Date(last.lastActivityAt).toISOString(),id:last.id})).toString('base64url') : last.id : null};
  }

  async liveScope(actor: CommunicationsActor, id: string | null, userIds: string[]) {
    return this.subscription(actor,id,async db=>{
      const readers=id ? await db.query<{userId:string;name:string;position:string}>(sql`SELECT m.user_id AS "userId",u.name,m.last_read_position::text AS position
        FROM conversation_members m JOIN users u ON u.id=m.user_id AND u.tenant_id=m.tenant_id
        JOIN conversations c ON c.id=m.conversation_id WHERE m.conversation_id=${id} AND m.left_at IS NULL AND u.account_status='ACTIVE'
        AND c.conversation_type IN ('DIRECT','GROUP_DIRECT') ORDER BY m.user_id LIMIT 101`) : [];
      const wanted=[...new Set([...userIds,...readers.map(m=>m.userId)])].slice(0,201);
      const visible=wanted.length ? await db.query<{userId:string}>(sql`SELECT u.id AS "userId" FROM users u WHERE u.tenant_id=${actor.tenantId} AND u.account_status='ACTIVE'
        AND u.id IN (${sql.join(wanted.map(userId=>sql`${userId}::uuid`),sql`, `)})
        AND EXISTS(SELECT 1 FROM conversation_members mine JOIN conversation_members peer ON peer.conversation_id=mine.conversation_id AND peer.tenant_id=mine.tenant_id
          JOIN conversations c ON c.id=mine.conversation_id WHERE mine.tenant_id=${actor.tenantId} AND mine.user_id=${actor.userId} AND mine.left_at IS NULL
          AND peer.user_id=u.id AND peer.left_at IS NULL AND c.conversation_type IN ('DIRECT','GROUP_DIRECT')) ORDER BY u.id`) : [];
      return {readers,visible};
    });
  }

  async authorizeTyping(actor: CommunicationsActor,id:string) {
    return this.locked(actor,id,'post',async db=>{
      const access=await new CommunicationsAuthorization(db).requireConversation(actor,id,'post');
      if(!['DIRECT','GROUP_DIRECT'].includes(access.type)) throw communicationError(400,'DIRECT_REQUIRED','Typing is available in direct and group conversations');
    });
  }

  async get(actor: CommunicationsActor, id: string) {
    return this.locked(actor, id, 'view', async db => {
      const [row] = await db.query(sql`SELECT ${conversationFields},
        (SELECT count(*)::int FROM conversation_messages msg WHERE msg.conversation_id=c.id
          AND msg.native_position > m.last_read_position AND msg.deleted_at IS NULL AND msg.sender_user_id IS DISTINCT FROM ${actor.userId}::uuid) AS "unreadCount"
        FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id AND m.tenant_id=c.tenant_id
        WHERE c.id=${id} AND c.tenant_id=${actor.tenantId} AND m.user_id=${actor.userId} AND m.left_at IS NULL`);
      return row;
    });
  }

  async addMember(actor: CommunicationsActor, id: string, input: AddConversationMember) {
    return this.locked(actor, id, 'invite', async db => {
      const access = await new CommunicationsAuthorization(db).requireConversation(actor, id, 'invite');
      if (input.role === 'ADMIN' && access.role !== 'OWNER') throw communicationError(403, 'COMMUNICATIONS_FORBIDDEN', 'Only the owner can appoint administrators');
      const [size]=await db.query<{count:number}>(sql`SELECT count(*)::int AS count FROM conversation_members WHERE conversation_id=${id} AND left_at IS NULL`);
      if(size.count>=101) throw communicationError(409,'MEMBER_LIMIT','A conversation supports up to 101 participants');
      if(access.type==='GROUP_DIRECT' && !['ADMIN','MEMBER'].includes(input.role)) throw communicationError(400,'INVALID_MEMBER','Choose an internal participant role');
      await this.activeUser(db, actor, input.userId);
      const [existing] = await db.query(sql`SELECT id FROM conversation_members WHERE conversation_id=${id} AND user_id=${input.userId} AND left_at IS NULL`);
      if (existing) throw communicationError(409, 'ALREADY_MEMBER', 'Participant is already a member');
      const [member] = await db.query<{ id: string }>(sql`INSERT INTO conversation_members(tenant_id,conversation_id,user_id,role)
        VALUES (${actor.tenantId},${id},${input.userId},${input.role})
        ON CONFLICT (conversation_id,user_id) DO UPDATE SET left_at=NULL,joined_at=now(),role=excluded.role
        RETURNING id,user_id AS "userId",role,joined_at AS "joinedAt"`);
      await this.audit(db, actor, id, 'COMMUNICATION_MEMBER_ADDED', member.id);
      await this.event(db, actor, id, 'conversation.member_joined', member.id);
      return member;
    });
  }

  async removeMember(actor: CommunicationsActor, id: string, userId: string) {
    return this.locked(actor, id, 'remove', async db => {
      const access = await new CommunicationsAuthorization(db).requireConversation(actor, id, 'remove');
      const [member] = await db.query<{ id: string; role: string }>(sql`SELECT id,role FROM conversation_members
        WHERE tenant_id=${actor.tenantId} AND conversation_id=${id} AND user_id=${userId} AND left_at IS NULL`);
      if (!member) throw notFound();
      if (member.role === 'OWNER' || (member.role === 'ADMIN' && access.role !== 'OWNER')) {
        throw communicationError(403, 'COMMUNICATIONS_FORBIDDEN', 'This participant cannot be removed');
      }
      await db.query(sql`UPDATE conversation_members SET left_at=now() WHERE id=${member.id}`);
      await this.audit(db, actor, id, 'COMMUNICATION_MEMBER_REMOVED', member.id);
      await this.event(db, actor, id, 'conversation.member_left', member.id);
      return { removed: true };
    });
  }

  async messages(actor: CommunicationsActor, id: string, query: NativeMessageQuery) {
    return this.locked(actor, id, 'view', async db => {
      if (query.parentMessageId) await this.rootMessage(db, actor, id, query.parentMessageId);
      const rows = await db.query<{ id: string; position: string }>(sql`SELECT ${messageFields} FROM conversation_messages m
        WHERE m.tenant_id=${actor.tenantId} AND m.conversation_id=${id} AND m.channel_type='NATIVE' AND m.native_position IS NOT NULL
          AND ${query.parentMessageId ? sql`m.reply_to_message_id=${query.parentMessageId}` : sql`m.reply_to_message_id IS NULL`}
          ${query.before ? sql`AND m.native_position < ${query.before}::bigint` : sql``}
        ORDER BY m.native_position DESC LIMIT ${query.limit + 1}`);
      const data = rows.slice(0, query.limit);
      return { data: await this.annotate(db, actor, data), nextCursor: rows.length > query.limit ? data.at(-1)!.position : null };
    });
  }

  private async rootMessage(db: CommunicationsDatabase, actor: CommunicationsActor, id: string, messageId: string) {
    const [parent] = await db.query(sql`SELECT id FROM conversation_messages WHERE id=${messageId}
      AND tenant_id=${actor.tenantId} AND conversation_id=${id} AND channel_type='NATIVE' AND reply_to_message_id IS NULL`);
    if (!parent) throw communicationError(400, 'INVALID_THREAD_ROOT', 'Thread root must belong to this conversation');
  }

  async post(actor: CommunicationsActor, id: string, input: CreateNativeMessage) {
    return this.locked(actor, id, 'post', async db => {
      if (input.clientMessageId) {
        const [previous] = await db.query<{id:string;body:string;parentMessageId:string|null}>(sql`SELECT id,body,reply_to_message_id AS "parentMessageId" FROM conversation_messages WHERE conversation_id=${id} AND sender_user_id=${actor.userId} AND client_message_id=${input.clientMessageId}`);
        if (previous) {
          if (previous.body !== input.body || previous.parentMessageId !== (input.parentMessageId ?? null)) throw communicationError(409,'RETRY_CONFLICT','This retry belongs to a different message');
          return this.messageRow(db,actor,id,previous.id);
        }
      }
      if (input.parentMessageId) await this.rootMessage(db, actor, id, input.parentMessageId);
      const sender = await this.activeUser(db, actor, actor.userId);
      const messageId = randomUUID();
      await db.query(sql`INSERT INTO conversation_messages(id,tenant_id,conversation_id,channel_type,direction,sender_type,sender_user_id,sender_name,body,status,reply_to_message_id,native_position,client_message_id)
        VALUES (${messageId},${actor.tenantId},${id},'NATIVE','INTERNAL','STAFF',${actor.userId},${sender.name},${input.body},'SENT',${input.parentMessageId ?? null},nextval('native_message_position_seq'),${input.clientMessageId ?? null})`);
      await this.saveMentions(db,actor,id,messageId,input.body,input.mentions ?? []);
      await db.query(sql`UPDATE conversations SET updated_at=now(),last_message_at=now() WHERE id=${id} AND tenant_id=${actor.tenantId}`);
      await this.event(db, actor, id, 'message.created', messageId);
      return this.messageRow(db,actor,id,messageId);
    });
  }

  async read(actor: CommunicationsActor, id: string, messageId: string) {
    return this.locked(actor, id, 'view', async db => {
      const [message] = await db.query<{ position: string }>(sql`SELECT native_position::text AS position FROM conversation_messages
        WHERE id=${messageId} AND conversation_id=${id} AND tenant_id=${actor.tenantId} AND channel_type='NATIVE'`);
      if (!message) throw notFound();
      const changed = await db.query(sql`UPDATE conversation_members SET last_read_position=${message.position}::bigint,last_read_at=now()
        WHERE conversation_id=${id} AND user_id=${actor.userId} AND tenant_id=${actor.tenantId} AND left_at IS NULL
        AND last_read_position < ${message.position}::bigint RETURNING id`);
      if (changed.length) await this.event(db, actor, id, 'conversation.read', actor.userId);
      const [cursor] = await db.query(sql`SELECT last_read_position::text AS "lastReadPosition",last_read_at AS "lastReadAt"
        FROM conversation_members WHERE conversation_id=${id} AND user_id=${actor.userId}`);
      return cursor;
    });
  }


  private async subscription<T>(actor: CommunicationsActor, id: string | null, work: (db:CommunicationsDatabase)=>Promise<T>) {
    if (id) return this.locked(actor,id,'view',work);
    return this.db.transaction(async db=>{
      await this.journalLock(db,actor);
      await new CommunicationsAuthorization(db).authenticate(actor);
      return work(db);
    });
  }

  async events(actor: CommunicationsActor, id: string | null, after: string) {
    return this.subscription(actor,id,async db=>{
      const events = await db.query<{occurredAt:Date}>(sql`SELECT e.id::text,e.tenant_id AS "tenantId",e.conversation_id AS "conversationId",e.type,e.resource_id AS "resourceId",e.occurred_at AS "occurredAt"
        FROM communication_events e WHERE e.tenant_id=${actor.tenantId} AND e.id > ${after}::bigint
        AND ${id ? sql`e.conversation_id=${id}` : sql`EXISTS(SELECT 1 FROM conversation_members m WHERE m.conversation_id=e.conversation_id AND m.tenant_id=e.tenant_id AND m.user_id=${actor.userId}
          AND (m.left_at IS NULL OR (e.type='conversation.member_left' AND e.resource_id=m.id)))`}
        ORDER BY e.id LIMIT 100`);
      return events.map(event=>CommunicationsEventSchema.parse({...event,version:1,occurredAt:new Date(event.occurredAt).toISOString()}));
    });
  }

  async ticket(actor: CommunicationsActor, id: string | null) {
    return this.subscription(actor,id,async db=>{
      const token=randomBytes(32).toString('hex');
      await db.query(sql`DELETE FROM communication_tickets WHERE expires_at <= now()`);
      await db.query(sql`INSERT INTO communication_tickets(token_hash,tenant_id,conversation_id,actor,expires_at)
        VALUES(${createHash('sha256').update(token).digest('hex')},${actor.tenantId},${id},${JSON.stringify(actor)}::jsonb,now()+interval '30 seconds')`);
      const [cursor]=await db.query<{cursor:string}>(sql`SELECT coalesce(max(id),0)::text AS cursor FROM communication_events WHERE tenant_id=${actor.tenantId}`);
      return {ticket:token,expiresInSeconds:30,cursor:cursor.cursor};
    });
  }

  async consumeTicket(id: string | null, token: string) {
    const [ticket]=await this.db.query<{actor:unknown}>(sql`DELETE FROM communication_tickets
      WHERE token_hash=${createHash('sha256').update(token).digest('hex')} AND conversation_id IS NOT DISTINCT FROM ${id}::uuid AND expires_at > now() RETURNING actor`);
    if (!ticket) throw communicationError(401,'INVALID_REALTIME_TICKET','Realtime ticket is invalid or expired');
    const actor=CommunicationsActorSchema.parse(ticket.actor);
    await this.subscription(actor,id,async()=>undefined);
    return actor;
  }
}
