import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ClientMeetings } from '../src/modules/communications/communications.client-meetings.js';
import { CommunicationsMeetings } from '../src/modules/communications/communications.meetings.js';
import { CommunicationsService } from '../src/modules/communications/communications.service.js';
import { invitationToken, secretHash } from '../src/modules/communications/communications.meeting-secrets.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';
import { ClientMeetingTestMedia, clientMeetingEnvironment, mediaClaims, signedMediaEvent } from './helpers/client-meetings-media.js';

test('client meetings: tenant security, schedules, invitations, admission and reconciliation', { timeout: 240000 }, async t => {
  Object.assign(process.env, clientMeetingEnvironment);
  const f = await createClientMeetingFixture(t), provider = new ClientMeetingTestMedia();
  const service = new ClientMeetings(f.db, provider);
  const legacy = new CommunicationsMeetings(f.db, provider);
  const input = (actor = f.owner, extra = {}) => ({ requestId: randomUUID(), title: 'Private consultation', description: 'Meeting description', audience: 'EXTERNAL_CLIENT' as const,
    type: 'VIDEO' as const, localStart: f.startsAt, timezone: 'UTC', durationMinutes: 60, hostUserId: actor.userId,
    attendeeIds: [], cohostIds: [], guestScreenShare: false, ...extra });
  const create = (actor = f.owner, extra = {}) => service.create(actor, input(actor, extra));
  const edit = (version: number, actor = f.owner, extra = {}) => { const {requestId,...fields}=input(actor,extra); return {...fields,version}; };
  const invite = async (meetingId: string, actor = f.owner, extra = {}) => {
    const invitation = await service.invite(actor, meetingId, { requestId: randomUUID(), ...extra });
    return { ...invitation, token: invitationToken(invitation.id) };
  };
  const request = async (meetingId: string, actor = f.owner, name = 'External guest') => {
    const invitation = await invite(meetingId, actor);
    const guest = await service.requestGuest({ invitationToken: invitation.token, name, requestId: randomUUID() });
    return { invitation, guest };
  };
  const capacity = async (tenantId: string, key: string, limit: number) => f.pg.query("INSERT INTO tenant_entitlement_overrides(tenant_id,entitlement_key,value_json,starts_at,expires_at) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 day')", [tenantId,key,JSON.stringify({limit})]);
  t.beforeEach(async () => {
    provider.liveRooms.clear(); provider.removals.length = 0; provider.issued.length = 0; provider.unavailable = false;
    await f.pg.exec('TRUNCATE communication_meetings CASCADE; TRUNCATE tenant_plan_assignments,platform_plan_entitlements,tenant_entitlement_overrides,email_outbox; TRUNCATE internal_notifications CASCADE;');
  });

  await t.test('guest and invitation records are API-only with database-enforced tenant references', async () => {
    for (const table of ['communication_meeting_invitations','communication_meeting_guests']) {
      assert.equal((await f.pg.query<{enabled:boolean}>('SELECT relrowsecurity AS enabled FROM pg_class WHERE relname=$1',[table])).rows[0].enabled,true);
      for (const role of ['anon','authenticated']) for (const operation of ['SELECT','INSERT','UPDATE','DELETE']) assert.equal((await f.pg.query<{allowed:boolean}>('SELECT has_table_privilege($1,$2,$3) AS allowed',[role,table,operation])).rows[0].allowed,false);
    }
    const m = await create();
    await assert.rejects(f.pg.query('UPDATE communication_meetings SET host_user_id=$1 WHERE id=$2',[f.other.userId,m.id]));
    await assert.rejects(f.pg.query('UPDATE communication_meetings SET customer_id=$1 WHERE id=$2',[f.otherCustomer.id,m.id]));
    await assert.rejects(f.pg.query('UPDATE communication_meetings SET appointment_id=$1 WHERE id=$2',[f.otherAppointment.id,m.id]));
  });

  await t.test('every organisation schedules independently and cannot inspect or mutate another organisation', async () => {
    const a = await create(), b = await create(f.other);
    for (const [actor, foreign] of [[f.owner,b],[f.other,a]] as const) {
      await assert.rejects(service.get(actor,foreign.id),{statusCode:404});
      await assert.rejects(service.update(actor,foreign.id,edit(1,actor)),{statusCode:404});
      await assert.rejects(service.cancel(actor,foreign.id),{statusCode:404});
      await assert.rejects(service.start(actor,foreign.id),{statusCode:404});
      await assert.rejects(service.join(actor,foreign.id,randomUUID()),{statusCode:404});
      await assert.rejects(service.invite(actor,foreign.id,{requestId:randomUUID()}),{statusCode:404});
      await assert.rejects(service.waiting(actor,foreign.id),{statusCode:404});
      assert.ok(!(await service.list(actor,{})).data.some(item => item.id===foreign.id));
    }
    assert.equal((await service.get(f.owner,a.id)).status,'SCHEDULED');
    assert.equal((await service.get(f.other,b.id)).status,'SCHEDULED');
    assert.equal(provider.liveRooms.size,0,'Scheduling must not create a LiveKit room');
  });

  await t.test('central operational administration cannot obtain tenant attendance rights', async () => {
    const m = await create();
    await assert.rejects(service.get(f.central,m.id));
    await assert.rejects(service.join(f.central,m.id,randomUUID()));
    await assert.rejects(service.create({...f.central,tenantId:f.owner.tenantId},input()));
    assert.equal(provider.issued.length,0);
  });

  await t.test('staff attendance and management remain separate from organisation administration', async () => {
    const m = await create(f.host,{attendeeIds:[f.attendee.userId]});
    await assert.rejects(service.get(f.outsider,m.id));
    await assert.rejects(service.start(f.attendee,m.id));
    await assert.rejects(service.invite(f.attendee,m.id,{requestId:randomUUID()}));
    await service.start(f.host,m.id);
    await service.join(f.attendee,m.id,randomUUID());
    // The organisation owner may administer a staff meeting, but is not an invited participant.
    await assert.rejects(service.join(f.owner,m.id,randomUUID()));
    await service.end(f.host,m.id);
  });

  await t.test('cohosts can admit guests but ordinary attendees cannot', async () => {
    const m = await create(f.owner,{cohostIds:[f.host.userId],attendeeIds:[f.attendee.userId]});
    await service.start(f.owner,m.id);
    const {guest} = await request(m.id);
    await assert.rejects(service.admit(f.attendee,m.id,guest.sessionId,true));
    await service.admit(f.host,m.id,guest.sessionId,true);
    assert.equal((await service.guestState(guest.sessionId,guest.credential)).state,'APPROVED');
  });

  await t.test('creation retries are idempotent and reject conflicting payloads', async () => {
    const body=input(), first=await service.create(f.owner,body), retry=await service.create(f.owner,body);
    assert.equal(retry.id,first.id);
    assert.equal((await f.pg.query('SELECT id FROM communication_meetings')).rows.length,1);
    await assert.rejects(service.create(f.owner,{...body,title:'Different intent'}),{statusCode:409});
    await assert.rejects(service.create(f.owner,{...body,durationMinutes:90}),{statusCode:409});
  });

  await t.test('customer, appointment, host and internal attendee references are tenant-validated', async () => {
    const config=await service.config(f.owner,{customerReference:f.customer.reference});
    assert.deepEqual(config.appointments.map(item=>({id:item.id,customerId:item.customerId,hostUserId:item.hostUserId})),[{id:f.appointment.id,customerId:f.customer.id,hostUserId:f.host.userId}]);
    assert.ok(config.hosts.every(item=>![f.other.userId,f.otherStaff.userId].includes(item.id)));
    assert.ok(config.customers.every(item=>item.id!==f.otherCustomer.id));
    await assert.rejects(service.config(f.owner,{customerReference:f.otherCustomer.reference}),{statusCode:404});
    for (const extra of [{customerId:f.otherCustomer.id},{hostUserId:f.other.userId},{attendeeIds:[f.other.userId]},{cohostIds:[f.other.userId]},{customerId:f.customer.id,appointmentId:f.otherAppointment.id}]) await assert.rejects(create(f.owner,extra));
    const linked = await create(f.owner,{customerId:f.customer.id,appointmentId:f.appointment.id,hostUserId:f.host.userId});
    assert.equal(linked.customerId,f.customer.id); assert.equal(linked.appointmentId,f.appointment.id);
    assert.equal((await create(f.owner,{customerId:f.customer.id,appointmentId:f.appointment.id,hostUserId:f.host.userId})).id,linked.id);
    assert.ok((await service.list(f.owner,{customerId:f.customer.id})).data.some(item=>item.id===linked.id));
    assert.equal((await service.list(f.other,{customerId:f.customer.id})).data.length,0);
  });

  await t.test('UTC schedule persistence resolves UK daylight saving and keeps an optimistic version', async () => {
    const year=new Date().getUTCFullYear(),summer=year+(Date.now()>=Date.UTC(year,6,1,10,30)?1:0),winter=year+(Date.now()>=Date.UTC(year,0,1,10,30)?1:0);
    const m = await create(f.owner,{localStart:`${summer}-07-01T10:30`,timezone:'Europe/London',durationMinutes:45});
    assert.equal(new Date(m.scheduledStartAt).toISOString(),`${summer}-07-01T09:30:00.000Z`);
    assert.equal(new Date(m.scheduledEndAt).toISOString(),`${summer}-07-01T10:15:00.000Z`);
    const changed = await service.update(f.owner,m.id,edit(m.version,f.owner,{localStart:`${winter}-01-01T10:30`,timezone:'Europe/London',durationMinutes:45}));
    assert.equal(new Date(changed.scheduledStartAt).toISOString(),`${winter}-01-01T10:30:00.000Z`);
    assert.ok(changed.version>m.version);
    await assert.rejects(service.update(f.owner,m.id,edit(m.version)),{statusCode:409});
    for (const localStart of ['2027-03-28T01:30','2027-10-31T01:30']) await assert.rejects(create(f.owner,{localStart,timezone:'Europe/London'}),{statusCode:400});
    await assert.rejects(create(f.owner,{localStart:'2020-01-01T12:00',timezone:'UTC'}),{statusCode:400});
  });

  await t.test('start and token issuance do not invent attendance; provider observations activate the meeting', async () => {
    const m=await create(); await service.start(f.owner,m.id);
    const connection=await service.join(f.owner,m.id,randomUUID()), claims=await mediaClaims(connection.token), room=claims.video!.room!;
    const ready=await service.get(f.owner,m.id); assert.notEqual(ready.status,'ACTIVE'); assert.equal(ready.startedAt,null);
    const event=await signedMediaEvent({event:'participant_joined',...provider.observeJoin(room,connection.identity)});
    await legacy.webhook(event.body,event.authorization);
    const active=await service.get(f.owner,m.id);assert.equal(active.status,'ACTIVE');assert.ok(active.startedAt);
    await legacy.webhook(event.body,event.authorization);
    assert.equal((await f.pg.query('SELECT id FROM communication_meeting_webhooks WHERE id=$1',[JSON.parse(event.body).id])).rows.length,1);
  });

  await t.test('valid invitation resolves only public branding and never exposes private CRM or room identifiers', async () => {
    const m=await create(f.owner,{customerId:f.customer.id}), invitation=await invite(m.id);
    const publicView=await service.resolve(invitation.token), text=JSON.stringify(publicView);
    assert.match(text,/Business Alpha/);assert.doesNotMatch(text,/Business Beta|private@example|07000000000|medical|Never expose/);
    for (const value of [f.customer.id,f.customer.reference,f.owner.authUserId,f.owner.sessionId]) assert.ok(!text.includes(value));
    const row=(await f.pg.query<{room:string;hash:string}>('SELECT m.provider_room_name AS room,i.secret_hash AS hash FROM communication_meetings m JOIN communication_meeting_invitations i ON i.meeting_id=m.id WHERE i.id=$1',[invitation.id])).rows[0];
    assert.equal(row.hash,secretHash(invitation.token)); assert.ok(!text.includes(row.room));
    assert.ok(!invitation.url.includes(row.room)); assert.ok(!invitation.url.includes(m.id));
    assert.equal(new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('invite'),invitation.token);
    assert.equal(provider.issued.length,0);
  });

  await t.test('invalid, expired, revoked and cancelled invitations cannot create a waiting session', async () => {
    const m=await create(), invitation=await invite(m.id);
    await assert.rejects(service.resolve(`${invitation.token.slice(0,-1)}!`));
    await assert.rejects(service.resolve(invitationToken(randomUUID())));
    await f.pg.query("UPDATE communication_meeting_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",[invitation.id]);
    await assert.rejects(service.requestGuest({invitationToken:invitation.token,name:'Guest',requestId:randomUUID()}));
    const next=await invite(m.id);await service.revokeInvitation(f.owner,m.id,next.id);
    await assert.rejects(service.resolve(next.token));
    const cancelled=await invite(m.id);await service.cancel(f.owner,m.id);
    await assert.rejects(service.requestGuest({invitationToken:cancelled.token,name:'Guest',requestId:randomUUID()}));
    assert.equal((await f.pg.query('SELECT id FROM communication_meeting_guests')).rows.length,0);
  });

  await t.test('invitation retries and guest refresh are idempotent, while a second claimant cannot reuse the link', async () => {
    const m=await create(), requestId=randomUUID();
    const first=await service.invite(f.owner,m.id,{requestId}), retry=await service.invite(f.owner,m.id,{requestId});
    assert.equal(first.id,retry.id); assert.equal(first.url,retry.url);
    const body={invitationToken:invitationToken(first.id),name:'Guest with access',requestId:randomUUID()};
    const guest=await service.requestGuest(body), again=await service.requestGuest(body);
    assert.equal(again.sessionId,guest.sessionId); assert.equal(again.credential,guest.credential);
    assert.equal((await service.guestState(guest.sessionId,guest.credential)).state,'WAITING');
    await assert.rejects(service.requestGuest({...body,requestId:randomUUID(),name:'Second claimant'}));
    await assert.rejects(service.guestState(guest.sessionId,'invalid-session-credential'));
    assert.equal((await f.pg.query('SELECT id FROM communication_meeting_guests')).rows.length,1);
    const saved=(await f.pg.query<{hash:string}>('SELECT credential_hash AS hash FROM communication_meeting_guests WHERE id=$1',[guest.sessionId])).rows[0];
    assert.equal(saved.hash,secretHash(guest.credential)); assert.notEqual(saved.hash,guest.credential);
  });

  await t.test('waiting guests cannot obtain tokens, admit themselves or inspect another meeting session', async () => {
    const a=await create(), b=await create(f.other);await service.start(f.owner,a.id);await service.start(f.other,b.id);
    const first=await request(a.id), second=await request(b.id,f.other);
    await assert.rejects(service.guestJoin(first.guest.sessionId,first.guest.credential,randomUUID()));
    await assert.rejects(service.guestState(second.guest.sessionId,first.guest.credential));
    await assert.rejects(service.admit(f.other,a.id,first.guest.sessionId,true),{statusCode:404});
    await assert.rejects(service.admit(f.owner,a.id,second.guest.sessionId,true));
    await assert.rejects(service.admit(f.outsider,a.id,first.guest.sessionId,true));
    assert.equal(provider.issued.length,0);
    const waiting=await service.waiting(f.owner,a.id);assert.ok(JSON.stringify(waiting).includes(first.guest.sessionId));assert.ok(!JSON.stringify(waiting).includes(second.guest.sessionId));
  });

  await t.test('admission creates a unique room-scoped guest identity with no administration or unapproved screen grant', async () => {
    const m=await create();await service.start(f.owner,m.id);const {guest}=await request(m.id);
    await service.admit(f.owner,m.id,guest.sessionId,true);await service.admit(f.owner,m.id,guest.sessionId,true);
    const requestId=randomUUID(), joined=await service.guestJoin(guest.sessionId,guest.credential,requestId), retry=await service.guestJoin(guest.sessionId,guest.credential,requestId);
    assert.equal(joined.sessionId,retry.sessionId);assert.equal(joined.identity,retry.identity);
    const claims=await mediaClaims(joined.token), payload=JSON.parse(Buffer.from(joined.token.split('.')[1],'base64url').toString());
    assert.equal(claims.sub,joined.identity);assert.equal(claims.video?.roomJoin,true);assert.equal(claims.video?.canPublishData,false);
    for (const key of ['roomAdmin','roomCreate','roomList','roomRecord']) assert.notEqual(claims.video?.[key],true);
    assert.ok(payload.exp<=Date.now()/1000+61);assert.ok(!joined.identity.includes('Guest'));assert.notEqual(claims.video?.room,m.id);
    assert.deepEqual(claims.video?.canPublishSources?.slice().sort(),['camera','microphone']);
    const second=await request(m.id,f.owner,'Other guest');await service.admit(f.owner,m.id,second.guest.sessionId,true);
    const other=await service.guestJoin(second.guest.sessionId,second.guest.credential,randomUUID());assert.notEqual(other.identity,joined.identity);
  });

  await t.test('denial, removal and invitation revocation prevent fresh tokens and evict media', async () => {
    const m=await create();await service.start(f.owner,m.id);
    const denied=await request(m.id);await service.admit(f.owner,m.id,denied.guest.sessionId,false);
    await assert.rejects(service.guestJoin(denied.guest.sessionId,denied.guest.credential,randomUUID()));
    await assert.rejects(service.admit(f.owner,m.id,denied.guest.sessionId,true));
    const removed=await request(m.id);await service.admit(f.owner,m.id,removed.guest.sessionId,true);
    const joined=await service.guestJoin(removed.guest.sessionId,removed.guest.credential,randomUUID()), room=(await mediaClaims(joined.token)).video!.room!;
    provider.observeJoin(room,joined.identity);await legacy.reconcile();
    const participant=(await f.pg.query<{id:string}>('SELECT participant_id AS id FROM communication_meeting_guests WHERE id=$1',[removed.guest.sessionId])).rows[0];
    await service.remove(f.owner,m.id,participant.id);assert.ok(provider.removals.includes(joined.identity));
    await assert.rejects(service.guestJoin(removed.guest.sessionId,removed.guest.credential,randomUUID()));
    const revoked=await request(m.id);await service.admit(f.owner,m.id,revoked.guest.sessionId,true);
    const connected=await service.guestJoin(revoked.guest.sessionId,revoked.guest.credential,randomUUID());provider.observeJoin(room,connected.identity);
    await service.revokeInvitation(f.owner,m.id,revoked.invitation.id);assert.ok(provider.removals.includes(connected.identity));
    await assert.rejects(service.guestJoin(revoked.guest.sessionId,revoked.guest.credential,randomUUID()));
  });

  await t.test('cancellation and rescheduling cannot leave usable stale waiting credentials', async () => {
    const m=await create(), {guest}=await request(m.id);
    await service.cancel(f.owner,m.id);
    await assert.rejects(service.admit(f.owner,m.id,guest.sessionId,true));
    await assert.rejects(service.guestJoin(guest.sessionId,guest.credential,randomUUID()));
    const next=await create(), waiting=await request(next.id);
    await service.update(f.owner,next.id,edit(next.version,f.owner,{localStart:new Date(Date.now()+86400000).toISOString()}));
    await assert.rejects(service.admit(f.owner,next.id,waiting.guest.sessionId,true));
    await assert.rejects(service.guestJoin(waiting.guest.sessionId,waiting.guest.credential,randomUUID()));
  });

  await t.test('expired waiting credentials cannot be admitted and a forged provider participant is evicted', async () => {
    const m=await create();await service.start(f.owner,m.id);const {guest}=await request(m.id);
    await f.pg.query("UPDATE communication_meeting_guests SET expires_at=now()-interval '1 second' WHERE id=$1",[guest.sessionId]);
    await assert.rejects(service.admit(f.owner,m.id,guest.sessionId,true));
    await assert.rejects(service.guestJoin(guest.sessionId,guest.credential,randomUUID()));
    const host=await service.join(f.owner,m.id,randomUUID()), room=(await mediaClaims(host.token)).video!.room!;
    provider.observeJoin(room,'unknown-guest-identity');await legacy.reconcile();
    assert.ok(provider.removals.includes('unknown-guest-identity'));
  });

  await t.test('missing webhooks are reconciled without mixing simultaneous tenant rooms', async () => {
    const cases=[];
    for (const actor of [f.owner,f.owner,f.other]) {
      const m=await create(actor);await service.start(actor,m.id);const {guest}=await request(m.id,actor);
      await service.admit(actor,m.id,guest.sessionId,true);const joined=await service.guestJoin(guest.sessionId,guest.credential,randomUUID());
      const room=(await mediaClaims(joined.token)).video!.room!;provider.observeJoin(room,joined.identity);cases.push({actor,m,guest,joined,room});
    }
    assert.equal(new Set(cases.map(item=>item.room)).size,3);await legacy.reconcile();
    for (const item of cases) assert.equal((await service.get(item.actor,item.m.id)).status,'ACTIVE');
    await service.end(f.owner,cases[0].m.id);
    assert.ok(!provider.liveRooms.has(cases[0].room));assert.ok(provider.liveRooms.has(cases[1].room));assert.ok(provider.liveRooms.has(cases[2].room));
    provider.liveRooms.delete(cases[2].room);await legacy.reconcile();assert.equal((await service.get(f.other,cases[2].m.id)).status,'ENDED');
    assert.equal((await service.get(f.owner,cases[1].m.id)).status,'ACTIVE');
  });

  await t.test('tenant entitlements cap concurrent meetings, external guests and connection reservations', async () => {
    await capacity(f.owner.tenantId,'meetings.concurrent',1);
    const first=await create(f.owner,{attendeeIds:[f.host.userId]}), next=await create(), other=await create(f.other);await service.start(f.owner,first.id);
    await assert.rejects(service.start(f.owner,next.id),{code:'MEETING_ENTITLEMENT_LIMIT'});await service.start(f.other,other.id);
    await capacity(f.owner.tenantId,'meetings.external_guests',1);
    await capacity(f.owner.tenantId,'meetings.participants',2);
    await service.join(f.owner,first.id,randomUUID());
    const a=await request(first.id), b=await request(first.id);await service.admit(f.owner,first.id,a.guest.sessionId,true);
    await service.guestJoin(a.guest.sessionId,a.guest.credential,randomUUID());
    await assert.rejects(service.admit(f.owner,first.id,b.guest.sessionId,true),{code:'GUEST_CAPACITY'});
    await assert.rejects(service.join(f.host,first.id,randomUUID()),{code:'CALL_CAPACITY'});
    await service.end(f.owner,first.id);await service.start(f.owner,next.id);
  });

  await t.test('Phase 5 conversation calls and scheduled meetings share one tenant capacity policy', async () => {
    await capacity(f.owner.tenantId,'meetings.concurrent',1);
    const conversations=new CommunicationsService(f.db,{meetingsProvider:provider});
    const channel=await conversations.create(f.owner,{type:'PRIVATE_CHANNEL',name:'Internal team',memberUserIds:[f.host.userId]});
    const internal=await legacy.create(f.owner,String(channel.id),{type:'VIDEO',requestId:randomUUID()});
    const client=await create();await assert.rejects(service.start(f.owner,client.id),{code:'MEETING_ENTITLEMENT_LIMIT'});
    await legacy.end(f.owner,internal.id);await service.start(f.owner,client.id);
    await assert.rejects(legacy.create(f.owner,String(channel.id),{type:'VIDEO',requestId:randomUUID()}),{code:'MEETING_ENTITLEMENT_LIMIT'});
  });

  await t.test('invitation email queue is idempotent, tenant-scoped and stores references instead of bearer links', async () => {
    const m=await create(), body={requestId:randomUUID(),email:'guest@business.co.uk'};
    const invitation=await service.invite(f.owner,m.id,body);await service.invite(f.owner,m.id,body);
    const rows=(await f.pg.query<{tenant_id:string;template_data_json:Record<string,unknown>}>('SELECT tenant_id,template_data_json FROM email_outbox')).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].tenant_id,f.owner.tenantId);assert.equal(rows[0].template_data_json.invitationId,invitation.id);
    assert.ok(!JSON.stringify(rows).includes(invitationToken(invitation.id)));assert.doesNotMatch(JSON.stringify(rows),/https?:|credential|csrf/);
  });

  await t.test('workspace event replay isolates tenants and removes access with staff attendance',async()=>{
    const a=await create(f.host,{attendeeIds:[f.attendee.userId]}),b=await create(f.other),events=new CommunicationsService(f.db,{meetingsProvider:provider});
    await request(a.id,f.host);await request(b.id,f.other);
    const own=await events.events(f.attendee,null,'0');assert.ok(own.some(event=>event.meetingId===a.id));assert.ok(own.every(event=>event.meetingId!==b.id));
    assert.ok((await events.events(f.outsider,null,'0')).every(event=>event.meetingId!==a.id));
    assert.ok((await events.events(f.other,null,'0')).every(event=>event.meetingId!==a.id));
    const participant=(await f.pg.query<{id:string}>('SELECT id FROM communication_meeting_participants WHERE meeting_id=$1 AND user_id=$2',[a.id,f.attendee.userId])).rows[0];
    await service.remove(f.host,a.id,participant.id);
    assert.ok((await events.events(f.attendee,null,'0')).every(event=>event.meetingId!==a.id));
    assert.doesNotMatch(JSON.stringify(own),/credential|csrf|External guest/);
  });

  await t.test('linked appointment changes revoke admission before any fresh token can be issued',async()=>{
    const m=await create(f.owner,{customerId:f.customer.id,appointmentId:f.appointment.id,hostUserId:f.host.userId});
    await service.start(f.host,m.id);const {guest}=await request(m.id);await service.admit(f.host,m.id,guest.sessionId,true);
    await f.pg.query("UPDATE appointments SET status='CANCELLED',version=version+1 WHERE id=$1",[f.appointment.id]);
    try {
      await assert.rejects(service.guestJoin(guest.sessionId,guest.credential,randomUUID()));
      await assert.rejects(service.join(f.host,m.id,randomUUID()));
      assert.equal(provider.issued.length,0);
      assert.equal((await service.guestState(guest.sessionId,guest.credential)).meeting,null);
    } finally {await f.pg.query("UPDATE appointments SET status='CONFIRMED',version=version+1 WHERE id=$1",[f.appointment.id]);}
  });

  await t.test('appointment rescheduling rotates links and reports invalidated waiting state immediately',async()=>{
    const m=await create(f.owner,{customerId:f.customer.id,appointmentId:f.appointment.id,hostUserId:f.host.userId}),invitation=await invite(m.id,f.owner,{email:'guest@business.co.uk'});
    const guest=await service.requestGuest({invitationToken:invitation.token,name:'Original guest',requestId:randomUUID()});
    await f.pg.query("UPDATE appointments SET start_time=start_time+interval '5 minutes',end_time=end_time+interval '5 minutes',version=version+1 WHERE id=$1",[f.appointment.id]);
    try {
      const state=await service.guestState(guest.sessionId,guest.credential);assert.equal(state.meeting,null);assert.ok(['CANCELLED','EXPIRED'].includes(state.state));
      await assert.rejects(service.resolve(invitation.token));
      const updated=await service.get(f.owner,m.id);assert.ok(updated.version>m.version);
      assert.equal(new Date(updated.scheduledStartAt).getTime(),new Date(m.scheduledStartAt).getTime()+300000);
      const replacement=updated.invitations.find(item=>!item.revokedAt);assert.ok(replacement);assert.notEqual(replacement.id,invitation.id);
      assert.equal(new Date(replacement.expiresAt).getTime(),new Date(updated.expiresAt).getTime());
      const rows=(await f.pg.query<{secret_hash:string}>('SELECT secret_hash FROM communication_meeting_invitations WHERE meeting_id=$1',[m.id])).rows;assert.equal(new Set(rows.map(row=>row.secret_hash)).size,2);
      const fresh=await service.requestGuest({invitationToken:invitationToken(replacement.id),name:'Guest after reschedule',requestId:randomUUID()});
      await service.admit(f.host,m.id,fresh.sessionId,true);await service.start(f.host,m.id);assert.ok((await service.guestJoin(fresh.sessionId,fresh.credential,randomUUID())).token);
      await assert.rejects(service.guestJoin(guest.sessionId,guest.credential,randomUUID()));
    } finally {await f.pg.query("UPDATE appointments SET start_time=start_time-interval '5 minutes',end_time=end_time-interval '5 minutes',version=version+1 WHERE id=$1",[f.appointment.id]);}
  });

  await t.test('reassigning an appointment to another customer closes the original meeting without rewriting its history',async()=>{
    const replacementCustomer=randomUUID();
    await f.pg.query('INSERT INTO clients(id,tenant_id,name) VALUES($1,$2,$3)',[replacementCustomer,f.owner.tenantId,'Different customer']);
    const m=await create(f.owner,{customerId:f.customer.id,appointmentId:f.appointment.id,hostUserId:f.host.userId});
    await service.start(f.host,m.id);const {guest,invitation}=await request(m.id);await service.admit(f.host,m.id,guest.sessionId,true);
    const connected=await service.guestJoin(guest.sessionId,guest.credential,randomUUID()),room=(await mediaClaims(connected.token)).video!.room!;
    provider.observeJoin(room,connected.identity);await legacy.reconcile();
    await f.pg.query('UPDATE appointments SET client_id=$1,version=version+1 WHERE id=$2',[replacementCustomer,f.appointment.id]);
    try {
      const issuedBefore=provider.issued.length;
      await assert.rejects(service.guestJoin(guest.sessionId,guest.credential,randomUUID()));
      await assert.rejects(service.join(f.host,m.id,randomUUID()));
      assert.equal(provider.issued.length,issuedBefore,'A changed customer relationship must block fresh media credentials immediately');
      // The persisted cleanup path must also be able to update this row after the appointment relationship changes.
      await legacy.reconcile();
      assert.ok(!provider.liveRooms.has(room));
      const ended=await service.get(f.owner,m.id);
      assert.equal(ended.status,'CANCELLED');assert.equal(ended.customerId,f.customer.id);assert.equal(ended.appointmentId,f.appointment.id);
      assert.ok(ended.participants.some(participant=>participant.joinedAt),'Original attendance remains available in history');
      assert.ok((await service.list(f.owner,{customerId:f.customer.id})).data.some(item=>item.id===m.id));
      assert.ok(!(await service.list(f.owner,{customerId:replacementCustomer})).data.some(item=>item.id===m.id));
      await assert.rejects(service.resolve(invitation.token));
      assert.equal((await service.guestState(guest.sessionId,guest.credential)).meeting,null);
    } finally {
      await f.pg.query('UPDATE appointments SET client_id=$1,version=version+1 WHERE id=$2',[f.customer.id,f.appointment.id]);
      await f.pg.query('DELETE FROM clients WHERE id=$1',[replacementCustomer]);
    }
  });

  await t.test('brand resolution is authoritative and rejects executable logo formats',async()=>{
    const a=await create(),b=await create(f.other),ia=await invite(a.id),ib=await invite(b.id,f.other);
    await f.pg.query("INSERT INTO tenant_email_automation_settings(tenant_id,settings_json) VALUES($1,$2)",[f.owner.tenantId,JSON.stringify({branding:{businessName:'Alpha Consultations',logoUrl:'https://assets.example.test/logo.svg'}})]);
    try {
      const alpha=await service.resolve(ia.token),beta=await service.resolve(ib.token);
      assert.equal(alpha.branding.name,'Alpha Consultations');assert.equal(alpha.branding.logoUrl,null);
      assert.equal(beta.branding.name,'Business Beta');assert.equal(beta.branding.primaryColor,'#654321');
      await assert.rejects(service.create(f.other,{...input(f.other),branding:{name:'Alpha Consultations'}} as never));
    } finally {await f.pg.query('DELETE FROM tenant_email_automation_settings WHERE tenant_id=$1',[f.owner.tenantId]);}
  });

  await t.test('account and tenant revocation are rechecked at issuance and during media reconciliation',async()=>{
    const m=await create(f.owner,{attendeeIds:[f.host.userId]});await service.start(f.owner,m.id);const {guest}=await request(m.id);await service.admit(f.owner,m.id,guest.sessionId,true);
    await f.pg.query('UPDATE application_sessions SET revoked_at=now() WHERE auth_session_id=$1',[f.host.sessionId]);
    try {await assert.rejects(service.join(f.host,m.id,randomUUID()),{statusCode:401});}
    finally {await f.pg.query('UPDATE application_sessions SET revoked_at=NULL WHERE auth_session_id=$1',[f.host.sessionId]);}
    const joined=await service.guestJoin(guest.sessionId,guest.credential,randomUUID()),room=(await mediaClaims(joined.token)).video!.room!;provider.observeJoin(room,joined.identity);await legacy.reconcile();
    await f.pg.query('UPDATE tenants SET is_active=false WHERE id=$1',[f.owner.tenantId]);
    try {await assert.rejects(service.guestJoin(guest.sessionId,guest.credential,randomUUID()));await legacy.reconcile();assert.ok(provider.removals.includes(joined.identity));}
    finally {await f.pg.query('UPDATE tenants SET is_active=true WHERE id=$1',[f.owner.tenantId]);}
  });

  await t.test('guest token retries are throttled and a second tab cannot bypass its device limit',async()=>{
    const m=await create();await service.start(f.owner,m.id);const {guest}=await request(m.id);await service.admit(f.owner,m.id,guest.sessionId,true);
    const requestId=randomUUID();await service.guestJoin(guest.sessionId,guest.credential,requestId);
    await assert.rejects(service.guestJoin(guest.sessionId,guest.credential,randomUUID()),{code:'CALL_CAPACITY'});
    for(let n=1;n<12;n++)await service.guestJoin(guest.sessionId,guest.credential,requestId);
    await assert.rejects(service.guestJoin(guest.sessionId,guest.credential,requestId),{statusCode:429});
  });

  await t.test('cancellation after repeated reschedules queues one current-version notice per recipient',async()=>{
    let m=await create();await invite(m.id,f.owner,{email:'guest@business.co.uk'});
    for(const minutes of [5,10])m=await service.update(f.owner,m.id,edit(m.version,f.owner,{localStart:new Date(new Date(f.startsAt).getTime()+minutes*60000).toISOString()}));
    const cancelled=await service.cancel(f.owner,m.id);await service.cancel(f.owner,m.id);
    const messages=(await f.pg.query<{recipient_email:string;template_data_json:{kind:string;version:number}}>("SELECT recipient_email,template_data_json FROM email_outbox WHERE template_data_json->>'kind'='cancelled'")).rows;
    assert.equal(messages.length,1);assert.equal(messages[0].recipient_email,'guest@business.co.uk');assert.equal(messages[0].template_data_json.version,cancelled.version);
  });
});
