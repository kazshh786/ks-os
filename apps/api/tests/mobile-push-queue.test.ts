import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { MobileDevices, requireMobileDevice } from '../src/modules/authentication/mobile-devices.service.js';
import { MobilePushService } from '../src/modules/mobile-push/push.service.js';
import { MobilePushWorker } from '../src/modules/mobile-push/push.worker.js';
import type { PushAdapter, PushOutcome, PushPayload, PushTarget } from '../src/modules/mobile-push/push.types.js';
import { CommunicationsService } from '../src/modules/communications/communications.service.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';
import type { CommunicationsActor } from '../src/modules/communications/communications.authorization.js';
import type { CommunicationsDatabase } from '../src/modules/communications/communications.database.js';
import type { SQL } from '@ks-os/database';
import { PgDialect } from 'drizzle-orm/pg-core';

const applicationId = 'test.ksos.mobile';
const request = (a: CommunicationsActor, id?: string) => ({ applicationContext: 'TENANT', headers: id ? { 'x-ks-device-id': id } : {}, requireIdentity: () => ({ authUserId: a.authUserId, authSessionId: a.sessionId, issuedAt: a.issuedAt, expiresAt: a.expiresAt, email: 'test@example.test' }) }) as unknown as FastifyRequest;
function intercept(db: CommunicationsDatabase, before: (query: string) => void | Promise<void>): CommunicationsDatabase {
  const dialect = new PgDialect();
  return {
    async query<T extends Record<string, unknown>>(statement: SQL) { await before(dialect.sqlToQuery(statement).sql); return db.query<T>(statement); },
    transaction: work => db.transaction(tx => work(intercept(tx, before))),
  };
}
test('durable push uses canonical notifications and reauthorizes dispatch', { timeout: 300000 }, async t => {
  const f = await createClientMeetingFixture(t), chat = new CommunicationsService(f.db);
  const priorKey = process.env.INTEGRATION_ENCRYPTION_KEY; process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  t.after(() => { if (priorKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY; else process.env.INTEGRATION_ENCRYPTION_KEY = priorKey; });
  const deliveries: Array<{ target: PushTarget; payload: PushPayload; id: string }> = [];
  let outcome: PushOutcome = { kind: 'accepted' }, beforeSend: (() => Promise<void>) | undefined, prepare: (() => Promise<void>) | undefined;
  const adapter: PushAdapter = { matches: target => target.provider === 'APNS' && target.applicationId === applicationId && target.environment === 'SANDBOX', prepare: async () => { await prepare?.(); }, send: async (target, payload, id) => { deliveries.push({ target, payload, id }); await beforeSend?.(); return outcome; } };
  const devices = new MobileDevices(f.db, { MOBILE_APPLICATIONS_JSON: JSON.stringify([{ applicationId, platform: 'IOS', environment: 'SANDBOX', redirectUri: 'https://mobile.example.test/callback' }]) });
  const push = new MobilePushService(f.db, [adapter]);
  const setup = async (type: 'DIRECT' | 'PRIVATE_CHANNEL' = 'DIRECT') => {
    await f.pg.exec('TRUNCATE mobile_push_deliveries CASCADE'); deliveries.length = 0; outcome = { kind: 'accepted' }; beforeSend = undefined; prepare = undefined;
    const actor = await f.seed(f.owner.tenantId), device = await devices.register(request(actor), { applicationId, platform: 'IOS', environment: 'SANDBOX', installationId: randomUUID() });
    await f.pg.query("UPDATE application_sessions SET hard_expires_at=now()+interval '1 day' WHERE auth_session_id=$1", [actor.sessionId]);
    const binding = await requireMobileDevice(request(actor, String(device.id)), f.db), token = randomBytes(32).toString('hex');
    const registration = await push.register(binding, { provider: 'APNS', channel: 'ALERT', token });
    await push.enableContext(binding, actor);
    const conversation = String((await chat.create(f.owner, { type, name: type === 'DIRECT' ? '' : 'Membership revocation', memberUserIds: [actor.userId] })).id);
    await chat.discovery.preferences(actor, { browser: false, inApp: true, sound: false, dnd: false, directMessages: true, push: true });
    return { actor, device, binding, token, registration, conversation };
  };
  const worker = () => new MobilePushWorker(f.db, [adapter], { random: () => 0 });
  await t.test('one canonical record produces one encrypted delivery and a generic payload', async () => {
    const s = await setup(), input = { body: 'Private customer financial data', clientMessageId: randomUUID() };
    await chat.post(f.owner, s.conversation, input); await chat.post(f.owner, s.conversation, input);
    assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM mobile_push_deliveries')).rows[0].n, 1);
    const stored = (await f.pg.query('SELECT token_ciphertext FROM mobile_push_registrations WHERE id=$1', [s.registration.id])).rows[0]; assert.ok(!String(stored.token_ciphertext).includes(s.token));
    assert.equal((await worker().process()).accepted, 1); assert.equal(deliveries.length, 1); assert.ok(!JSON.stringify(deliveries[0].payload).includes(input.body));
    assert.equal(deliveries[0].payload.tenantId, s.actor.tenantId); assert.equal((await worker().process()).claimed, 0);
    assert.equal((await f.pg.query('SELECT read_at FROM internal_notifications WHERE id=$1', [deliveries[0].payload.notificationId])).rows[0].read_at, null);
  });
  await t.test('another tenant cannot enroll a context or receive its event', async () => {
    const s = await setup(); await assert.rejects(push.enableContext(s.binding, f.other));
    const channel = String((await chat.create(f.other, { type: 'PRIVATE_CHANNEL', name: 'Other business', memberUserIds: [] })).id);
    await chat.post(f.other, channel, { body: 'Other tenant' }); assert.equal((await worker().process()).claimed, 0);
  });
  await t.test('provider logout and membership loss after queuing cancel before external I/O', async () => {
    for (const cause of ['provider', 'membership', 'preferences', 'read']) {
      const s = await setup(cause === 'membership' ? 'PRIVATE_CHANNEL' : 'DIRECT'), message = await chat.post(f.owner, s.conversation, { body: 'Queued' });
      prepare = async () => {
        if (cause === 'provider') await f.pg.query('DELETE FROM auth.sessions WHERE id=$1', [s.actor.sessionId]);
        if (cause === 'membership') await chat.removeMember(f.owner, s.conversation, s.actor.userId);
        if (cause === 'preferences') await f.pg.query('UPDATE communication_preferences SET dnd=true WHERE user_id=$1', [s.actor.userId]);
        if (cause === 'read') await chat.read(s.actor, s.conversation, message.id);
      };
      assert.equal((await worker().process()).cancelled, 1, cause); assert.equal(deliveries.length, 0, cause);
    }
  });
  await t.test('bounded retries survive worker restarts and expiry', async () => {
    const s = await setup(); await chat.post(f.owner, s.conversation, { body: 'Retry me' }); outcome = { kind: 'retry', code: 'PROVIDER_BUSY', retryAfterMs: 120000 };
    assert.equal((await worker().process()).retry, 1); assert.equal((await worker().process()).claimed, 0);
    const pending = (await f.pg.query('SELECT next_attempt_at,attempt_count FROM mobile_push_deliveries')).rows[0]; assert.equal(pending.attempt_count, 1); assert.ok(new Date(pending.next_attempt_at as string).getTime() > Date.now() + 100000);
    await f.pg.query("UPDATE mobile_push_deliveries SET next_attempt_at=now(),attempt_count=5");
    assert.equal((await worker().process()).failed, 1); assert.equal((await f.pg.query('SELECT status FROM mobile_push_deliveries')).rows[0].status, 'FAILED');
    await chat.post(f.owner, s.conversation, { body: 'Expire me' }); await f.pg.query("UPDATE mobile_push_deliveries SET expires_at=now()-interval '1 second' WHERE status='PENDING'");
    assert.equal((await worker().process()).claimed, 0); assert.equal(deliveries.length, 2);
  });
  await t.test('a temporary provider-session lookup failure retries without discarding the notification', async () => {
    const s = await setup(); await chat.post(f.owner, s.conversation, { body: 'Keep this notification during a database outage' });
    let unavailable = true;
    const db = intercept(f.db, query => {
      if (unavailable && query.includes('public.mobile_provider_session(')) { unavailable = false; throw new Error('Temporary provider session lookup outage'); }
    });
    const retrying = new MobilePushWorker(db, [adapter], { random: () => 0 });
    assert.equal((await retrying.process()).retry, 1); assert.equal(deliveries.length, 0);
    const stored = (await f.pg.query('SELECT status,last_error_code FROM mobile_push_deliveries')).rows[0];
    assert.equal(stored.status, 'RETRY'); assert.equal(stored.last_error_code, 'PUSH_PROCESSING_UNAVAILABLE');
    await f.pg.query('UPDATE mobile_push_deliveries SET next_attempt_at=now()');
    assert.equal((await retrying.process()).accepted, 1); assert.equal(deliveries.length, 1);
  });
  await t.test('a failed outcome commit waits for sibling provider requests to drain', async () => {
    const s = await setup();
    await chat.post(f.owner,s.conversation,{body:'First queued delivery'});
    await chat.post(f.owner,s.conversation,{body:'Second queued delivery'});
    let release!: () => void, sending!: () => void, failed!: () => void, calls = 0, failFinish = true;
    const gate = new Promise<void>(resolve => { release=resolve; });
    const secondSending = new Promise<void>(resolve => { sending=resolve; });
    const finishFailed = new Promise<void>(resolve => { failed=resolve; });
    const fault = new Error('Outcome commit unavailable');
    const interrupted = intercept(f.db, query => {
      if (failFinish && query.includes('accepted_at=') && query.includes('RETURNING id')) { failFinish=false; throw fault; }
    });
    const db: CommunicationsDatabase = {
      query: statement => interrupted.query(statement),
      async transaction(work) {
        try { return await interrupted.transaction(work); }
        catch (error) { if(error===fault)failed(); throw error; }
      },
    };
    const delayed: PushAdapter = {
      matches: adapter.matches,
      async send() {
        if (++calls===1) await secondSending;
        else { sending(); await gate; }
        return {kind:'accepted'};
      },
    };
    const processing = new MobilePushWorker(db,[delayed]).process();
    let settled=false;
    void processing.then(()=>{settled=true;},()=>{settled=true;});
    try {
      await Promise.all([secondSending,finishFailed]);
      // The failing transaction has unwound; allow its promise rejection to
      // propagate before checking that the still-held HTTP request owns the batch.
      await new Promise<void>(resolve=>setImmediate(resolve));
      assert.equal(settled,false,'The scheduler must not start another batch while a sibling delivery is in flight');
    } finally { release(); await Promise.allSettled([processing]); }
    await assert.rejects(processing,error=>error===fault);
    assert.equal(calls,2);
    assert.equal((await f.pg.query("SELECT count(*)::int AS n FROM mobile_push_deliveries WHERE status='ACCEPTED'")).rows[0].n,1);
  });
  await t.test('a late invalid response cannot remove a rotated token', async () => {
    const s = await setup(); await chat.post(f.owner, s.conversation, { body: 'Rotate while sending' });
    const rotated = randomBytes(32).toString('hex'); beforeSend = async () => { await push.register(s.binding, { provider: 'APNS', channel: 'ALERT', token: rotated }); };
    outcome = { kind: 'invalid', code: 'APNS_Unregistered' }; await worker().process();
    const row = (await f.pg.query('SELECT token_version,invalidated_at,token_ciphertext FROM mobile_push_registrations WHERE id=$1', [s.registration.id])).rows[0];
    assert.equal(row.token_version, 2); assert.equal(row.invalidated_at, null); assert.notEqual(row.token_ciphertext, '');
  });
  await t.test('logout clears push credentials and cancels pending deliveries', async () => {
    const s = await setup(); await chat.post(f.owner, s.conversation, { body: 'Pending logout' });
    await devices.revoke(request(s.actor), String(s.device.id));
    assert.equal((await f.pg.query('SELECT token_ciphertext FROM mobile_push_registrations WHERE id=$1', [s.registration.id])).rows[0].token_ciphertext, '');
    assert.equal((await worker().process()).claimed, 0); assert.equal(deliveries.length, 0);
    await assert.rejects(chat.events(s.actor, null, '0'), { code: 'MOBILE_SESSION_REQUIRED' });
  });
});

test('PostgreSQL queue leases allow concurrent workers without holding a transaction during HTTP', { timeout: 120000, skip: !process.env.CLIENT_MEETINGS_TEST_DATABASE_URL }, async t => {
  const f = await createClientMeetingFixture(t, { postgresUrl: process.env.CLIENT_MEETINGS_TEST_DATABASE_URL });
  const device = randomUUID(), registration = randomUUID(), context = randomUUID(), notification = randomUUID();
  await f.pg.query("INSERT INTO mobile_devices(id,auth_user_id,auth_session_id,platform,application_id,environment,installation_hash,auth_issued_at,last_authenticated_at) VALUES($1,$2,$3,'IOS',$4,'SANDBOX',$5,now(),now())", [device, f.owner.authUserId, f.owner.sessionId, applicationId, randomBytes(32).toString('hex')]);
  await f.pg.query("INSERT INTO mobile_push_registrations(id,device_id,provider,channel,token_ciphertext,token_hash) VALUES($1,$2,'APNS','ALERT','test',$3)", [registration, device, randomBytes(32).toString('hex')]);
  await f.pg.query("INSERT INTO mobile_push_contexts(id,device_id,tenant_id,application_context,user_id,security_version) VALUES($1,$2,$3,'TENANT',$4,1)", [context, device, f.owner.tenantId, f.owner.userId]);
  await f.pg.query("INSERT INTO internal_notifications(id,tenant_id,recipient_user_id,type,title,message,source_type,source_id) VALUES($1,$2,$3,'TEST','Test','Test','TEST',$4)", [notification, f.owner.tenantId, f.owner.userId, randomUUID()]);
  await f.pg.query("INSERT INTO mobile_push_deliveries(notification_id,registration_id,context_id,tenant_id,token_version,expires_at) VALUES($1,$2,$3,$4,1,now()+interval '1 hour')", [notification, registration, context, f.owner.tenantId]);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), sending = new Promise<void>(resolve => { started = resolve; });
  const adapter: PushAdapter = { matches: () => true, send: async () => { started(); await gate; return { kind: 'accepted' }; } };
  const authorize = async () => ({ target: { provider: 'APNS' as const, channel: 'ALERT' as const, applicationId, environment: 'SANDBOX' as const, token: randomBytes(32).toString('hex') }, payload: { notificationId: notification, tenantId: f.owner.tenantId, kind: 'CHAT_MESSAGE', context: 'TENANT' as const, expiresAt: new Date(Date.now() + 3600000).toISOString(), title: 'KSOS', body: 'New activity', sound: false } });
  const first = new MobilePushWorker(f.db, [adapter], { authorize }).process(); await sending;
  try {
    assert.equal((await new MobilePushWorker(f.db, [adapter], { authorize }).process()).claimed, 0);
    await f.db.transaction(async db => { const { sql } = await import('@ks-os/database'); await db.query(sql`SELECT id FROM mobile_push_deliveries FOR UPDATE NOWAIT`); });
  } finally { release(); }
  assert.equal((await first).accepted, 1);
});

test('PostgreSQL context re-enable cannot resurrect a concurrently revoked device', { timeout: 120000, skip: !process.env.CLIENT_MEETINGS_TEST_DATABASE_URL }, async t => {
  const f = await createClientMeetingFixture(t, { postgresUrl: process.env.CLIENT_MEETINGS_TEST_DATABASE_URL });
  const devices = new MobileDevices(f.db, { MOBILE_APPLICATIONS_JSON: JSON.stringify([{ applicationId, platform: 'IOS', environment: 'SANDBOX', redirectUri: 'https://mobile.example.test/callback' }]) });
  const device = await devices.register(request(f.owner), { applicationId, platform: 'IOS', environment: 'SANDBOX', installationId: randomUUID() });
  const binding = await requireMobileDevice(request(f.owner, String(device.id)), f.db);
  const push = new MobilePushService(f.db, []), context = await push.enableContext(binding, f.owner);
  await push.disableContext(binding, String(context.id));
  let release!: () => void, reached!: () => void, paused = false;
  const gate = new Promise<void>(resolve => { release = resolve; }), lockedRead = new Promise<void>(resolve => { reached = resolve; });
  const delayed = new MobilePushService(intercept(f.db, async query => {
    if (!paused && /SELECT id FROM mobile_devices[\s\S]+FOR UPDATE/.test(query)) { paused = true; reached(); await gate; }
  }), []);
  const enabling = delayed.enableContext(binding, f.owner);
  try {
    await Promise.race([lockedRead, enabling.then(() => { throw new Error('Context mutation bypassed the locked device check'); })]);
    await devices.revoke(request(f.owner), String(device.id));
    release();
    await assert.rejects(enabling, { code: 'PUSH_REGISTRATION_NOT_FOUND' });
    const state = (await f.pg.query('SELECT c.enabled,d.revoked_at FROM mobile_push_contexts c JOIN mobile_devices d ON d.id=c.device_id WHERE c.id=$1', [context.id])).rows[0];
    assert.equal(state.enabled, false); assert.ok(state.revoked_at);
  } finally { release(); await Promise.allSettled([enabling]); }
});
