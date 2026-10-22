import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { AccessToken, TokenVerifier } from 'livekit-server-sdk';
import { LiveKitProvider, type MeetingMediaProvider } from '../src/modules/communications/communications.livekit.js';
import { CommunicationsMeetings } from '../src/modules/communications/communications.meetings.js';
import { CommunicationsService } from '../src/modules/communications/communications.service.js';
import { communicationsRoutes } from '../src/modules/communications/communications.routes.js';
import type { CommunicationsActor } from '../src/modules/communications/communications.authorization.js';
import { createMeetingFixture } from './helpers/meetings-fixture.js';

// Disposable test credentials. Never read a deployed LiveKit endpoint or credentials.
const key = 'ksos-test-key';
const secret = 'ksos-isolated-test-secret-never-production-2026';
const testEnvironment = { NODE_ENV: 'test', LIVEKIT_ENABLED: 'true', LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret };

class TestMedia implements MeetingMediaProvider {
  private readonly signer = new LiveKitProvider(testEnvironment);
  readonly enabled = true;
  readonly url = testEnvironment.LIVEKIT_URL;
  readonly participantLimit = 4;
  readonly tokenTtlSeconds = this.signer.tokenTtlSeconds;
  readonly liveRooms = new Map<string, { sid: string; members: Map<string, string> }>();
  readonly removals: string[] = [];
  unavailable = false;
  staleRoomSnapshotOnce = false;
  token(room: string, identity: string, name: string) { return this.signer.token(room, identity, name); }
  verify(raw: string, authorization: string) { return this.signer.verify(raw, authorization); }
  async createRoom(name: string) {
    if (this.unavailable) throw new Error('Media server unavailable');
    if (!this.liveRooms.has(name)) this.liveRooms.set(name, { sid: `RM_${randomUUID()}`, members: new Map() });
  }
  async deleteRoom(name: string) { if (this.unavailable) throw new Error('Media server unavailable'); this.liveRooms.delete(name); }
  async rooms() {
    if (this.unavailable) throw new Error('Media server unavailable');
    if (this.staleRoomSnapshotOnce) { this.staleRoomSnapshotOnce = false; return []; }
    return [...this.liveRooms].map(([name, room]) => ({ name, sid: room.sid }));
  }
  async participants(name: string) {
    if (this.unavailable) throw new Error('Media server unavailable');
    return [...(this.liveRooms.get(name)?.members ?? [])].map(([identity, sid]) => ({ identity, sid }));
  }
  async removeParticipant(name: string, identity: string) {
    if (this.unavailable) throw new Error('Media server unavailable');
    this.removals.push(identity);
    this.liveRooms.get(name)?.members.delete(identity);
  }
  observeJoin(name: string, identity: string) {
    const room = this.liveRooms.get(name);
    assert.ok(room, 'KSOS must create the provider room before issuing a token');
    const sid = `PA_${randomUUID()}`;
    room.members.set(identity, sid);
    return { room: { name, sid: room.sid }, participant: { identity, sid } };
  }
}

async function signedEvent(input: Record<string, unknown>) {
  const body = JSON.stringify({ id: `EV_${randomUUID()}`, createdAt: Math.floor(Date.now() / 1000), ...input });
  const signature = new AccessToken(key, secret, { ttl: 60 });
  signature.sha256 = createHash('sha256').update(body).digest('base64');
  return { body, authorization: await signature.toJwt() };
}
const claims = (token: string) => new TokenVerifier(key, secret).verify(token);
const jwtPayload = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { exp: number; nbf: number; sub: string };

test('meetings: real database, authorization, tokens, webhooks and recovery', { timeout: 180000 }, async t => {
  const { pg, db, owner, member, outsider, other } = await createMeetingFixture(t);
  const provider = new TestMedia();
  const service = new CommunicationsService(db, { meetingsProvider: provider });
  const meetings = new CommunicationsMeetings(db, provider);
  await pg.query("UPDATE users SET role='staff' WHERE id=$1", [member.userId]);
  const channel = async () => String((await service.create(owner, { type: 'PRIVATE_CHANNEL', name: `Meeting ${randomUUID()}`, memberUserIds: [member.userId] })).id);
  const direct = async () => String((await service.create(owner, { type: 'DIRECT', name: '', memberUserIds: [member.userId] })).id);
  const create = async (conversationId: string, type: 'AUDIO' | 'VIDEO' = 'VIDEO') => meetings.create(owner, conversationId, { type, requestId: randomUUID() });
  const count = async (table: string) => Number((await pg.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count);
  // Independent cases share the expensive PGlite fixture, but not rate-limit windows.
  // The dedicated limiter case below exercises real limits without this reset within it.
  t.beforeEach(async () => {
    await pg.exec("UPDATE communication_meetings SET created_at=now()-interval '2 hours'; UPDATE communication_meeting_sessions SET created_at=now()-interval '2 hours';");
  });

  await t.test('additive tables deny direct browser database access', async () => {
    for (const table of ['communication_meetings', 'communication_meeting_participants', 'communication_meeting_sessions', 'communication_meeting_webhooks']) {
      assert.equal((await pg.query<{ relrowsecurity: boolean }>('SELECT relrowsecurity FROM pg_class WHERE relname=$1', [table])).rows[0].relrowsecurity, true);
      assert.equal((await pg.query<{ allowed: boolean }>("SELECT has_table_privilege('authenticated',$1,'SELECT') AS allowed", [table])).rows[0].allowed, false);
      assert.equal((await pg.query<{ allowed: boolean }>("SELECT has_table_privilege('anon',$1,'INSERT') AS allowed", [table])).rows[0].allowed, false);
    }
  });

  await t.test('authorized creation and retries produce one meeting and one invitation per recipient', async () => {
    const cid = await direct();
    const requestId = randomUUID();
    const first = await meetings.create(owner, cid, { type: 'AUDIO', requestId });
    const second = await meetings.create(owner, cid, { type: 'AUDIO', requestId });
    assert.equal(first.id, second.id);
    assert.equal(first.conversationId, cid);
    assert.equal(first.createdBy, owner.userId);
    assert.equal(first.type, 'AUDIO');
    assert.equal(first.status, 'RINGING');
    assert.equal((await pg.query('SELECT id FROM communication_meetings WHERE conversation_id=$1', [cid])).rows.length, 1);
    const incoming = await meetings.incoming(member);
    assert.ok(incoming.data.some((call: { id: string }) => call.id === first.id));
    assert.ok(!(await meetings.incoming(outsider)).data.some((call: { id: string }) => call.id === first.id));
    assert.ok(!(await meetings.incoming(other)).data.some((call: { id: string }) => call.id === first.id));
    // A distinct click must not create a second concurrent call for this conversation.
    try { assert.equal((await create(cid, 'AUDIO')).id, first.id); }
    catch (error) { assert.equal((error as { statusCode: number }).statusCode, 409); }
    assert.equal((await pg.query('SELECT id FROM communication_meetings WHERE conversation_id=$1', [cid])).rows.length, 1);
    await meetings.respond(member, first.id, false);
    assert.equal((await meetings.get(owner, first.id)).status, 'CANCELLED');
  });

  await t.test('non-members and other tenants cannot create, view, join or administer calls', async () => {
    const cid = await channel(), meeting = await create(cid);
    for (const actor of [outsider, other]) {
      await assert.rejects(meetings.create(actor, cid, { type: 'VIDEO', requestId: randomUUID() }), { statusCode: 404 });
      await assert.rejects(meetings.get(actor, meeting.id), { statusCode: 404 });
      await assert.rejects(meetings.history(actor, cid), { statusCode: 404 });
      await assert.rejects(meetings.join(actor, meeting.id, randomUUID()), { statusCode: 404 });
      await assert.rejects(meetings.respond(actor, meeting.id, true), { statusCode: 404 });
      await assert.rejects(meetings.end(actor, meeting.id), { statusCode: 404 });
    }
    await assert.rejects(meetings.end(member, meeting.id), { statusCode: 403 });
    await assert.rejects(meetings.remove(member, meeting.id, owner.userId), { statusCode: 403 });
    await meetings.end(owner, meeting.id);
  });

  await t.test('database constraints independently reject cross-tenant organiser and participant references', async () => {
    const cid = await channel(), meeting = await create(cid);
    await assert.rejects(pg.query('UPDATE communication_meetings SET created_by=$1 WHERE id=$2', [other.userId, meeting.id]));
    await assert.rejects(pg.query("INSERT INTO communication_meeting_participants(meeting_id,tenant_id,user_id,role) VALUES($1,$2,$3,'PARTICIPANT')", [meeting.id, owner.tenantId, other.userId]));
    await meetings.end(owner, meeting.id);
  });

  await t.test('call invitations are limited to three per minute and ten per hour', async () => {
    for (let n = 0; n < 3; n++) { const meeting = await create(await channel()); await meetings.end(owner, meeting.id); }
    await assert.rejects(create(await channel()), { statusCode: 429 });
    for (let n = 3; n < 10; n++) {
      await pg.exec("UPDATE communication_meetings SET created_at=now()-interval '2 minutes' WHERE created_at>now()-interval '1 hour';");
      const meeting = await create(await channel()); await meetings.end(owner, meeting.id);
    }
    await pg.exec("UPDATE communication_meetings SET created_at=now()-interval '2 minutes' WHERE created_at>now()-interval '1 hour';");
    await assert.rejects(create(await channel()), { statusCode: 429 });
  });

  await t.test('declining a direct call stops the caller even after the caller has joined media', async () => {
    const cid = await direct(), meeting = await create(cid, 'AUDIO');
    const issued = await meetings.join(owner, meeting.id, randomUUID());
    const room = (await claims(issued.token)).video!.room!;
    const event = await signedEvent({ event: 'participant_joined', ...provider.observeJoin(room, issued.identity) });
    await meetings.webhook(event.body, event.authorization);
    await meetings.respond(member, meeting.id, false);
    assert.ok(['CANCELLED', 'ENDED'].includes((await meetings.get(owner, meeting.id)).status));
    await meetings.reconcile();
    assert.ok(!provider.liveRooms.has(room));
  });

  await t.test('an unanswered direct call expires even when the caller is connected', async () => {
    const cid = await direct(), meeting = await create(cid, 'AUDIO');
    const issued = await meetings.join(owner, meeting.id, randomUUID());
    const room = (await claims(issued.token)).video!.room!;
    const event = await signedEvent({ event: 'participant_joined', ...provider.observeJoin(room, issued.identity) });
    await meetings.webhook(event.body, event.authorization);
    await pg.query("UPDATE communication_meetings SET expires_at=now()-interval '1 minute' WHERE id=$1", [meeting.id]);
    await meetings.reconcile();
    assert.ok(['CANCELLED', 'ENDED'].includes((await meetings.get(owner, meeting.id)).status));
    assert.ok(!provider.liveRooms.has(room));
  });

  await t.test('production signer issues short, room-scoped tokens with server-derived unique identities', async () => {
    const cid = await channel(), meeting = await create(cid);
    const requestId = randomUUID();
    const joined = await meetings.join(owner, meeting.id, requestId);
    const retry = await meetings.join(owner, meeting.id, requestId);
    assert.equal(retry.sessionId, joined.sessionId);
    assert.equal(retry.identity, joined.identity);
    const payload = await claims(joined.token), decoded = jwtPayload(joined.token);
    assert.equal(payload.sub, joined.identity);
    assert.match(joined.identity, /^ksos_[a-f\d-]+$/i);
    assert.ok(!joined.identity.includes(owner.userId));
    assert.ok(!joined.identity.includes(owner.authUserId));
    assert.ok(payload.video?.room && payload.video.room !== cid && payload.video.room !== meeting.id);
    assert.equal(payload.video?.roomJoin, true);
    assert.equal(payload.video?.canPublish, true);
    assert.equal(payload.video?.canSubscribe, true);
    assert.notEqual(payload.video?.roomAdmin, true);
    assert.notEqual(payload.video?.roomCreate, true);
    assert.notEqual(payload.video?.roomList, true);
    assert.notEqual(payload.video?.roomRecord, true);
    assert.ok(decoded.exp > Date.now() / 1000 && decoded.exp <= Date.now() / 1000 + 301);
    assert.ok(joined.expiresIn <= 300);
    await assert.rejects(new TokenVerifier(key, 'wrong-test-secret-never-production').verify(joined.token));
    const secondTab = await meetings.join(owner, meeting.id, randomUUID());
    assert.notEqual(secondTab.sessionId, joined.sessionId);
    assert.notEqual(secondTab.identity, joined.identity);
    await meetings.end(owner, meeting.id);
    await assert.rejects(meetings.join(owner, meeting.id, randomUUID()), { statusCode: 409 });
  });

  await t.test('authentication is revalidated before each media credential is issued', async () => {
    const cid = await channel(), meeting = await create(cid);
    await pg.query('UPDATE application_sessions SET revoked_at=now() WHERE auth_session_id=$1', [member.sessionId]);
    try { await assert.rejects(meetings.join(member, meeting.id, randomUUID()), { statusCode: 401 }); }
    finally { await pg.query('UPDATE application_sessions SET revoked_at=NULL WHERE auth_session_id=$1', [member.sessionId]); }
    await pg.query("UPDATE users SET account_status='SUSPENDED' WHERE id=$1", [member.userId]);
    try { await assert.rejects(meetings.join(member, meeting.id, randomUUID())); }
    finally { await pg.query("UPDATE users SET account_status='ACTIVE' WHERE id=$1", [member.userId]); }
    await meetings.end(owner, meeting.id);
  });

  await t.test('joining is not counted as attendance until media participation is observed', async () => {
    const cid = await channel(), meeting = await create(cid);
    const issued = await meetings.join(member, meeting.id, randomUUID());
    assert.notEqual((await meetings.get(owner, meeting.id)).status, 'ACTIVE');
    const room = (await claims(issued.token)).video!.room!;
    const event = await signedEvent({ event: 'participant_joined', ...provider.observeJoin(room, issued.identity) });
    await meetings.webhook(event.body, event.authorization);
    const active = await meetings.get(owner, meeting.id);
    assert.equal(active.status, 'ACTIVE');
    assert.ok(active.startedAt);
    const attendee = active.participants.find((participant: { userId: string }) => participant.userId === member.userId);
    assert.ok(attendee?.joinedAt);
    assert.equal(attendee?.sessionCount, 1);
    const before = await count('communication_meeting_webhooks');
    await meetings.webhook(event.body, event.authorization);
    assert.equal(await count('communication_meeting_webhooks'), before);
    assert.equal((await meetings.get(owner, meeting.id)).participants.find((p: { userId: string }) => p.userId === member.userId)?.sessionCount, 1);
    const delayedLeave = await signedEvent({ event: 'participant_left', createdAt: Math.floor(Date.now() / 1000) - 10, room: { name: room }, participant: { identity: issued.identity, sid: 'previous-session-observation' } });
    await meetings.webhook(delayedLeave.body, delayedLeave.authorization);
    assert.equal((await meetings.get(owner, meeting.id)).participants.find((p: { userId: string }) => p.userId === member.userId)?.sessionCount, 1);
    await meetings.end(owner, meeting.id);
    assert.ok(!provider.liveRooms.has(room));
    assert.equal((await meetings.get(owner, meeting.id)).status, 'ENDED');
    // A delayed verified join observation cannot resurrect an ended meeting.
    const late = await signedEvent({ event: 'participant_joined', room: { name: room }, participant: { identity: issued.identity } });
    await meetings.webhook(late.body, late.authorization);
    assert.equal((await meetings.get(owner, meeting.id)).status, 'ENDED');
  });

  await t.test('unsigned, forged and body-tampered webhooks cannot mutate meetings', async () => {
    const before = await count('communication_meeting_webhooks');
    const event = await signedEvent({ event: 'room_finished', room: { name: 'unrelated-room' } });
    await assert.rejects(meetings.webhook(event.body, ''));
    await assert.rejects(meetings.webhook(event.body, 'not-a-jwt'));
    await assert.rejects(meetings.webhook(event.body.replace('room_finished', 'room_started'), event.authorization));
    assert.equal(await count('communication_meeting_webhooks'), before);
  });

  await t.test('failed webhook observations remain retryable and failed room deletion is reconciled', async () => {
    const cid = await channel(), meeting = await create(cid);
    const issued = await meetings.join(owner, meeting.id, randomUUID());
    const room = (await claims(issued.token)).video!.room!;
    const event = await signedEvent({ event: 'participant_joined', ...provider.observeJoin(room, issued.identity) });
    const before = await count('communication_meeting_webhooks');
    provider.unavailable = true;
    try { await assert.rejects(meetings.webhook(event.body, event.authorization)); }
    finally { provider.unavailable = false; }
    assert.equal(await count('communication_meeting_webhooks'), before);
    await meetings.webhook(event.body, event.authorization);
    assert.equal((await meetings.get(owner, meeting.id)).status, 'ACTIVE');
    provider.unavailable = true;
    try { await assert.rejects(meetings.end(owner, meeting.id), { statusCode: 503 }); }
    finally { provider.unavailable = false; }
    assert.equal((await meetings.get(owner, meeting.id)).status, 'ENDED');
    assert.ok(provider.liveRooms.has(room));
    await assert.rejects(meetings.join(member, meeting.id, randomUUID()), { statusCode: 409 });
    await meetings.reconcile();
    assert.ok(!provider.liveRooms.has(room));
  });

  await t.test('expired unconnected credentials cannot be retried or become attended sessions', async () => {
    const cid = await channel(), meeting = await create(cid);
    const requestId = randomUUID(), issued = await meetings.join(member, meeting.id, requestId);
    await pg.query("UPDATE communication_meeting_sessions SET token_expires_at=now()-interval '2 minutes' WHERE id=$1", [issued.sessionId]);
    await assert.rejects(meetings.join(member, meeting.id, requestId), { statusCode: 409 });
    const room = (await claims(issued.token)).video!.room!;
    const event = await signedEvent({ event: 'participant_joined', ...provider.observeJoin(room, issued.identity) });
    await meetings.webhook(event.body, event.authorization);
    assert.ok(provider.removals.includes(issued.identity));
    assert.equal((await meetings.get(owner, meeting.id)).participants.find((p: { userId: string }) => p.userId === member.userId)?.sessionCount, 0);
    await meetings.end(owner, meeting.id);
  });

  await t.test('leaving only disconnects the caller session; removal revokes every target session', async () => {
    const cid = await channel(), meeting = await create(cid);
    const host = await meetings.join(owner, meeting.id, randomUUID());
    const first = await meetings.join(member, meeting.id, randomUUID());
    const second = await meetings.join(member, meeting.id, randomUUID());
    const room = (await claims(host.token)).video!.room!;
    for (const join of [host, first, second]) {
      const event = await signedEvent({ event: 'participant_joined', ...provider.observeJoin(room, join.identity) });
      await meetings.webhook(event.body, event.authorization);
    }
    await assert.rejects(meetings.leave(member, meeting.id, host.sessionId));
    await meetings.leave(member, meeting.id, first.sessionId);
    assert.equal((await meetings.get(owner, meeting.id)).status, 'ACTIVE');
    assert.ok(provider.liveRooms.get(room)?.members.has(host.identity));
    assert.ok(provider.removals.includes(first.identity));
    await meetings.remove(owner, meeting.id, member.userId);
    assert.ok(provider.removals.includes(second.identity));
    assert.ok(!provider.liveRooms.get(room)?.members.has(second.identity));
    await assert.rejects(meetings.join(member, meeting.id, randomUUID()));
    await meetings.end(owner, meeting.id);
  });

  await t.test('reconciliation repairs missing delivery and removes a revoked conversation member', async () => {
    const cid = await channel(), meeting = await create(cid);
    const issued = await meetings.join(member, meeting.id, randomUUID());
    const room = (await claims(issued.token)).video!.room!;
    provider.observeJoin(room, issued.identity);
    await meetings.reconcile();
    assert.equal((await meetings.get(owner, meeting.id)).status, 'ACTIVE');
    await pg.query('UPDATE conversation_members SET left_at=now() WHERE conversation_id=$1 AND user_id=$2', [cid, member.userId]);
    await meetings.reconcile();
    assert.ok(provider.removals.includes(issued.identity));
    await assert.rejects(meetings.get(member, meeting.id), { statusCode: 404 });
    await assert.rejects(meetings.join(member, meeting.id, randomUUID()), { statusCode: 404 });
    provider.liveRooms.delete(room);
    await meetings.reconcile();
    assert.ok(['ENDED', 'FAILED'].includes((await meetings.get(owner, meeting.id)).status));
  });

  await t.test('a room created after the initial reconciliation snapshot is not prematurely cancelled', async () => {
    const cid = await channel(), meeting = await create(cid);
    provider.staleRoomSnapshotOnce = true;
    await meetings.reconcile();
    assert.equal((await meetings.get(owner, meeting.id)).status, 'RINGING');
    await meetings.end(owner, meeting.id);
  });

  await t.test('expired unanswered calls stop ringing and unavailable media does not invent attendance', async () => {
    const cid = await direct(), meeting = await create(cid, 'AUDIO');
    await pg.query("UPDATE communication_meetings SET expires_at=now()-interval '1 minute' WHERE id=$1", [meeting.id]);
    await meetings.reconcile();
    const expired = await meetings.get(owner, meeting.id);
    assert.ok(['CANCELLED', 'FAILED', 'ENDED'].includes(expired.status));
    assert.equal(expired.startedAt, null);
    assert.ok(!(await meetings.incoming(member)).data.some((call: { id: string }) => call.id === meeting.id));
    const newCid = await channel();
    provider.unavailable = true;
    try { await assert.rejects(create(newCid)); }
    finally { provider.unavailable = false; }
    assert.equal((await pg.query("SELECT id FROM communication_meetings WHERE conversation_id=$1 AND status='ACTIVE'", [newCid])).rows.length, 0);
  });

  await t.test('real HTTP routes reject forged identity fields and keep credentials out of history', async () => {
    const app = Fastify();
    await app.register(websocket);
    app.decorateRequest('auth', undefined);
    app.decorateRequest('authIdentity', undefined);
    app.decorateRequest('requireAuth', function () { if (!this.auth) throw Object.assign(new Error('Authentication required'), { statusCode: 401 }); });
    const actors: Record<string, CommunicationsActor> = { owner, member, outsider, other };
    app.addHook('onRequest', async request => {
      const actor = actors[request.headers.authorization?.replace('Bearer ', '') ?? ''];
      if (!actor) return;
      request.auth = { tenantId: actor.tenantId, tenantUserId: actor.userId, authUserId: actor.authUserId, membershipReference: actor.userId, businessReference: actor.tenantId, tenantName: 'Test', tenantSubdomain: 'test', email: null, role: 'owner', permissions: [] };
      request.authIdentity = { authUserId: actor.authUserId, authSessionId: actor.sessionId, email: null, assuranceLevel: 'aal1', issuedAt: actor.issuedAt, expiresAt: actor.expiresAt };
    });
    app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => { reply.code(error instanceof ZodError ? 400 : error.statusCode ?? 500).send({ error: error.message }); });
    await app.register(communicationsRoutes, { prefix: '/comms', service });
    await app.ready();
    try {
      const cid = await channel(), headers = { authorization: 'Bearer owner' };
      for (const payload of [
        { type: 'VIDEO', requestId: randomUUID(), identity: other.userId },
        { type: 'VIDEO', requestId: randomUUID(), tenantId: other.tenantId },
        { type: 'INVALID', requestId: randomUUID() },
      ]) assert.equal((await app.inject({ method: 'POST', url: `/comms/${cid}/meetings`, headers, payload })).statusCode, 400);
      assert.equal((await app.inject({ method: 'POST', url: `/comms/${cid}/meetings`, payload: { type: 'VIDEO', requestId: randomUUID() } })).statusCode, 401);
      const made = await app.inject({ method: 'POST', url: `/comms/${cid}/meetings`, headers, payload: { type: 'VIDEO', requestId: randomUUID() } });
      assert.ok([200, 201].includes(made.statusCode), made.body);
      const id = made.json().data.id;
      const token = await app.inject({ method: 'POST', url: `/comms/meetings/${id}/join`, headers, payload: { requestId: randomUUID(), identity: other.userId } });
      assert.equal(token.statusCode, 400);
      const authorized = await app.inject({ method: 'POST', url: `/comms/meetings/${id}/join`, headers, payload: { requestId: randomUUID() } });
      assert.equal(authorized.statusCode, 200, authorized.body);
      assert.ok(authorized.json().data.token);
      assert.match(String(authorized.headers['cache-control']), /no-store/);
      const history = await app.inject({ url: `/comms/${cid}/meetings`, headers });
      assert.equal(history.statusCode, 200, history.body);
      assert.ok(!history.body.includes(secret));
      assert.ok(!history.body.includes(authorized.json().data.token));
      const delivered = await signedEvent({ event: 'room_finished', room: { name: 'unknown-disposable-test-room' } });
      const delivery = await app.inject({ method: 'POST', url: '/comms/meetings/webhook', headers: { 'content-type': 'application/webhook+json', authorization: delivered.authorization }, payload: delivered.body });
      assert.equal(delivery.statusCode, 200, delivery.body);
      assert.equal((await app.inject({ method: 'POST', url: '/comms/meetings/webhook', headers: { 'content-type': 'application/webhook+json' }, payload: JSON.stringify({ event: 'room_finished' }) })).statusCode, 401);
      await meetings.end(owner, id);
    } finally { await app.close(); }
  });
});
