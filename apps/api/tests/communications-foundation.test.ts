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

test('communications foundation: real PostgreSQL migration, services, HTTP and WebSocket isolation', { timeout: 300000 }, async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE tenants(id uuid PRIMARY KEY,is_active boolean DEFAULT true,lifecycle_status text DEFAULT 'ACTIVE');
    CREATE TABLE users(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants,auth_user_id uuid,name text,role text DEFAULT 'owner',account_status text DEFAULT 'ACTIVE',sessions_valid_after timestamptz,security_version integer DEFAULT 1);
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
  await pg.exec(readFileSync(new URL('../../../packages/database/migrations/20261011040000_communications_channels.sql', import.meta.url), 'utf8'));
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
    for (const table of ['conversation_members', 'communication_events', 'communication_tickets', 'communication_mentions', 'communication_reactions']) {
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

  await t.test('channel discovery is tenant scoped and staff cannot create channels', async () => {
    await pg.query("UPDATE users SET role='staff' WHERE id=$1", [outsider.userId]);
    assert.equal((await service.capabilities(outsider)).canCreateChannels, false);
    const denied = await app.inject({method:'POST',url:'/comms',headers:headers('outsider'),payload:{type:'CHANNEL',name:'Denied'}});
    assert.equal(denied.statusCode,403,denied.body);
    const publicChannel = await service.create(owner,{type:'CHANNEL',name:'Discovery alpha',memberUserIds:[]});
    const privateChannel = await service.create(owner,{type:'PRIVATE_CHANNEL',name:'Discovery secret',memberUserIds:[]});
    const found = await service.discover(outsider,{search:'Discovery',limit:1});
    assert.deepEqual(found.data.map(c=>c.id),[publicChannel.id]);
    assert.equal(found.nextCursor,null);
    assert.deepEqual((await service.discover(other,{search:'Discovery',limit:50})).data,[]);
    await assert.rejects(service.join(outsider,String(privateChannel.id)),{statusCode:404});
    await assert.rejects(service.join(other,String(publicChannel.id)),{statusCode:404});
    await service.join(outsider,String(publicChannel.id));
    await service.join(outsider,String(publicChannel.id));
    const joined = await service.get(outsider,String(publicChannel.id));
    assert.equal(joined.memberCount,2);
    assert.deepEqual((await service.discover(outsider,{search:'Discovery',limit:50})).data,[]);
    assert.ok((await service.list(outsider,{search:'alpha',channelsOnly:'true',limit:50})).data.some(c=>c.id===publicChannel.id));
    await assert.rejects(service.create(owner,{type:'CHANNEL',name:'Discovery alpha',memberUserIds:[]}),{statusCode:409});
  });
  await t.test('ownership transfer, metadata, leave and archive preserve channel invariants', async () => {
    const channel = await service.create(owner,{type:'CHANNEL',name:'Managed',memberUserIds:[member.userId]});
    const cid=String(channel.id);
    await assert.rejects(service.updateChannel(member,cid,{name:'Denied'}),{statusCode:403});
    await assert.rejects(service.leave(owner,cid),{statusCode:409});
    await assert.rejects(service.transfer(owner,cid,other.userId),{statusCode:400});
    const updated=await service.updateChannel(owner,cid,{name:'Managed renamed',description:'A team space'});
    assert.equal(updated.name,'Managed renamed');
    assert.equal(updated.description,'A team space');
    await service.transfer(owner,cid,member.userId);
    assert.equal((await service.get(member,cid)).memberRole,'OWNER');
    assert.equal((await service.get(owner,cid)).memberRole,'ADMIN');
    await service.leave(owner,cid);
    await assert.rejects(service.get(owner,cid),{statusCode:404});
    const archived=await service.archive(member,cid);
    assert.ok(archived.archivedAt);
    assert.equal((await service.list(member,{search:'Managed renamed',limit:50})).data.length,0);
    await assert.rejects(service.join(outsider,cid),{statusCode:404});
    await assert.rejects(service.post(member,cid,{body:'Read only'}),{statusCode:409});
    assert.ok(await service.messages(member,cid,{limit:50}));
  });
  await t.test('persisted mentions validate membership, ranges and safe text; invalid writes roll back', async () => {
    const channel=await service.create(owner,{type:'PRIVATE_CHANNEL',name:'Mentions',memberUserIds:[member.userId]});
    const cid=String(channel.id),body='Hello @Test member <script>alert(1)</script>',mentions=[{userId:member.userId,start:6,end:18}];
    const posted=NativeMessageSchema.parse(JSON.parse(JSON.stringify(await service.post(owner,cid,{body,mentions,clientMessageId:randomUUID()}))));
    assert.equal(posted.body,body);
    assert.deepEqual(posted.mentions,[{...mentions[0],name:'Test member'}]);
    for(const invalid of [[{...mentions[0],userId:other.userId}],[{...mentions[0],userId:outsider.userId}],[{...mentions[0],start:5}],[mentions[0],mentions[0]]]) {
      await assert.rejects(service.post(owner,cid,{body,mentions:invalid}),{statusCode:400});
    }
    assert.equal((await service.messages(owner,cid,{limit:50})).data.length,1);
    const people=await service.people(member,cid,{search:'Test',limit:50});
    assert.deepEqual(new Set(people.data.map(p=>p.userId)),new Set([owner.userId,member.userId]));
    await assert.rejects(service.people(outsider,cid,{limit:50}),{statusCode:404});
    await assert.rejects(service.people(member,cid,{limit:50},true),{statusCode:403});
    await assert.rejects(pg.query("INSERT INTO communication_mentions(tenant_id,conversation_id,message_id,user_id,start_offset,end_offset,display_name) VALUES ($1,$2,$3,$4,0,1,'Secret')",[owner.tenantId,cid,posted.id,other.userId]),/COMMUNICATION_ANNOTATION_SCOPE_INVALID/);
  });
  await t.test('send retries are idempotent and mutations enforce authorship and edit conflicts', async () => {
    const channel=await service.create(owner,{type:'PRIVATE_CHANNEL',name:'Edit and retry',memberUserIds:[member.userId]});
    const cid=String(channel.id),clientMessageId=randomUUID();
    const first=NativeMessageSchema.parse(JSON.parse(JSON.stringify(await service.post(owner,cid,{body:'Original',clientMessageId}))));
    const retry=await service.post(owner,cid,{body:'Original',clientMessageId});
    assert.equal(retry.id,first.id);
    assert.equal((await service.messages(owner,cid,{limit:50})).data.length,1);
    await assert.rejects(service.post(owner,cid,{body:'Changed retry',clientMessageId}),{statusCode:409});
    await assert.rejects(service.editMessage(member,cid,first.id,{body:'Impersonation'}),{statusCode:403});
    await assert.rejects(service.editMessage(member,cid,first.id,null),{statusCode:403});
    await assert.rejects(service.editMessage(outsider,cid,first.id,{body:'Secret'}),{statusCode:404});
    await assert.rejects(service.editMessage(owner,cid,first.id,{body:'Stale',expectedUpdatedAt:'2000-01-01T00:00:00.000Z'}),{statusCode:409});
    const edited=NativeMessageSchema.parse(JSON.parse(JSON.stringify(await service.editMessage(owner,cid,first.id,{body:'Edited',expectedUpdatedAt:first.updatedAt}))));
    assert.equal(edited.body,'Edited'); assert.ok(edited.editedAt);
    const reply=await service.post(member,cid,{body:'Reply survives',parentMessageId:first.id});
    await service.reaction(member,cid,first.id,{emoji:'👍',active:true});
    const deleted=NativeMessageSchema.parse(JSON.parse(JSON.stringify(await service.editMessage(owner,cid,first.id,null))));
    assert.equal(deleted.body,null); assert.ok(deleted.deletedAt); assert.equal(deleted.replyCount,1);
    assert.deepEqual(deleted.reactions,[]);assert.deepEqual(deleted.mentions,[]);
    assert.equal((await service.messages(member,cid,{parentMessageId:first.id,limit:50})).data[0].id,reply.id);
    await service.post(member,cid,{body:'Another reply',parentMessageId:first.id});
    await assert.rejects(service.editMessage(owner,cid,first.id,{body:'Resurrect'}),{statusCode:409});
    const events=await service.events(member,cid,'0');
    assert.ok(events.some(e=>e.type==='message.updated'));assert.ok(events.some(e=>e.type==='message.deleted'));
    const foreign=await service.resolveMessages(other,String((await service.create(other,{type:'CHANNEL',name:'Resolve isolation',memberUserIds:[]})).id),[first.id]);
    assert.deepEqual(foreign,[]);
  });
  await t.test('reactions are persistent, idempotent, scoped and removed independently', async () => {
    const channel=await service.create(owner,{type:'CHANNEL',name:'Reactions',memberUserIds:[member.userId]});
    const cid=String(channel.id),message=await service.post(owner,cid,{body:'React'});
    await service.reaction(owner,cid,message.id,{emoji:'👍',active:true});
    await service.reaction(owner,cid,message.id,{emoji:'👍',active:true});
    const result=await service.reaction(member,cid,message.id,{emoji:'👍',active:true});
    assert.deepEqual(result.reactions,[{emoji:'👍',count:2,mine:true}]);
    const removed=await service.reaction(owner,cid,message.id,{emoji:'👍',active:false});
    assert.deepEqual(removed.reactions,[{emoji:'👍',count:1,mine:false}]);
    await assert.rejects(service.reaction(outsider,cid,message.id,{emoji:'👍',active:true}),{statusCode:404});
    const invalid=await app.inject({method:'PUT',url:`/comms/${cid}/messages/${message.id}/reactions`,headers:headers('member'),payload:{emoji:'🚫',active:true}});
    assert.equal(invalid.statusCode,400);
    await assert.rejects(pg.query("INSERT INTO communication_reactions(tenant_id,conversation_id,message_id,user_id,emoji) VALUES ($1,$2,$3,$4,'👍')",[owner.tenantId,cid,message.id,other.userId]),/COMMUNICATION_ANNOTATION_SCOPE_INVALID/);
  });
  await t.test('workspace feed filters private channels, replays across channels and revokes removed access', async () => {
    const a=String((await service.create(owner,{type:'PRIVATE_CHANNEL',name:'Feed A',memberUserIds:[member.userId]})).id);
    const b=String((await service.create(owner,{type:'CHANNEL',name:'Feed B',memberUserIds:[member.userId]})).id);
    const secret=String((await service.create(owner,{type:'PRIVATE_CHANNEL',name:'Feed secret',memberUserIds:[]})).id);
    const ticket=await service.ticket(member,null);
    const received: {id:string;type:string;conversationId:string;resourceId:string}[]=[];
    const socket=await app.injectWS(`/comms/events?ticket=${ticket.ticket}&after=${ticket.cursor}`,{}, {onOpen:ws=>ws.on('message',data=>received.push(JSON.parse(data.toString())))});
    const waitFor=async(predicate:()=>boolean)=>{const until=Date.now()+5000;while(!predicate() && Date.now()<until)await new Promise(resolve=>setTimeout(resolve,30));assert.ok(predicate(),'Expected realtime event');};
    const first=await service.post(owner,a,{body:'Across A'});
    const second=await service.post(owner,b,{body:'Across B'});
    await service.post(owner,secret,{body:'Hidden'});
    await waitFor(()=>received.some(e=>e.resourceId===first.id)&&received.some(e=>e.resourceId===second.id));
    assert.ok(received.every(e=>e.conversationId!==secret));
    socket.close();
    const cursor=received.at(-1)!.id;
    const edited=await service.editMessage(owner,b,second.id,{body:'While disconnected'});
    const replay=await service.events(member,null,cursor);
    assert.ok(replay.some(e=>e.resourceId===edited.id && e.type==='message.updated'));
    await service.removeMember(owner,a,member.userId);
    const afterRemoval=await service.events(member,null,ticket.cursor);
    assert.ok(afterRemoval.some(e=>e.conversationId===a && e.type==='conversation.member_left'));
    assert.ok(afterRemoval.every(e=>e.conversationId!==a || e.type==='conversation.member_left'));
    await assert.rejects(service.resolveMessages(member,a,[first.id]),{statusCode:404});
    await assert.rejects(service.consumeTicket(null,ticket.ticket),{statusCode:401});
  });

  await t.test('two browser sessions: real messages, threads, reactions, reconnect, mobile and accessibility', {skip:!process.env.CI,timeout:180000}, async () => {
    const {verifyChatBrowser}=await import('./helpers/communications-browser.mjs');
    await verifyChatBrowser({app,service,owner,member});
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
