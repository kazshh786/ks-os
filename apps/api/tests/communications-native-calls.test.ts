import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from '@ks-os/database';
import { CommunicationsService } from '../src/modules/communications/communications.service.js';
import { CommunicationsMeetings } from '../src/modules/communications/communications.meetings.js';
import { ClientMeetings } from '../src/modules/communications/communications.client-meetings.js';
import { authorizedMeetingReference, canDeliverMeetingNotification, meetingNotificationVisibility, type MeetingNotificationReference } from '../src/modules/communications/communications.meeting-notifications.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';
import { ClientMeetingTestMedia } from './helpers/client-meetings-media.js';

test('native calls: response binding, canonical notices and current authority',{timeout:180000},async t=>{
 const f=await createClientMeetingFixture(t),media=new ClientMeetingTestMedia(),calls=new CommunicationsMeetings(f.db,media),chat=new CommunicationsService(f.db,{meetingsProvider:media});
 const second={...f.attendee,sessionId:randomUUID()};
 await f.pg.query('INSERT INTO auth.sessions(id,user_id,created_at) VALUES($1,$2,$3)',[second.sessionId,second.authUserId,second.issuedAt]);
 await f.pg.query("INSERT INTO application_sessions(auth_session_id,auth_user_id,application_context,selected_tenant_user_id,security_version,expires_at) VALUES($1,$2,'TENANT',$3,1,$4)",[second.sessionId,second.authUserId,second.userId,second.expiresAt]);
 const create=async()=>{const c=await chat.create(f.owner,{type:'PRIVATE_CHANNEL',name:`Native call ${randomUUID()}`,memberUserIds:[f.attendee.userId]});return calls.create(f.owner,String(c.id),{type:'AUDIO',requestId:randomUUID()});};
 const notice=async(id:string,type='CALL_INCOMING')=>(await f.db.query<MeetingNotificationReference&{id:string}>(sql`SELECT id,tenant_id AS "tenantId",recipient_user_id AS "recipientUserId",recipient_customer_relationship_id AS "recipientCustomerRelationshipId",chat_meeting_id AS "meetingId",meeting_version AS "meetingVersion",type,chat_conversation_id AS "conversationId" FROM internal_notifications WHERE chat_meeting_id=${id} AND type=${type} AND recipient_user_id=${f.attendee.userId}`))[0];
 t.beforeEach(async()=>{media.liveRooms.clear();await f.pg.exec('TRUNCATE communication_meetings CASCADE');});
 await t.test('first accepting session wins; other device cannot steal it through join; retries stay idempotent',async()=>{
  const m=await create(),n=await notice(m.id);assert.ok(n);assert.equal(await canDeliverMeetingNotification(f.db,n),true);
  const requestId=randomUUID(),accepted=await calls.respond(f.attendee,m.id,true,requestId);assert.equal(accepted.callState,'ACCEPTED');assert.equal(accepted.answeredOnThisSession,true);
  assert.deepEqual(await calls.respond(f.attendee,m.id,true,requestId),accepted);
  await assert.rejects(calls.respond(second,m.id,true,randomUUID()),{code:'CALL_ANSWERED_ELSEWHERE'});await assert.rejects(calls.join(second,m.id,randomUUID()),{code:'CALL_ANSWERED_ELSEWHERE'});
  assert.equal((await calls.get(second,m.id)).answeredOnThisSession,false);assert.equal(await canDeliverMeetingNotification(f.db,n),false);
  const joinId=randomUUID(),joined=await calls.join(f.attendee,m.id,joinId);assert.equal((await calls.join(f.attendee,m.id,joinId)).identity,joined.identity);
  assert.equal((await f.pg.query('SELECT response_auth_session_id FROM communication_meeting_participants WHERE meeting_id=$1 AND user_id=$2',[m.id,f.attendee.userId])).rows[0].response_auth_session_id,f.attendee.sessionId);
 });
 await t.test('decline cannot be silently changed by a later join and does not create a missed call',async()=>{
  const m=await create();await calls.respond(f.attendee,m.id,false,randomUUID());await assert.rejects(calls.join(f.attendee,m.id,randomUUID()),{code:'INVITATION_ANSWERED'});
  await assert.rejects(calls.respond(second,m.id,true,randomUUID()),{code:'INVITATION_ANSWERED'});await calls.end(f.owner,m.id);
  assert.equal((await calls.get(f.attendee,m.id)).callState,'DECLINED');assert.equal(await notice(m.id,'CALL_MISSED'),undefined);
 });
 await t.test('expired ringing invitation creates one durable missed notice and cannot issue credentials',async()=>{
  const m=await create();await f.pg.query("UPDATE communication_meetings SET expires_at=now()-interval '1 second' WHERE id=$1",[m.id]);
  assert.equal((await calls.get(f.attendee,m.id)).callState,'EXPIRED');await calls.reconcile();await calls.reconcile();
  const n=await notice(m.id,'CALL_MISSED');assert.ok(n);assert.equal(await canDeliverMeetingNotification(f.db,n),true);assert.equal((await calls.get(f.attendee,m.id)).callState,'MISSED');
  assert.equal((await f.pg.query("SELECT count(*)::int AS n FROM internal_notifications WHERE chat_meeting_id=$1 AND type='CALL_MISSED'",[m.id])).rows[0].n,1);await assert.rejects(calls.join(f.attendee,m.id,randomUUID()));
 });
 await t.test('provider logout evicts current media and canonical history disappears after membership revocation',async()=>{
  const m=await create(),joined=await calls.join(f.attendee,m.id,randomUUID()),room=(await f.pg.query('SELECT provider_room_name FROM communication_meetings WHERE id=$1',[m.id])).rows[0].provider_room_name;
  media.observeJoin(String(room),joined.identity);await calls.reconcile();await f.pg.query('DELETE FROM auth.sessions WHERE id=$1',[f.attendee.sessionId]);await calls.reconcile();assert.ok(media.removals.includes(joined.identity));
  await f.pg.query('INSERT INTO auth.sessions(id,user_id,created_at) VALUES($1,$2,$3)',[f.attendee.sessionId,f.attendee.authUserId,f.attendee.issuedAt]);
  await chat.removeMember(f.owner,m.conversationId,f.attendee.userId);
  assert.equal((await f.db.query(sql`SELECT n.id FROM internal_notifications n WHERE n.chat_meeting_id=${m.id} AND n.recipient_user_id=${f.attendee.userId} AND ${meetingNotificationVisibility(f.attendee)}`)).length,0);
 });
 await t.test('scheduled history remains after cancellation but losing current meeting capability hides it',async()=>{
  const meetings=new ClientMeetings(f.db,media),m=await meetings.create(f.owner,{requestId:randomUUID(),title:'Scheduled internal meeting',audience:'INTERNAL',type:'VIDEO',localStart:f.startsAt,timezone:'UTC',durationMinutes:60,hostUserId:f.owner.userId,attendeeIds:[f.attendee.userId]});
  const invitation=await notice(m.id,'MEETING_INVITATION');assert.ok(invitation);assert.equal(await canDeliverMeetingNotification(f.db,invitation),true);await meetings.cancel(f.owner,m.id);
  assert.equal(await canDeliverMeetingNotification(f.db,invitation),false);assert.equal(await canDeliverMeetingNotification(f.db,await notice(m.id,'MEETING_CANCELLED')),true);
  assert.equal((await authorizedMeetingReference(f.db,f.attendee,m.id)).status,'CANCELLED');
  await f.pg.query("UPDATE users SET permissions='{\"MEETINGS_VIEW_OWN\":false,\"MEETINGS_VIEW_ALL\":false}'::jsonb WHERE id=$1",[f.attendee.userId]);
  assert.equal((await f.db.query(sql`SELECT n.id FROM internal_notifications n WHERE n.chat_meeting_id=${m.id} AND n.recipient_user_id=${f.attendee.userId} AND ${meetingNotificationVisibility(f.attendee)}`)).length,0);await assert.rejects(authorizedMeetingReference(f.db,f.attendee,m.id));
 });
});

const postgresUrl=process.env.CLIENT_MEETINGS_TEST_DATABASE_URL;
test('native calls: PostgreSQL accepts exactly one competing device response',{skip:!postgresUrl,timeout:120000},async t=>{
 const f=await createClientMeetingFixture(t,{postgresUrl}),media=new ClientMeetingTestMedia(),chat=new CommunicationsService(f.db,{meetingsProvider:media}),one=new CommunicationsMeetings(f.db,media),two=new CommunicationsMeetings(f.db,media),other={...f.attendee,sessionId:randomUUID()};
 await f.pg.query('INSERT INTO auth.sessions(id,user_id,created_at) VALUES($1,$2,$3)',[other.sessionId,other.authUserId,other.issuedAt]);await f.pg.query("INSERT INTO application_sessions(auth_session_id,auth_user_id,application_context,selected_tenant_user_id,security_version,expires_at) VALUES($1,$2,'TENANT',$3,1,$4)",[other.sessionId,other.authUserId,other.userId,other.expiresAt]);
 const channel=await chat.create(f.owner,{type:'PRIVATE_CHANNEL',name:'Race call',memberUserIds:[f.attendee.userId]}),m=await one.create(f.owner,String(channel.id),{type:'AUDIO',requestId:randomUUID()});
 const results=await Promise.allSettled([one.respond(f.attendee,m.id,true,randomUUID()),two.respond(other,m.id,true,randomUUID())]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const winning=(await f.pg.query('SELECT response_auth_session_id FROM communication_meeting_participants WHERE meeting_id=$1 AND user_id=$2',[m.id,f.attendee.userId])).rows[0].response_auth_session_id,winner=winning===f.attendee.sessionId?f.attendee:other,loser=winning===f.attendee.sessionId?other:f.attendee;
 await one.join(winner,m.id,randomUUID());await assert.rejects(two.join(loser,m.id,randomUUID()),{code:'CALL_ANSWERED_ELSEWHERE'});
});
