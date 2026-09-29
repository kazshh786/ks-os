import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { sql, type SQL } from '@ks-os/database';
import { NativeConversationSchema, NativeMessageSchema } from '@ks-os/contracts';
import { CommunicationsService } from '../src/modules/communications/communications.service.js';
import { communicationsRoutes } from '../src/modules/communications/communications.routes.js';
import type { CommunicationsDatabase } from '../src/modules/communications/communications.database.js';
import type { CommunicationsActor } from '../src/modules/communications/communications.authorization.js';

test('communications foundation: real PostgreSQL migration, services, HTTP and WebSocket isolation', { timeout: 120000 }, async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE tenants(id uuid PRIMARY KEY,is_active boolean DEFAULT true,lifecycle_status text DEFAULT 'ACTIVE');
    CREATE TABLE users(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants,auth_user_id uuid,name text,account_status text DEFAULT 'ACTIVE',sessions_valid_after timestamptz,security_version integer DEFAULT 1);
    CREATE TABLE clients(id uuid PRIMARY KEY); CREATE TABLE appointments(id uuid PRIMARY KEY);
    CREATE TABLE customer_client_links(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants);
    CREATE TABLE integration_connections(id uuid PRIMARY KEY,kind text);
    CREATE TABLE application_sessions(auth_session_id uuid,auth_user_id uuid,application_context text,selected_tenant_user_id uuid,security_version integer,revoked_at timestamptz,expires_at timestamptz);
    CREATE TABLE account_access_audit_events(id uuid DEFAULT gen_random_uuid(),auth_user_id uuid,tenant_id uuid,tenant_user_id uuid,application_context text,action text,outcome text,metadata jsonb);
  `);
  await pg.exec(readFileSync(new URL('../../../packages/database/migrations/20260730223000_omnichannel_conversations.sql', import.meta.url), 'utf8'));
  // Prove the additive migration keeps existing inbox rows and messages intact.
  const legacyTenant = randomUUID(), legacyConversation = randomUUID();
  await pg.query('INSERT INTO tenants(id) VALUES ($1)', [legacyTenant]);
  await pg.query("INSERT INTO conversations(id,tenant_id,primary_channel,customer_display_name) VALUES ($1,$2,'EMAIL','Existing customer')", [legacyConversation, legacyTenant]);
  await pg.exec(readFileSync(new URL('../../../packages/database/migrations/20260929120000_communications_foundation.sql', import.meta.url), 'utf8'));
  const dialect = new PgDialect();
  const wrap = (connection: PGlite | Transaction): CommunicationsDatabase => ({
    async query<T extends Record<string, unknown>>(statement: SQL) {
      const query = dialect.sqlToQuery(statement);
      return (await connection.query<T>(query.sql, query.params)).rows;
    },
    transaction: work => connection instanceof PGlite
      ? connection.transaction(tx => work(wrap(tx)))
      : work(wrap(connection)),
  });
  const db = wrap(pg);
  const service = new CommunicationsService(db);
  async function seed(tenantId = randomUUID()): Promise<CommunicationsActor> {
    const current = { tenantId, userId: randomUUID(), authUserId: randomUUID(), sessionId: randomUUID(),
      issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() };
    await pg.query('INSERT INTO tenants(id) VALUES ($1) ON CONFLICT DO NOTHING', [tenantId]);
    await pg.query("INSERT INTO users(id,tenant_id,auth_user_id,name) VALUES ($1,$2,$3,'Test member')", [current.userId, tenantId, current.authUserId]);
    await pg.query("INSERT INTO application_sessions(auth_session_id,auth_user_id,application_context,selected_tenant_user_id,security_version,expires_at) VALUES ($1,$2,'TENANT',$3,1,$4)", [current.sessionId, current.authUserId, current.userId, current.expiresAt]);
    return current;
  }
  const owner = await seed(), member = await seed(owner.tenantId), outsider = await seed(owner.tenantId), other = await seed();
  const app = Fastify();
  await app.register(websocket);
  app.decorateRequest('auth', undefined);
  app.decorateRequest('authIdentity', undefined);
  app.decorateRequest('requireAuth', function () {
    if (!this.auth) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  });
  const actors: Record<string, CommunicationsActor> = { owner, member, outsider, other };
  app.addHook('onRequest', async request => {
    const current = actors[request.headers.authorization?.replace('Bearer ', '') ?? ''];
    if (!current) return;
    request.auth = { tenantId: current.tenantId, tenantUserId: current.userId, authUserId: current.authUserId,
      membershipReference: current.userId, businessReference: current.tenantId, tenantName: 'Test', tenantSubdomain: 'test', email: null, role: 'owner', permissions: [] };
    request.authIdentity = { authUserId: current.authUserId, authSessionId: current.sessionId, email: null, assuranceLevel: 'aal1', issuedAt: current.issuedAt, expiresAt: current.expiresAt };
  });
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    reply.code(error instanceof ZodError ? 400 : error.statusCode ?? 500).send({ error: error.message });
  });
  await app.register(communicationsRoutes, { prefix: '/comms', service });
  await app.ready();
  t.after(() => app.close());
  const headers = (who: string) => ({ authorization: `Bearer ${who}` });
  const created = await app.inject({ method: 'POST', url: '/comms', headers: headers('owner'), payload: { type: 'PRIVATE_CHANNEL', name: 'Private', memberUserIds: [member.userId] } });
  assert.equal(created.statusCode, 201, created.body);
  NativeConversationSchema.parse(created.json().data);
  const id = created.json().data.id as string;
  const path = `/comms/${id}`;

  await t.test('migration preserves legacy inbox and blocks direct Data API access', async () => {
    assert.equal((await pg.query<{ access_mode: string }>('SELECT access_mode FROM conversations WHERE id=$1', [legacyConversation])).rows[0].access_mode, 'INBOX');
    for (const table of ['conversation_members', 'communication_events', 'communication_tickets']) {
      const result = await pg.query<{ relrowsecurity: boolean }>('SELECT relrowsecurity FROM pg_class WHERE relname=$1', [table]);
      assert.equal(result.rows[0].relrowsecurity, true);
      const privileges = await pg.query<{ allowed: boolean }>("SELECT has_table_privilege('authenticated',$1,'SELECT') AS allowed", [table]);
      assert.equal(privileges.rows[0].allowed, false);
    }
  });
  await t.test('authorized member can access; anonymous, cross tenant and non-member cannot', async () => {
    for (const [who, status] of [['member', 200], ['', 401], ['other', 404], ['outsider', 404]] as const) {
      assert.equal((await app.inject({ url: path, headers: headers(who) })).statusCode, status);
    }
    assert.deepEqual((await service.list(other, { limit: 50 })).data, []);
    assert.deepEqual((await service.list(outsider, { limit: 50 })).data, []);
  });
  await t.test('invalid ownership, identity, IDs, types and oversized content are rejected', async () => {
    for (const payload of [{ body: 'Hi', senderId: owner.userId }, { body: 'Hi', tenantId: other.tenantId }, { body: 'x'.repeat(16001) }]) {
      assert.equal((await app.inject({ method: 'POST', url: `${path}/messages`, headers: headers('member'), payload })).statusCode, 400);
    }
    assert.equal((await app.inject({ url: '/comms/not-a-uuid', headers: headers('owner') })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/comms', headers: headers('owner'), payload: { type: 'INVALID', name: 'Bad' } })).statusCode, 400);
  });
  const messageIds: string[] = [];
  await t.test('member posts with server-derived sender; outsiders cannot post', async () => {
    for (let n = 0; n < 4; n++) {
      const response = await app.inject({ method: 'POST', url: `${path}/messages`, headers: headers('member'), payload: { body: `Message ${n}` } });
      assert.equal(response.statusCode, 201, response.body);
      NativeMessageSchema.parse(response.json().data);
      assert.equal(response.json().data.senderId, member.userId);
      messageIds.push(response.json().data.id);
    }
    for (const who of ['outsider', 'other']) assert.equal((await app.inject({ method: 'POST', url: `${path}/messages`, headers: headers(who), payload: { body: 'Denied' } })).statusCode, 404);
  });
  await t.test('stable cursor pagination and threads work with real queries', async () => {
    const first = await service.messages(member, id, { limit: 2 });
    const second = await service.messages(member, id, { limit: 2, before: first.nextCursor! });
    assert.equal(new Set([...first.data, ...second.data].map(row => row.id)).size, 4);
    assert.equal(second.nextCursor, null);
    const reply = await service.post(member, id, { body: 'Reply', parentMessageId: messageIds[0] });
    const thread = await service.messages(member, id, { limit: 50, parentMessageId: messageIds[0] });
    assert.equal(thread.data[0].id, reply.id);
    await assert.rejects(service.post(member, id, { body: 'Nested', parentMessageId: String(reply.id) }));
    const foreign = await service.create(other, { type: 'CHANNEL', name: 'Other tenant', memberUserIds: [] });
    const foreignMessage = await service.post(other, String(foreign.id), { body: 'Secret' });
    await assert.rejects(service.post(member, id, { body: 'Cross thread', parentMessageId: String(foreignMessage.id) }));
  });
  await t.test('read state advances monotonically and rejects foreign messages', async () => {
    const latest = await service.read(member, id, messageIds[3]);
    const older = await service.read(member, id, messageIds[0]);
    assert.equal(older.lastReadPosition, latest.lastReadPosition);
    const response = await app.inject({ method: 'POST', url: `${path}/read`, headers: headers('owner'), payload: { messageId: messageIds[3] } });
    assert.equal(response.statusCode, 200);
    await assert.rejects(service.read(member, id, randomUUID()));
  });
  await t.test('membership changes enforce roles and tenant scope', async () => {
    await assert.rejects(service.addMember(member, id, { userId: outsider.userId, role: 'MEMBER' }));
    await assert.rejects(service.addMember(owner, id, { userId: other.userId, role: 'MEMBER' }));
    await assert.rejects(service.removeMember(owner, id, owner.userId));
    await service.addMember(owner, id, { userId: outsider.userId, role: 'MEMBER' });
    assert.ok(await service.get(outsider, id));
    await service.removeMember(owner, id, outsider.userId);
    await assert.rejects(service.get(outsider, id));
  });
  await t.test('database independently rejects cross-tenant members and cross-conversation parents', async () => {
    await assert.rejects(pg.query("INSERT INTO conversation_members(tenant_id,conversation_id,user_id,role) VALUES ($1,$2,$3,'MEMBER')", [owner.tenantId, id, other.userId]), /COMMUNICATION_SCOPE_INVALID/);
    await assert.rejects(pg.query("INSERT INTO conversation_messages(tenant_id,conversation_id,channel_type,direction,sender_type,sender_name,body,status,native_position) VALUES ($1,$2,'NATIVE','INTERNAL','STAFF','Bad','Bad','SENT',999)", [other.tenantId, id]), /COMMUNICATION_SCOPE_INVALID/);
    const second = await service.create(owner, { type: 'CHANNEL', name: 'Second', memberUserIds: [] });
    await assert.rejects(pg.query("INSERT INTO conversation_messages(tenant_id,conversation_id,channel_type,direction,sender_type,sender_name,body,status,native_position,reply_to_message_id) VALUES ($1,$2,'NATIVE','INTERNAL','STAFF','Bad','Bad','SENT',999,$3)", [owner.tenantId, second.id, messageIds[0]]), /COMMUNICATION_SCOPE_INVALID/);
  });
  await t.test('direct membership is fixed, duplicate slugs conflict, archive denies posting', async () => {
    await assert.rejects(service.create(owner, { type: 'DIRECT', name: 'Invalid direct', memberUserIds: [] }));
    const direct = await service.create(owner, { type: 'DIRECT', name: 'Direct', memberUserIds: [member.userId], slug: 'direct' });
    await assert.rejects(service.addMember(owner, String(direct.id), { userId: outsider.userId, role: 'MEMBER' }));
    await assert.rejects(service.create(owner, { type: 'CHANNEL', name: 'Duplicate', memberUserIds: [], slug: 'direct' }), { statusCode: 409 });
    await pg.query('UPDATE conversations SET archived_at=now() WHERE id=$1', [direct.id]);
    await assert.rejects(service.post(owner, String(direct.id), { body: 'Denied' }), { statusCode: 409 });
    assert.ok(await service.get(owner, String(direct.id)));
  });
  await t.test('a second service instance replays only events after the supplied cursor', async () => {
    const before = await service.events(owner, id, '0');
    const last = before.at(-1)!.id;
    const message = await service.post(owner, id, { body: 'Across processes' });
    const replica = new CommunicationsService(db);
    const replay = await replica.events(member, id, last);
    assert.equal(replay.length, 1);
    assert.equal(replay[0].resourceId, message.id);
    assert.equal(replay[0].type, 'message.created');
  });
  await t.test('an audit failure rolls back the conversation and its events', async () => {
    await pg.exec("CREATE FUNCTION test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER test_audit_failure BEFORE INSERT ON account_access_audit_events FOR EACH ROW EXECUTE FUNCTION test_reject_audit();");
    try {
      await assert.rejects(service.create(owner, { type: 'CHANNEL', name: 'Must roll back', slug: 'rollback', memberUserIds: [] }), /audit unavailable/);
      assert.equal((await pg.query("SELECT id FROM conversations WHERE slug='rollback'")).rows.length, 0);
    } finally { await pg.exec('DROP TRIGGER test_audit_failure ON account_access_audit_events; DROP FUNCTION test_reject_audit();'); }
  });
  await t.test('unauthorized and cross-tenant realtime subscriptions fail before upgrade', async () => {
    for (const who of ['outsider', 'other', '']) {
      const result = await app.inject({ method: 'POST', url: `${path}/realtime-ticket`, headers: headers(who) });
      assert.equal(result.statusCode, who ? 404 : 401);
    }
    await assert.rejects(app.injectWS(`${path}/events?ticket=${'a'.repeat(64)}`));
    const ticket = await service.ticket(member, id);
    await assert.rejects(service.consumeTicket(randomUUID(), ticket.ticket));
    await service.consumeTicket(id, ticket.ticket);
    await assert.rejects(service.consumeTicket(id, ticket.ticket));
  });
  await t.test('authorized WebSocket replays durable events and closes after removal', async () => {
    const ticket = await service.ticket(member, id);
    const received: string[] = [];
    const socket = await app.injectWS(`${path}/events?ticket=${ticket.ticket}`, {}, {
      onOpen: ws => ws.on('message', data => received.push(data.toString())),
    });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(received.some(value => JSON.parse(value).type === 'message.created'));
    assert.ok(received.every(value => JSON.parse(value).tenantId === owner.tenantId));
    await service.removeMember(owner, id, member.userId);
    const closed = once(socket, 'close', { signal: AbortSignal.timeout(5000) });
    const [code] = await closed;
    assert.equal(code, 1008);
    await assert.rejects(service.events(member, id, '0'));
  });
  await t.test('session revocation and account suspension invalidate tickets and event access', async () => {
    const ticket = await service.ticket(owner, id);
    await pg.query('UPDATE application_sessions SET revoked_at=now() WHERE auth_session_id=$1', [owner.sessionId]);
    await assert.rejects(service.consumeTicket(id, ticket.ticket));
    await assert.rejects(service.events(owner, id, '0'));
    await pg.query('UPDATE application_sessions SET revoked_at=NULL WHERE auth_session_id=$1', [owner.sessionId]);
    await pg.query("UPDATE users SET account_status='SUSPENDED' WHERE id=$1", [owner.userId]);
    await assert.rejects(service.events(owner, id, '0'));
    await pg.query("UPDATE users SET account_status='ACTIVE' WHERE id=$1", [owner.userId]);
  });
  await t.test('security audit and realtime journal commit with mutations', async () => {
    const audits = await db.query(sql`SELECT action FROM account_access_audit_events WHERE tenant_id=${owner.tenantId}`);
    assert.ok(audits.some(row => row.action === 'COMMUNICATION_CONVERSATION_CREATED'));
    assert.ok(audits.some(row => row.action === 'COMMUNICATION_MEMBER_REMOVED'));
    const events = await service.events(owner, id, '0');
    assert.ok(events.some(event => event.type === 'conversation.read'));
    assert.ok(events.every(event => !('body' in event)));
  });
});
