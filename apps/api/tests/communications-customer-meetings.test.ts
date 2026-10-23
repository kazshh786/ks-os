import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ClientCollaboration } from '../src/modules/communications/communications.client-collaboration.js';
import { ClientMeetings } from '../src/modules/communications/communications.client-meetings.js';
import { CommunicationsMeetings } from '../src/modules/communications/communications.meetings.js';
import { collaborationInvitationToken } from '../src/modules/communications/communications.collaboration-secrets.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';
import { ClientMeetingTestMedia, clientMeetingEnvironment, mediaClaims } from './helpers/client-meetings-media.js';

test('customer collaboration: scheduled meeting grants, admission and media revocation', { timeout: 180000 }, async t => {
  Object.assign(process.env, clientMeetingEnvironment, { CUSTOMER_COLLABORATION_SECRET: 'isolated-customer-collaboration-meeting-secret-2026', PUBLIC_CUSTOMER_PORTAL_ORIGIN: 'http://127.0.0.1:5173' });
  const f = await createClientMeetingFixture(t), media = new ClientMeetingTestMedia(), meetings = new ClientMeetings(f.db, media), reconcile = new CommunicationsMeetings(f.db, media);
  const collaboration = new ClientCollaboration(f.db, { meetings, verifyEmail: async () => {} });
  const contact = await f.seedCustomer('meeting-contact@example.test', 'Verified Contact');
  const stranger = await f.seedCustomer('meeting-stranger@example.test', 'Other Contact');
  const clientB = randomUUID(); await f.pg.query('INSERT INTO clients(id,tenant_id,name) VALUES($1,$2,$3)', [clientB, f.owner.tenantId, 'Other customer']);
  const createChannel = (clientId = f.customer.id) => collaboration.create(f.owner, { clientId, name: 'Shared customer meeting', staffUserIds: [], requestId: randomUUID() });
  const accept = async (channelId: string, person = contact) => {
    const invite = await collaboration.invite(f.owner, channelId, { email: person.identity.email, requestId: randomUUID() });
    const handoff = await collaboration.handoff(collaborationInvitationToken(invite.id));
    const accepted = await collaboration.accept(person.identity, handoff.credential);
    return collaboration.actor(person.identity, accepted.relationshipId);
  };
  const createMeeting = (clientId = f.customer.id) => meetings.create(f.owner, { requestId: randomUUID(), title: 'Customer consultation', description: 'Shared agenda', audience: 'EXTERNAL_CLIENT', type: 'VIDEO', localStart: f.startsAt, timezone: 'UTC', durationMinutes: 60, hostUserId: f.owner.userId, customerId: clientId, attendeeIds: [], cohostIds: [], guestScreenShare: false });
  const prepare = async () => {
    const channel = await createChannel(), actor = await accept(channel.id), meeting = await createMeeting();
    await meetings.grantCustomerChannel(f.owner, channel.id, meeting.id); await meetings.start(f.owner, meeting.id);
    const admission = await meetings.requestCustomer(actor, meeting.id, channel.id, randomUUID());
    return { channel, actor, meeting, admission };
  };
  const join = (p: Awaited<ReturnType<typeof prepare>>) => meetings.customerGuestSession(p.actor, p.meeting.id, p.admission.sessionId, p.admission.credential, 'join', randomUUID());
  t.beforeEach(async () => { media.liveRooms.clear(); media.issued.length = 0; media.removals.length = 0; await f.pg.exec('TRUNCATE communication_meetings CASCADE'); });

  await t.test('same-customer association alone never grants meeting discovery or joining', async () => {
    const c = await createChannel(), actor = await accept(c.id), own = await createMeeting(), other = await createMeeting(clientB);
    assert.equal((await meetings.customerList(actor)).data.length, 0);
    await assert.rejects(meetings.requestCustomer(actor, own.id, c.id, randomUUID()));
    await assert.rejects(meetings.grantCustomerChannel(f.owner, c.id, other.id));
    await assert.rejects(meetings.grantCustomerChannel(f.other, c.id, own.id));
    await meetings.grantCustomerChannel(f.owner, c.id, own.id);
    const listed = (await meetings.customerList(actor)).data; assert.deepEqual(listed.map(m => m.id), [own.id]);
    const json = JSON.stringify(listed); for (const secret of ['private@example.test', 'medical_notes', 'provider_room_name', 'auth_user_id']) assert.ok(!json.includes(secret));
  });

  await t.test('verified customer requests still wait for the host and cannot use anonymous guest endpoints', async () => {
    const p = await prepare(); assert.equal(p.admission.state, 'WAITING'); assert.equal(media.issued.length, 0);
    await assert.rejects(join(p));
    const waiting = await meetings.waiting(f.owner, p.meeting.id); assert.equal(waiting.data[0].verifiedCustomer, true); assert.equal(waiting.data[0].name, 'Verified Contact');
    await assert.rejects(meetings.guestState(p.admission.sessionId, p.admission.credential));
    await assert.rejects(meetings.guestJoin(p.admission.sessionId, p.admission.credential, randomUUID()));
    await assert.rejects(meetings.guestLeave(p.admission.sessionId, p.admission.credential));
    const alienChannel = await createChannel(clientB), alien = await accept(alienChannel.id, stranger);
    await assert.rejects(meetings.customerGuestSession(alien, p.meeting.id, p.admission.sessionId, p.admission.credential, 'state'));
    await assert.rejects(meetings.customerGuestSession(p.actor, p.meeting.id, p.admission.sessionId, 'invalid-credential', 'state'));
  });

  await t.test('admitted customer receives only the authorized room token and optional media permissions', async () => {
    const p = await prepare(); await meetings.admit(f.owner, p.meeting.id, p.admission.sessionId, true);
    const joined = await join(p) as { token: string; identity: string; sessionId: string };
    const claims = await mediaClaims(joined.token), row = (await f.pg.query<{ provider_room_name: string }>('SELECT provider_room_name FROM communication_meetings WHERE id=$1', [p.meeting.id])).rows[0];
    assert.equal(claims.video?.room, row.provider_room_name); assert.equal(claims.video?.roomJoin, true); assert.notEqual(claims.video?.roomAdmin, true);
    assert.deepEqual(claims.video?.canPublishSources?.slice().sort(), ['camera', 'microphone']); assert.notEqual(joined.identity, p.actor.userId); assert.ok(joined.identity.startsWith('ksos_'));
    media.observeJoin(row.provider_room_name, joined.identity); await reconcile.reconcile();
    assert.equal((await meetings.get(f.owner, p.meeting.id)).status, 'ACTIVE');
    await meetings.customerGuestSession(p.actor, p.meeting.id, p.admission.sessionId, p.admission.credential, 'leave');
    assert.ok(media.removals.includes(joined.identity)); await assert.rejects(join(p));
  });

  await t.test('revoking the channel grant disconnects existing media and blocks credential reuse', async () => {
    const p = await prepare(); await meetings.admit(f.owner, p.meeting.id, p.admission.sessionId, true);
    const joined = await join(p) as { token: string; identity: string };
    const claims = await mediaClaims(joined.token); media.observeJoin(claims.video!.room!, joined.identity); await reconcile.reconcile();
    await meetings.revokeCustomerGrant(f.owner, p.channel.id, p.meeting.id);
    assert.ok(media.removals.includes(joined.identity)); assert.equal((await meetings.customerList(p.actor)).data.length, 0);
    await assert.rejects(join(p)); await assert.rejects(meetings.requestCustomer(p.actor, p.meeting.id, p.channel.id, randomUUID()));
    const state = (await f.pg.query('SELECT revoked_at FROM communication_meeting_guests WHERE id=$1', [p.admission.sessionId])).rows[0]; assert.ok(state.revoked_at);
  });

  await t.test('provider logout is enforced during reconciliation and later host admission', async () => {
    const p = await prepare(); await meetings.admit(f.owner, p.meeting.id, p.admission.sessionId, true);
    const joined = await join(p) as { token: string; identity: string };
    const claims = await mediaClaims(joined.token); media.observeJoin(claims.video!.room!, joined.identity); await reconcile.reconcile();
    await f.pg.query('DELETE FROM auth.sessions WHERE id=$1', [contact.identity.sessionId]); await reconcile.reconcile();
    assert.ok(media.removals.includes(joined.identity)); await assert.rejects(join(p));
    await assert.rejects(meetings.admit(f.owner, p.meeting.id, p.admission.sessionId, true));
    await f.pg.query('INSERT INTO auth.sessions(id,user_id,not_after) VALUES($1,$2,$3)', [contact.identity.sessionId, contact.identity.authUserId, contact.identity.expiresAt]);
  });

  await t.test('channel membership removal disconnects only that customer and leaves internal host access intact', async () => {
    const p = await prepare(); await meetings.admit(f.owner, p.meeting.id, p.admission.sessionId, true);
    const joined = await join(p) as { token: string; identity: string };
    const claims = await mediaClaims(joined.token); media.observeJoin(claims.video!.room!, joined.identity); await reconcile.reconcile();
    await collaboration.removeContact(f.owner, p.channel.id, p.actor.userId);
    assert.ok(media.removals.includes(joined.identity)); await assert.rejects(join(p));
    assert.equal((await meetings.get(f.owner, p.meeting.id)).id, p.meeting.id);
    assert.equal((await f.pg.query('SELECT user_id FROM communication_meeting_participants WHERE id=(SELECT participant_id FROM communication_meeting_guests WHERE id=$1)', [p.admission.sessionId])).rows[0].user_id, null);
  });
});
