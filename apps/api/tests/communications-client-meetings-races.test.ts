import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ClientMeetings } from '../src/modules/communications/communications.client-meetings.js';
import { invitationToken } from '../src/modules/communications/communications.meeting-secrets.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';
import { ClientMeetingTestMedia, clientMeetingEnvironment } from './helpers/client-meetings-media.js';

// No fallback to DATABASE_URL: these tests require the isolated GitHub PostgreSQL service.
const postgresUrl = process.env.CLIENT_MEETINGS_TEST_DATABASE_URL;
test('client meetings: real PostgreSQL concurrent capacity and revocation', { skip: !postgresUrl, timeout: 180000 }, async t => {
  Object.assign(process.env,clientMeetingEnvironment);
  const f=await createClientMeetingFixture(t,{postgresUrl}), provider=new ClientMeetingTestMedia();
  const first=new ClientMeetings(f.db,provider), second=new ClientMeetings(f.db,provider);
  const create=(actor=f.owner)=>first.create(actor,{requestId:randomUUID(),title:'Concurrent consultation',audience:'EXTERNAL_CLIENT',type:'VIDEO',localStart:f.startsAt,timezone:'UTC',durationMinutes:60,hostUserId:actor.userId,attendeeIds:actor===f.owner?[f.host.userId,f.attendee.userId]:[],cohostIds:[],guestScreenShare:false});
  const guest=async(meetingId:string)=>{const invitation=await first.invite(f.owner,meetingId,{requestId:randomUUID()});return {invitation,session:await first.requestGuest({invitationToken:invitationToken(invitation.id),name:'Concurrent guest',requestId:randomUUID()})};};
  const capacity=(key:string,limit:number)=>f.pg.query("INSERT INTO tenant_entitlement_overrides(tenant_id,entitlement_key,value_json,starts_at,expires_at) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 day')",[f.owner.tenantId,key,JSON.stringify({limit})]);
  const fulfilled=(results:PromiseSettledResult<unknown>[])=>results.filter(value=>value.status==='fulfilled').length;
  t.beforeEach(async()=>{provider.liveRooms.clear();provider.issued.length=0;await f.pg.exec('TRUNCATE communication_meetings CASCADE; TRUNCATE tenant_entitlement_overrides;');});

  await t.test('two independent start transactions cannot exceed one tenant slot',async()=>{
    await capacity('meetings.concurrent',1);const a=await create(),b=await create();
    const results=await Promise.allSettled([first.start(f.owner,a.id),second.start(f.owner,b.id)]);
    assert.equal(fulfilled(results),1);assert.equal(provider.liveRooms.size,1);
    assert.equal((results.find(result=>result.status==='rejected') as PromiseRejectedResult).reason.code,'MEETING_ENTITLEMENT_LIMIT');
    assert.equal((await f.pg.query("SELECT id FROM communication_meetings WHERE status IN ('CREATED','RINGING','ACTIVE')")).rows.length,1);
  });

  await t.test('independent tenants cannot race past the shared infrastructure limit',async()=>{
    const previous=process.env.MEETING_INFRA_MAX_ROOMS;process.env.MEETING_INFRA_MAX_ROOMS='1';
    try {
      const a=await create(),b=await create(f.other);
      const results=await Promise.allSettled([first.start(f.owner,a.id),second.start(f.other,b.id)]);
      assert.equal(fulfilled(results),1);assert.equal(provider.liveRooms.size,1);
      assert.equal((results.find(result=>result.status==='rejected') as PromiseRejectedResult).reason.code,'MEETING_INFRASTRUCTURE_CAPACITY');
    } finally {if(previous===undefined)delete process.env.MEETING_INFRA_MAX_ROOMS;else process.env.MEETING_INFRA_MAX_ROOMS=previous;}
  });

  await t.test('concurrent host approvals cannot overbook the external guest entitlement',async()=>{
    await capacity('meetings.external_guests',1);const m=await create(),a=await guest(m.id),b=await guest(m.id);
    const results=await Promise.allSettled([first.admit(f.owner,m.id,a.session.sessionId,true),second.admit(f.owner,m.id,b.session.sessionId,true)]);
    assert.equal(fulfilled(results),1);
    assert.equal((await f.pg.query("SELECT id FROM communication_meeting_guests WHERE state='APPROVED' AND revoked_at IS NULL")).rows.length,1);
  });

  await t.test('simultaneous room tokens reserve capacity before media connection',async()=>{
    await capacity('meetings.participants',2);const m=await create();await first.start(f.owner,m.id);
    const results=await Promise.allSettled([first.join(f.owner,m.id,randomUUID()),second.join(f.host,m.id,randomUUID()),first.join(f.attendee,m.id,randomUUID())]);
    assert.equal(fulfilled(results),2);assert.equal(provider.issued.length,2);
    assert.equal((results.find(result=>result.status==='rejected') as PromiseRejectedResult).reason.code,'CALL_CAPACITY');
    assert.equal((await f.pg.query('SELECT id FROM communication_meeting_sessions WHERE revoked_at IS NULL AND token_expires_at>now()')).rows.length,2);
  });

  await t.test('approval racing invitation revocation cannot leave a valid admission',async()=>{
    const m=await create();await first.start(f.owner,m.id);const {invitation,session}=await guest(m.id);
    const results=await Promise.allSettled([first.admit(f.owner,m.id,session.sessionId,true),second.revokeInvitation(f.owner,m.id,invitation.id)]);
    assert.equal(results[1].status,'fulfilled');
    const state=(await f.pg.query<{state:string;revoked_at:Date|null}>('SELECT state,revoked_at FROM communication_meeting_guests WHERE id=$1',[session.sessionId])).rows[0];
    assert.ok(state.revoked_at);assert.notEqual(state.state,'APPROVED');
    await assert.rejects(first.guestJoin(session.sessionId,session.credential,randomUUID()));
    assert.equal(provider.issued.length,0);
  });

  await t.test('cancellation racing token issuance leaves no reusable admission or room',async()=>{
    const m=await create();await first.start(f.owner,m.id);const {session}=await guest(m.id);await first.admit(f.owner,m.id,session.sessionId,true);
    const results=await Promise.allSettled([first.guestJoin(session.sessionId,session.credential,randomUUID()),second.cancel(f.owner,m.id)]);
    assert.equal(results[1].status,'fulfilled');assert.equal(provider.liveRooms.size,0);
    assert.equal((await f.pg.query('SELECT id FROM communication_meeting_sessions WHERE revoked_at IS NULL')).rows.length,0);
    await assert.rejects(first.guestJoin(session.sessionId,session.credential,randomUUID()));
  });
});
