import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from '@ks-os/database';
import { CommunicationsService } from '../src/modules/communications/communications.service.js';
import { CommunicationsSync } from '../src/modules/communications/communications.sync.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';
import { ClientCollaboration } from '../src/modules/communications/communications.client-collaboration.js';
import { ClientMeetings } from '../src/modules/communications/communications.client-meetings.js';
import { collaborationInvitationToken } from '../src/modules/communications/communications.collaboration-secrets.js';
import { ClientMeetingTestMedia, clientMeetingEnvironment } from './helpers/client-meetings-media.js';

test('mobile sync reconciles the canonical journal without leaking another principal', { timeout: 300000 }, async t => {
  const f = await createClientMeetingFixture(t), { pg, db, owner, outsider, other } = f;
  const service = new CommunicationsService(db), key = randomBytes(32).toString('hex');
  let now = Date.now();
  const sync = new CommunicationsSync(db, () => key, () => now);
  const channel = await service.create(owner, { type: 'PRIVATE_CHANNEL', name: 'Sync', memberUserIds: [outsider.userId] });
  const id = String(channel.id), snapshot = await sync.page(outsider, { limit: 100 });
  assert.equal(snapshot.mode, 'SNAPSHOT_REQUIRED'); assert.equal(snapshot.changes.length, 0);
  const input = { body: 'Offline operation', clientMessageId: randomUUID() };
  const posted = await service.post(owner, id, input);
  assert.equal((await service.post(owner, id, input)).id, posted.id);
  await service.editMessage(owner, id, posted.id, { body: 'Edited on another device' });
  await service.reaction(outsider, id, posted.id, { emoji: '👍', active: true });
  const privateChannel = await service.create(owner, { type: 'PRIVATE_CHANNEL', name: 'Hidden', memberUserIds: [] });
  await service.post(owner, String(privateChannel.id), { body: 'Hidden content' });
  let cursor = snapshot.cursor;
  const changes: Array<{ type: string; conversationId: string | null; resourceId: string | null; position: string }> = [];
  for (let pages = 0; ; pages++) {
    assert.ok(pages < 30, 'Pagination must progress through invisible rows too');
    const page = await sync.page(outsider, { cursor, limit: 1 }); cursor = page.cursor; changes.push(...page.changes);
    if (!page.hasMore) break;
  }
  assert.ok(changes.some(event => event.type === 'message.created' && event.resourceId === posted.id));
  assert.ok(changes.some(event => event.type === 'message.updated'));
  assert.ok(changes.some(event => event.type.includes('reaction')));
  assert.ok(changes.every(event => event.conversationId === id));
  assert.deepEqual(changes.map(event => event.position), [...changes].sort((a, b) => BigInt(a.position) < BigInt(b.position) ? -1 : 1).map(event => event.position));
  const again = await sync.page(outsider, { cursor: snapshot.cursor, limit: 100 });
  assert.deepEqual(again.changes.map(event => event.id), changes.map(event => (event as { id?: string }).id));
  await assert.rejects(sync.page(owner, { cursor, limit: 100 }), { code: 'SYNC_CONTEXT_MISMATCH' });
  await assert.rejects(sync.page(other, { cursor, limit: 100 }), { code: 'SYNC_CONTEXT_MISMATCH' });
  await assert.rejects(sync.page(outsider, { cursor: cursor.slice(0, -8) + 'modified', limit: 100 }), { code: 'SYNC_RESET_REQUIRED' });
  await service.read(outsider, id, posted.id); await service.read(outsider, id, posted.id);
  const read = await sync.page(outsider, { cursor, limit: 100 });
  assert.equal(read.changes.filter(event => event.type === 'conversation.read').length, 1);
  cursor = read.cursor;
  await service.editMessage(owner, id, posted.id, null);
  assert.ok((await sync.page(outsider, { cursor, limit: 100 })).changes.some(event => event.type === 'message.deleted'));
  await service.removeMember(owner, id, outsider.userId);
  const removed = await sync.page(outsider, { cursor, limit: 100 });
  assert.equal(removed.changes.filter(event => event.action === 'PURGE_CONVERSATION').length, 1);
  assert.ok(removed.changes.every(event => event.action === 'PURGE_CONVERSATION'), 'Removed readers receive only their purge reference');
  await assert.rejects(service.message(outsider, id, posted.id));
  now += 8 * 86400000;
  await assert.rejects(sync.page(owner, { cursor: (await new CommunicationsSync(db, () => key).page(owner, { limit: 100 })).cursor, limit: 100 }), { code: 'SYNC_RESET_REQUIRED' });
  now = Date.now();
  const fresh = await sync.page(owner, { limit: 100 });
  await service.post(owner, id, { body: 'Pruned event' });
  await pg.query('DELETE FROM communication_events WHERE tenant_id=$1 AND type=$2', [owner.tenantId, 'message.created']);
  await assert.rejects(sync.page(owner, { cursor: fresh.cursor, limit: 100 }), { code: 'SYNC_RESET_REQUIRED' });
  await pg.query('UPDATE application_sessions SET revoked_at=now() WHERE auth_session_id=$1', [owner.sessionId]);
  await assert.rejects(sync.page(owner, { limit: 100 }), { code: 'AUTH_REQUIRED' });
});

test('sync resumes across out-of-order sequence allocation on real PostgreSQL', { timeout: 300000, skip: !process.env.CLIENT_MEETINGS_TEST_DATABASE_URL }, async t => {
  const { db, owner } = await createClientMeetingFixture(t, { postgresUrl: process.env.CLIENT_MEETINGS_TEST_DATABASE_URL });
  const service = new CommunicationsService(db), sync = new CommunicationsSync(db, () => randomKey);
  const randomKey = randomBytes(32).toString('hex');
  const channel = await service.create(owner, { type: 'PRIVATE_CHANNEL', name: 'Commit order', memberUserIds: [] });
  const snapshot = await sync.page(owner, { limit: 100 });
  let resume!: () => void, allocated!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; }), ready = new Promise<void>(resolve => { allocated = resolve; });
  const late = db.transaction(async tx => {
    const [row] = await tx.query<{ id: string }>(sql`SELECT nextval(pg_get_serial_sequence('communication_events','id'))::text AS id`);
    allocated(); await gate;
    await tx.query(sql`INSERT INTO communication_events(id,tenant_id,conversation_id,type,resource_id) OVERRIDING SYSTEM VALUE VALUES(${row.id}::bigint,${owner.tenantId},${String(channel.id)},'test.late',${randomUUID()})`);
  });
  await ready;
  try {
    await db.query(sql`INSERT INTO communication_events(tenant_id,conversation_id,type,resource_id) VALUES(${owner.tenantId},${String(channel.id)},'test.early',${randomUUID()})`);
    const early = await sync.page(owner, { cursor: snapshot.cursor, limit: 100 });
    assert.equal(early.changes.at(-1)?.type, 'test.early');
    resume(); await late;
    const next = await sync.page(owner, { cursor: early.cursor, limit: 100 });
    assert.equal(next.changes.at(-1)?.type, 'test.late');
    assert.ok(BigInt(next.changes.at(-1)!.id) < BigInt(early.changes.at(-1)!.id));
    assert.ok(BigInt(next.changes.at(-1)!.position) > BigInt(early.changes.at(-1)!.position));
  } finally { resume(); await late; }
});

test('customer sync rechecks each meeting grant while retaining ordinary channel access', { timeout: 300000 }, async t => {
  Object.assign(process.env, clientMeetingEnvironment, { CUSTOMER_COLLABORATION_SECRET: 'isolated-customer-sync-secret-2026', PUBLIC_CUSTOMER_PORTAL_ORIGIN: 'http://127.0.0.1:5173' });
  const f = await createClientMeetingFixture(t), service = new CommunicationsService(f.db);
  const meetings = new ClientMeetings(f.db, new ClientMeetingTestMedia());
  const collaboration = new ClientCollaboration(f.db, { meetings, verifyEmail: async () => {} });
  const contact = await f.seedCustomer('sync-contact@example.test');
  const channels = [];
  let relationshipId = '';
  for (const name of ['First customer channel', 'Second customer channel']) {
    const channel = await collaboration.create(f.owner, { clientId: f.customer.id, name, staffUserIds: [], requestId: randomUUID() });
    const invite = await collaboration.invite(f.owner, channel.id, { email: contact.identity.email, requestId: randomUUID() });
    const handoff = await collaboration.handoff(collaborationInvitationToken(invite.id));
    relationshipId = (await collaboration.accept(contact.identity, handoff.credential)).relationshipId;
    channels.push(channel);
  }
  const actor = await collaboration.actor(contact.identity, relationshipId);
  const meeting = await meetings.create(f.owner, { requestId: randomUUID(), title: 'Customer meeting', description: '', audience: 'EXTERNAL_CLIENT', type: 'VIDEO', localStart: f.startsAt, timezone: 'UTC', durationMinutes: 60, hostUserId: f.owner.userId, customerId: f.customer.id, attendeeIds: [], cohostIds: [], guestScreenShare: false });
  const sync = new CommunicationsSync(f.db, () => 'b'.repeat(64));
  const snapshot = await sync.page(actor, { limit: 100 });
  await meetings.grantCustomerChannel(f.owner, channels[0].id, meeting.id);
  assert.ok((await sync.page(actor, { cursor: snapshot.cursor, limit: 100 })).changes.some(event => event.meetingId === meeting.id && event.conversationId === channels[0].id));
  await meetings.grantCustomerChannel(f.owner, channels[1].id, meeting.id);
  await meetings.revokeCustomerGrant(f.owner, channels[0].id, meeting.id);
  const partial = await sync.page(actor, { cursor: snapshot.cursor, limit: 100 });
  assert.ok(partial.changes.some(event => event.meetingId === meeting.id && event.conversationId === channels[1].id));
  assert.ok(!partial.changes.some(event => event.meetingId === meeting.id && event.conversationId === channels[0].id), 'A second grant must not reveal events belonging to the revoked grant');
  await meetings.revokeCustomerGrant(f.owner, channels[1].id, meeting.id);
  const message = await service.post(f.owner, channels[0].id, { body: 'Channel membership remains valid' });
  const hidden = await sync.page(actor, { cursor: snapshot.cursor, limit: 100 });
  assert.ok(!hidden.changes.some(event => event.meetingId === meeting.id), 'Revoking meeting access hides already queued meeting events');
  assert.ok(hidden.changes.some(event => event.resourceId === message.id));
  assert.equal((await service.get(actor, channels[0].id)).id, channels[0].id);
});
