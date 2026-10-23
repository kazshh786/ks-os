import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ClientCollaboration } from '../src/modules/communications/communications.client-collaboration.js';
import { ClientMeetings } from '../src/modules/communications/communications.client-meetings.js';
import { collaborationInvitationToken } from '../src/modules/communications/communications.collaboration-secrets.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';
import { ClientMeetingTestMedia } from './helpers/client-meetings-media.js';

// This reuses the dedicated CI-only PostgreSQL service, never DATABASE_URL.
const postgresUrl = process.env.CLIENT_MEETINGS_TEST_DATABASE_URL;
test('customer collaboration: real PostgreSQL invitation and revocation races', { skip: !postgresUrl, timeout: 180000 }, async t => {
  process.env.CUSTOMER_COLLABORATION_SECRET = 'isolated-customer-collaboration-test-secret-2026';
  process.env.PUBLIC_CUSTOMER_PORTAL_ORIGIN = 'http://127.0.0.1:5173';
  const f = await createClientMeetingFixture(t, { postgresUrl });
  const options = { verifyEmail: async () => {}, meetings: new ClientMeetings(f.db, new ClientMeetingTestMedia()) };
  const first = new ClientCollaboration(f.db, options), second = new ClientCollaboration(f.db, options);
  const contact = await f.seedCustomer('race-contact@example.test'), wrong = await f.seedCustomer('other-contact@example.test');
  const channel = (owner = f.owner, client = f.customer.id) => first.create(owner, { clientId: client, name: `Shared work ${randomUUID()}`, staffUserIds: [], requestId: randomUUID() });
  const invite = async (id: string) => {
    const invitation = await first.invite(f.owner, id, { email: contact.identity.email, requestId: randomUUID() });
    const handoff = await first.handoff(collaborationInvitationToken(invitation.id));
    return { invitation, handoff };
  };

  await t.test('concurrent channel and invitation retries create one resource and one email job', async () => {
    const input = { clientId: f.customer.id, name: 'Idempotent customer channel', staffUserIds: [], requestId: randomUUID() };
    const [a, b] = await Promise.all([first.create(f.owner, input), second.create(f.owner, input)]);
    assert.equal(a.id, b.id);
    const request = { email: contact.identity.email, requestId: randomUUID() };
    const [one, two] = await Promise.all([first.invite(f.owner, a.id, request), second.invite(f.owner, a.id, request)]);
    assert.equal(one.id, two.id);
    assert.equal((await f.pg.query('SELECT id FROM customer_collaboration_invitations WHERE id=$1', [one.id])).rows.length, 1);
    assert.equal((await f.pg.query('SELECT id FROM email_outbox WHERE idempotency_key=$1', [`customer-collaboration:${one.id}`])).rows.length, 1);
    await assert.rejects(second.create(f.owner, { ...input, name: 'Different request' }), { code: 'RETRY_CONFLICT' });
  });

  await t.test('two handoffs for one invitation accept once and return the same active grant', async () => {
    const c = await channel(), { invitation, handoff } = await invite(c.id);
    const another = await second.handoff(collaborationInvitationToken(invitation.id));
    const [a, b] = await Promise.all([first.accept(contact.identity, handoff.credential), second.accept(contact.identity, another.credential)]);
    assert.deepEqual(a, b);
    assert.equal((await f.pg.query('SELECT id FROM conversation_members WHERE conversation_id=$1 AND customer_relationship_id=$2', [c.id, a.relationshipId])).rows.length, 1);
    assert.equal((await f.pg.query('SELECT id FROM customer_collaboration_handoffs WHERE invitation_id=$1 AND consumed_at IS NOT NULL', [invitation.id])).rows.length, 2);
    assert.equal((await f.pg.query('SELECT id FROM customer_client_links')).rows.length, 0);
  });

  await t.test('a different verified account cannot win an invitation race', async () => {
    const c = await channel(), { handoff } = await invite(c.id);
    const [good, bad] = await Promise.allSettled([first.accept(contact.identity, handoff.credential), second.accept(wrong.identity, handoff.credential)]);
    assert.equal(good.status, 'fulfilled'); assert.equal(bad.status, 'rejected');
    assert.equal((await f.pg.query('SELECT id FROM customer_collaboration_relationships WHERE customer_account_id=$1', [wrong.accountId])).rows.length, 0);
  });

  await t.test('revocation racing consumed invitation replay never restores membership', async () => {
    const c = await channel(), { handoff } = await invite(c.id), accepted = await first.accept(contact.identity, handoff.credential);
    const results = await Promise.allSettled([first.revokeRelationship(f.owner, accepted.relationshipId), second.accept(contact.identity, handoff.credential)]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal((await f.pg.query('SELECT status FROM customer_collaboration_relationships WHERE id=$1', [accepted.relationshipId])).rows[0].status, 'REVOKED');
    assert.ok((await f.pg.query('SELECT left_at FROM conversation_members WHERE conversation_id=$1 AND customer_relationship_id=$2', [c.id, accepted.relationshipId])).rows[0].left_at);
    await assert.rejects(first.actor(contact.identity, accepted.relationshipId));
    await assert.rejects(second.accept(contact.identity, handoff.credential));
  });

  await t.test('two businesses can independently invite one identity without sharing membership', async () => {
    const a = await channel(), b = await channel(f.other, f.otherCustomer.id);
    const invitations = await Promise.all([first.invite(f.owner, a.id, { email: contact.identity.email, requestId: randomUUID() }), second.invite(f.other, b.id, { email: contact.identity.email, requestId: randomUUID() })]);
    const handoffs = await Promise.all(invitations.map(i => first.handoff(collaborationInvitationToken(i.id))));
    const accepted = await Promise.all(handoffs.map(h => first.accept(contact.identity, h.credential)));
    assert.notEqual(accepted[0].relationshipId, accepted[1].relationshipId);
    const actors = await Promise.all(accepted.map(a => first.actor(contact.identity, a.relationshipId)));
    assert.deepEqual(new Set(actors.map(a => a.tenantId)), new Set([f.owner.tenantId, f.other.tenantId]));
    await assert.rejects(first.addContact(f.owner, a.id, accepted[1].relationshipId));
    await first.revokeRelationship(f.owner, accepted[0].relationshipId);
    await first.actor(contact.identity, accepted[1].relationshipId);
  });

  await t.test('concurrent native author retries persist a single canonical message', async () => {
    const c = await channel(), { handoff } = await invite(c.id), accepted = await first.accept(contact.identity, handoff.credential), retry = randomUUID();
    const insert = () => f.pg.query("INSERT INTO conversation_messages(tenant_id,conversation_id,channel_type,direction,sender_type,sender_customer_relationship_id,sender_name,body,status,native_position,client_message_id) VALUES($1,$2,'NATIVE','INTERNAL','CUSTOMER',$3,'Contact','One message','SENT',nextval('native_message_position_seq'),$4)", [f.owner.tenantId, c.id, accepted.relationshipId, retry]);
    const results = await Promise.allSettled([insert(), insert()]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, '23505');
    assert.equal((await f.pg.query('SELECT id FROM conversation_messages WHERE conversation_id=$1 AND client_message_id=$2', [c.id, retry])).rows.length, 1);
  });
});
