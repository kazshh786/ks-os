import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { CommunicationsService } from '../src/modules/communications/communications.service.js';
import { communicationsRoutes } from '../src/modules/communications/communications.routes.js';
import type { CommunicationsActor } from '../src/modules/communications/communications.authorization.js';
import type { ChatStorage } from '../src/modules/communications/communications.storage.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('customer and staff upload routes share process capacity', { timeout: 120000 }, async t => {
  const f = await createClientMeetingFixture(t), customer = await f.seedCustomer();
  const relationship = randomUUID(), conversation = randomUUID();
  const actor: CommunicationsActor = { tenantId: f.owner.tenantId, userId: relationship, kind: 'CUSTOMER', customerRelationshipId: relationship, customerAccountId: customer.accountId, ...customer.identity };
  await f.pg.query('INSERT INTO customer_collaboration_relationships(id,tenant_id,client_id,customer_account_id,created_by) VALUES($1,$2,$3,$4,$5)', [relationship, f.owner.tenantId, f.customer.id, customer.accountId, f.owner.userId]);
  await f.pg.query("INSERT INTO conversations(id,tenant_id,client_id,primary_channel,customer_display_name,access_mode,conversation_type,name,created_by_user_id,external_client_channel) VALUES($1,$2,$3,'NATIVE','Shared files','MEMBERS','CLIENT','Shared files',$4,true)", [conversation, f.owner.tenantId, f.customer.id, f.owner.userId]);
  await f.pg.query("INSERT INTO conversation_members(tenant_id,conversation_id,user_id,role) VALUES($1,$2,$3,'OWNER')", [f.owner.tenantId, conversation, f.owner.userId]);
  await f.pg.query("INSERT INTO conversation_members(tenant_id,conversation_id,customer_relationship_id,role) VALUES($1,$2,$3,'EXTERNAL')", [f.owner.tenantId, conversation, relationship]);
  const bytes = Buffer.from('A bounded shared document');

  await t.test('two separate service instances enforce one validation limit and release both success and failure slots', async () => {
    const holds = new Map<string, { entered: ReturnType<typeof signal>; release: ReturnType<typeof signal>; fail?: boolean }>();
    const writes: string[] = [];
    const storage: ChatStorage = {
      put: async key => { const hold = holds.get(key); if (hold) { hold.entered.resolve(); await hold.release.promise; if (hold.fail) throw new Error('Controlled storage failure'); } writes.push(key); },
      get: async () => bytes, remove: async () => {},
    };
    const staff = new CommunicationsService(f.db, { storage }), portal = new CommunicationsService(f.db, { storage });
    const reserve = async (service: CommunicationsService, principal: CommunicationsActor) => String((await service.attachments.reserve(principal, conversation, { name: 'document.txt', size: bytes.length })).id);
    const firstId = await reserve(staff, f.owner), secondId = await reserve(portal, actor), thirdId = await reserve(portal, actor), fourthId = await reserve(staff, f.owner);
    const firstGate = { entered: signal(), release: signal() }, secondGate = { entered: signal(), release: signal(), fail: true };
    holds.set(`${f.owner.tenantId}/${firstId}`, firstGate); holds.set(`${f.owner.tenantId}/${secondId}`, secondGate);
    const first = staff.attachments.upload(f.owner, conversation, firstId, bytes).then(value => ({ value }), error => ({ error }));
    const second = portal.attachments.upload(actor, conversation, secondId, bytes).then(value => ({ value }), error => ({ error }));
    try {
      await Promise.all([firstGate.entered.promise, secondGate.entered.promise]);
      await assert.rejects(portal.attachments.upload(actor, conversation, thirdId, bytes), { statusCode: 429, code: 'UPLOAD_BUSY' });
      assert.equal((await f.pg.query('SELECT status FROM conversation_attachments WHERE id=$1', [thirdId])).rows[0].status, 'PENDING');
      firstGate.release.resolve(); const firstResult = await first; assert.ok('value' in firstResult); assert.equal(firstResult.value.status, 'AVAILABLE');
      assert.equal((await portal.attachments.upload(actor, conversation, thirdId, bytes)).status, 'AVAILABLE');
      secondGate.release.resolve(); const failed = await second; assert.ok('error' in failed); assert.match(String(failed.error), /Controlled storage failure/);
      assert.equal((await f.pg.query('SELECT status FROM conversation_attachments WHERE id=$1', [secondId])).rows[0].status, 'REJECTED');
      assert.equal((await staff.attachments.upload(f.owner, conversation, fourthId, bytes)).status, 'AVAILABLE');
      assert.equal(writes.length, 3);
    } finally { firstGate.release.resolve(); secondGate.release.resolve(); await Promise.allSettled([first, second]); }
  });

  await t.test('separate HTTP prefixes share admission before body parsing and release rejected requests', async () => {
    const storage: ChatStorage = { put: async () => {}, get: async () => bytes, remove: async () => {} };
    const staff = new CommunicationsService(f.db, { storage }), portal = new CommunicationsService(f.db, { storage });
    const reserve = async (service: CommunicationsService, principal: CommunicationsActor) => String((await service.attachments.reserve(principal, conversation, { name: 'http-document.txt', size: bytes.length })).id);
    const firstId = await reserve(staff, f.owner), secondId = await reserve(staff, f.owner), thirdId = await reserve(portal, actor), fourthId = await reserve(staff, f.owner);
    const firstUrl = `/staff/${conversation}/files/${firstId}`, secondUrl = `/staff/${conversation}/files/${secondId}`, thirdUrl = `/customer/${conversation}/files/${thirdId}`;
    const gates = new Map([[firstUrl, { entered: signal(), release: signal() }], [secondUrl, { entered: signal(), release: signal() }]]);
    const app = Fastify(); await app.register(websocket);
    app.addHook('preParsing', async (request, _reply, payload) => { const gate = gates.get(request.url); if (gate) { gate.entered.resolve(); await gate.release.promise; } return payload; });
    await app.register(communicationsRoutes, { prefix: '/staff', service: staff, resolveActor: () => f.owner });
    await app.register(communicationsRoutes, { prefix: '/customer', service: portal, customer: true, resolveActor: () => actor });
    await app.ready();
    const upload = (url: string, payload = bytes) => app.inject({ method: 'PUT', url, headers: { 'content-type': 'application/octet-stream' }, payload }).then(response => response);
    const first = upload(firstUrl), second = upload(secondUrl, Buffer.from('wrong size'));
    try {
      await Promise.all([...gates.values()].map(g => g.entered.promise));
      const blocked = await upload(thirdUrl); assert.equal(blocked.statusCode, 429); assert.equal(blocked.json().code, 'UPLOAD_BUSY');
      assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM conversation_attachments WHERE id IN ($1,$2) AND status=\'VALIDATING\'', [firstId, secondId])).rows[0].n, 0, 'Both requests are still waiting before parsing/validation');
      gates.get(firstUrl)!.release.resolve(); assert.equal((await first).statusCode, 200);
      assert.equal((await upload(thirdUrl)).statusCode, 200);
      gates.get(secondUrl)!.release.resolve(); assert.equal((await second).statusCode, 413);
      assert.equal((await upload(`/staff/${conversation}/files/${fourthId}`)).statusCode, 200);
    } finally { for (const gate of gates.values()) gate.release.resolve(); await Promise.allSettled([first, second]); await app.close(); }
  });
});
