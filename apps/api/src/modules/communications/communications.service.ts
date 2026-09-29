import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { sql } from '@ks-os/database';
import {
  CommunicationsEventSchema, type CommunicationsEvent, type CreateNativeConversation,
  type CreateNativeMessage, type NativeMessageQuery, type NativeConversationQuery, type AddConversationMember,
} from '@ks-os/contracts';
import {
  CommunicationsActorSchema, CommunicationsAuthorization, communicationError, notFound, type CommunicationsActor,
} from './communications.authorization.js';
import { communicationsDatabase, type CommunicationsDatabase } from './communications.database.js';

const conversationFields = sql`c.id,c.conversation_type AS type,c.name,c.slug,c.description,
  c.created_by_user_id AS "createdBy",c.created_at AS "createdAt",c.updated_at AS "updatedAt",c.archived_at AS "archivedAt",
  m.role AS "memberRole",m.last_read_position::text AS "lastReadPosition",m.last_read_at AS "lastReadAt"`;
const messageFields = sql`m.id,m.conversation_id AS "conversationId",m.sender_user_id AS "senderId",
  CASE WHEN m.deleted_at IS NULL THEN m.body ELSE NULL END AS body,m.message_type AS type,
  m.reply_to_message_id AS "parentMessageId",m.native_position::text AS position,
  m.created_at AS "createdAt",m.updated_at AS "updatedAt",m.edited_at AS "editedAt",m.deleted_at AS "deletedAt",
  (SELECT count(*)::int FROM conversation_messages r WHERE r.conversation_id=m.conversation_id AND r.reply_to_message_id=m.id AND r.native_position IS NOT NULL) AS "replyCount"`;

export class CommunicationsService {
  constructor(private db: CommunicationsDatabase = communicationsDatabase()) {}

  private async locked<T>(actor: CommunicationsActor, id: string, action: 'view' | 'post' | 'invite' | 'remove', work: (db: CommunicationsDatabase) => Promise<T>) {
    return this.db.transaction(async db => {
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

  private async audit(db: CommunicationsDatabase, actor: CommunicationsActor, id: string, action: string, memberId?: string) {
    await db.query(sql`INSERT INTO account_access_audit_events(auth_user_id,tenant_id,tenant_user_id,application_context,action,outcome,metadata)
      VALUES (${actor.authUserId},${actor.tenantId},${actor.userId},'TENANT',${action},'SUCCESS',
        ${JSON.stringify({ conversationId: id, ...(memberId ? { memberId } : {}) })}::jsonb)`);
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
    const id = randomUUID();
    try {
      await this.db.transaction(async db => {
        await new CommunicationsAuthorization(db).authenticate(actor);
        for (const userId of members) await this.activeUser(db, actor, userId);
        await db.query(sql`INSERT INTO conversations(id,tenant_id,primary_channel,customer_display_name,access_mode,conversation_type,name,slug,description,created_by_user_id)
          VALUES (${id},${actor.tenantId},'NATIVE',${input.name},'MEMBERS',${input.type},${input.name},${input.slug ?? null},${input.description ?? null},${actor.userId})`);
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
    const rows = await this.db.query<{ id: string }>(sql`SELECT ${conversationFields}
      FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id AND m.tenant_id=c.tenant_id
      WHERE c.tenant_id=${actor.tenantId} AND c.access_mode='MEMBERS' AND c.archived_at IS NULL
        AND m.user_id=${actor.userId} AND m.left_at IS NULL ${query.after ? sql`AND c.id > ${query.after}::uuid` : sql``}
      ORDER BY c.id LIMIT ${query.limit + 1}`);
    const data = rows.slice(0, query.limit);
    return { data, nextCursor: rows.length > query.limit ? data.at(-1)!.id : null };
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
      return { data, nextCursor: rows.length > query.limit ? data.at(-1)!.position : null };
    });
  }

  private async rootMessage(db: CommunicationsDatabase, actor: CommunicationsActor, id: string, messageId: string) {
    const [parent] = await db.query(sql`SELECT id FROM conversation_messages WHERE id=${messageId}
      AND tenant_id=${actor.tenantId} AND conversation_id=${id} AND channel_type='NATIVE' AND reply_to_message_id IS NULL`);
    if (!parent) throw communicationError(400, 'INVALID_THREAD_ROOT', 'Thread root must belong to this conversation');
  }

  async post(actor: CommunicationsActor, id: string, input: CreateNativeMessage) {
    return this.locked(actor, id, 'post', async db => {
      if (input.parentMessageId) await this.rootMessage(db, actor, id, input.parentMessageId);
      const sender = await this.activeUser(db, actor, actor.userId);
      const messageId = randomUUID();
      await db.query(sql`INSERT INTO conversation_messages(id,tenant_id,conversation_id,channel_type,direction,sender_type,sender_user_id,sender_name,body,status,reply_to_message_id,native_position)
        VALUES (${messageId},${actor.tenantId},${id},'NATIVE','INTERNAL','STAFF',${actor.userId},${sender.name},${input.body},'SENT',${input.parentMessageId ?? null},nextval('native_message_position_seq'))`);
      await db.query(sql`UPDATE conversations SET updated_at=now(),last_message_at=now() WHERE id=${id} AND tenant_id=${actor.tenantId}`);
      await this.event(db, actor, id, 'message.created', messageId);
      const [message] = await db.query(sql`SELECT ${messageFields} FROM conversation_messages m WHERE m.id=${messageId}`);
      return message;
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

  async events(actor: CommunicationsActor, id: string, after: string) {
    return this.locked(actor, id, 'view', async db => {
      const events = await db.query<{ occurredAt: Date }>(sql`SELECT id::text,tenant_id AS "tenantId",conversation_id AS "conversationId",type,resource_id AS "resourceId",occurred_at AS "occurredAt"
        FROM communication_events WHERE tenant_id=${actor.tenantId} AND conversation_id=${id} AND id > ${after}::bigint ORDER BY communication_events.id LIMIT 100`);
      return events.map(event => CommunicationsEventSchema.parse({ ...event, version: 1, occurredAt: new Date(event.occurredAt).toISOString() }));
    });
  }

  async ticket(actor: CommunicationsActor, id: string) {
    return this.locked(actor, id, 'view', async db => {
      const token = randomBytes(32).toString('hex');
      await db.query(sql`DELETE FROM communication_tickets WHERE expires_at <= now()`);
      await db.query(sql`INSERT INTO communication_tickets(token_hash,tenant_id,conversation_id,actor,expires_at)
        VALUES (${createHash('sha256').update(token).digest('hex')},${actor.tenantId},${id},${JSON.stringify(actor)}::jsonb,now()+interval '30 seconds')`);
      return { ticket: token, expiresInSeconds: 30 };
    });
  }

  async consumeTicket(id: string, token: string) {
    // Consume before authorization: even rejected attempts cannot replay a ticket.
    const [ticket] = await this.db.query<{ actor: unknown }>(sql`DELETE FROM communication_tickets
      WHERE token_hash=${createHash('sha256').update(token).digest('hex')} AND conversation_id=${id} AND expires_at > now() RETURNING actor`);
    if (!ticket) throw communicationError(401, 'INVALID_REALTIME_TICKET', 'Realtime ticket is invalid or expired');
    const actor = CommunicationsActorSchema.parse(ticket.actor);
    await new CommunicationsAuthorization(this.db).requireConversation(actor, id);
    return actor;
  }
}
