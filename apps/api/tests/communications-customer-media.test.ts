import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ClientCollaboration } from '../src/modules/communications/communications.client-collaboration.js';
import { ClientMeetings } from '../src/modules/communications/communications.client-meetings.js';
import { CommunicationsMeetings } from '../src/modules/communications/communications.meetings.js';
import { LiveKitProvider } from '../src/modules/communications/communications.livekit.js';
import { collaborationInvitationToken } from '../src/modules/communications/communications.collaboration-secrets.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';
import { clientMeetingEnvironment, mediaEnvironment, mediaClaims } from './helpers/client-meetings-media.js';
import { verifyClientMeetingMedia } from './helpers/client-meetings-media-browser.mjs';

test('customer collaboration: real media for separate customers and businesses', { skip: process.env.COMMUNICATIONS_MEDIA_TEST !== '1', timeout: 300000 }, async t => {
  assert.equal(process.env.LIVEKIT_URL, mediaEnvironment.LIVEKIT_URL);
  assert.equal(process.env.LIVEKIT_API_URL, mediaEnvironment.LIVEKIT_API_URL);
  assert.equal(process.env.LIVEKIT_API_KEY, mediaEnvironment.LIVEKIT_API_KEY);
  assert.equal(process.env.LIVEKIT_API_SECRET, mediaEnvironment.LIVEKIT_API_SECRET);
  Object.assign(process.env, clientMeetingEnvironment, { CUSTOMER_COLLABORATION_SECRET: 'isolated-customer-collaboration-real-media-secret-2026', PUBLIC_CUSTOMER_PORTAL_ORIGIN: 'http://127.0.0.1:5173' });
  const f = await createClientMeetingFixture(t), provider = new LiveKitProvider(mediaEnvironment), service = new ClientMeetings(f.db, provider), observer = new CommunicationsMeetings(f.db, provider);
  const collaboration = new ClientCollaboration(f.db, { meetings: service, verifyEmail: async () => {} });
  const firstContact = await f.seedCustomer('media-contact@example.test', 'Verified customer A'), secondContact = await f.seedCustomer('media-other@example.test', 'Verified customer B');
  const secondClient = randomUUID(); await f.pg.query('INSERT INTO clients(id,tenant_id,name) VALUES($1,$2,$3)', [secondClient, f.owner.tenantId, 'Separate customer in the same business']);
  const cases = [];
  for (const [index, entry] of [
    { actor: f.owner, client: f.customer.id, contact: firstContact },
    { actor: f.owner, client: secondClient, contact: secondContact },
    { actor: f.other, client: f.otherCustomer.id, contact: firstContact },
  ].entries()) {
    const { actor, client, contact } = entry;
    const channel = await collaboration.create(actor, { clientId: client, name: `Customer media channel ${index + 1}`, staffUserIds: [], requestId: randomUUID() });
    const invitation = await collaboration.invite(actor, channel.id, { email: contact.identity.email, requestId: randomUUID() });
    const handoff = await collaboration.handoff(collaborationInvitationToken(invitation.id)), accepted = await collaboration.accept(contact.identity, handoff.credential), customer = await collaboration.actor(contact.identity, accepted.relationshipId);
    const m = await service.create(actor, { requestId: randomUUID(), title: `Isolated customer collaboration ${index + 1}`, audience: 'EXTERNAL_CLIENT', customerId: client, type: 'VIDEO', localStart: f.startsAt, timezone: 'UTC', durationMinutes: 60, hostUserId: actor.userId, attendeeIds: [], cohostIds: [], guestScreenShare: index === 1 });
    await service.grantCustomerChannel(actor, channel.id, m.id); await service.start(actor, m.id);
    const waiting = await service.requestCustomer(customer, m.id, channel.id, randomUUID());
    await assert.rejects(service.customerGuestSession(customer, m.id, waiting.sessionId, waiting.credential, 'join', randomUUID()));
    await service.admit(actor, m.id, waiting.sessionId, true);
    const host = await service.join(actor, m.id, randomUUID()), guest = await service.customerGuestSession(customer, m.id, waiting.sessionId, waiting.credential, 'join', randomUUID()) as { token: string; url: string; identity: string };
    const participant = (await f.pg.query<{ id: string }>('SELECT participant_id AS id FROM communication_meeting_guests WHERE id=$1', [waiting.sessionId])).rows[0];
    cases.push({ tenantId: actor.tenantId, actor, customer, channelId: channel.id, meetingId: m.id, room: (await mediaClaims(host.token)).video!.room!, host, guest, waiting, participantId: participant.id });
  }
  assert.equal(cases[0].customer.customerAccountId, cases[2].customer.customerAccountId);
  assert.notEqual(cases[0].customer.userId, cases[2].customer.userId);
  for (const [index, item] of cases.entries()) {
    assert.deepEqual((await service.customerList(item.customer)).data.map(m => m.id), [item.meetingId]);
    const other = cases[(index + 1) % cases.length];
    await assert.rejects(service.requestCustomer(item.customer, other.meetingId, other.channelId, randomUUID()));
    await assert.rejects(service.guestJoin(item.waiting.sessionId, item.waiting.credential, randomUUID()));
  }
  const summary = await verifyClientMeetingMedia({ cases, provider, artifactDirectory: 'customer-collaboration-media', accessLabel: 'Verified customer channel grant',
    reconcile: () => observer.reconcile(),
    removeGuest: item => service.remove(item.actor, item.meetingId, item.participantId),
    revokeInvitation: item => service.revokeCustomerGrant(item.actor, item.channelId, item.meetingId),
    freshGuestJoin: item => service.customerGuestSession(item.customer, item.meetingId, item.waiting.sessionId, item.waiting.credential, 'join', randomUUID()),
    end: item => service.end(item.actor, item.meetingId),
  });
  assert.equal(summary.evidence.length, 6);
});
