import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ClientMeetings } from '../src/modules/communications/communications.client-meetings.js';
import { CommunicationsMeetings } from '../src/modules/communications/communications.meetings.js';
import { LiveKitProvider } from '../src/modules/communications/communications.livekit.js';
import { invitationToken } from '../src/modules/communications/communications.meeting-secrets.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';
import { clientMeetingEnvironment, mediaEnvironment, mediaClaims } from './helpers/client-meetings-media.js';
import { verifyClientMeetingMedia } from './helpers/client-meetings-media-browser.mjs';

test('client meetings: actual guest media across simultaneous meetings and tenants', { skip:process.env.COMMUNICATIONS_MEDIA_TEST!=='1',timeout:300000 },async t=>{
  assert.equal(process.env.LIVEKIT_URL,mediaEnvironment.LIVEKIT_URL);
  assert.equal(process.env.LIVEKIT_API_URL,mediaEnvironment.LIVEKIT_API_URL);
  assert.equal(process.env.LIVEKIT_API_KEY,mediaEnvironment.LIVEKIT_API_KEY);
  assert.equal(process.env.LIVEKIT_API_SECRET,mediaEnvironment.LIVEKIT_API_SECRET);
  Object.assign(process.env,clientMeetingEnvironment);
  const f=await createClientMeetingFixture(t),provider=new LiveKitProvider(mediaEnvironment),service=new ClientMeetings(f.db,provider),observer=new CommunicationsMeetings(f.db,provider);
  const cases=[];
  for(const [index,actor] of [f.owner,f.owner,f.other].entries()){
    const m=await service.create(actor,{requestId:randomUUID(),title:`Isolated client meeting ${index+1}`,audience:'EXTERNAL_CLIENT',type:'VIDEO',localStart:f.startsAt,timezone:'UTC',durationMinutes:60,hostUserId:actor.userId,attendeeIds:[],cohostIds:[],guestScreenShare:index===1});
    await service.start(actor,m.id);
    const invitation=await service.invite(actor,m.id,{requestId:randomUUID()});
    const waiting=await service.requestGuest({invitationToken:invitationToken(invitation.id),name:`Synthetic guest ${index+1}`,requestId:randomUUID()});
    await assert.rejects(service.guestJoin(waiting.sessionId,waiting.credential,randomUUID()),'No media grant exists before admission');
    await service.admit(actor,m.id,waiting.sessionId,true);
    const host=await service.join(actor,m.id,randomUUID()),guest=await service.guestJoin(waiting.sessionId,waiting.credential,randomUUID());
    const participant=(await f.pg.query<{id:string}>('SELECT participant_id AS id FROM communication_meeting_guests WHERE id=$1',[waiting.sessionId])).rows[0];
    cases.push({tenantId:actor.tenantId,actor,meetingId:m.id,room:(await mediaClaims(host.token)).video!.room!,host,guest,waiting,invitation,participantId:participant.id});
  }
  const summary=await verifyClientMeetingMedia({cases,provider,
    reconcile:()=>observer.reconcile(),
    removeGuest:item=>service.remove(item.actor,item.meetingId,item.participantId),
    revokeInvitation:item=>service.revokeInvitation(item.actor,item.meetingId,item.invitation.id),
    freshGuestJoin:item=>service.guestJoin(item.waiting.sessionId,item.waiting.credential,randomUUID()),
    end:item=>service.end(item.actor,item.meetingId),
  });
  assert.equal(summary.evidence.length,6);
});
