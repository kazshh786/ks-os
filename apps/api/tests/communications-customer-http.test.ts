import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { ClientCollaboration } from '../src/modules/communications/communications.client-collaboration.js';
import { ClientMeetings } from '../src/modules/communications/communications.client-meetings.js';
import { CommunicationsService } from '../src/modules/communications/communications.service.js';
import { customerCollaborationRoutes } from '../src/modules/communications/communications.client-collaboration.routes.js';
import { publicMeetingRoutes } from '../src/modules/communications/communications.client-meetings.routes.js';
import { collaborationInvitationToken } from '../src/modules/communications/communications.collaboration-secrets.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';
import { ClientMeetingTestMedia, clientMeetingEnvironment } from './helpers/client-meetings-media.js';

test('customer HTTP boundary: private invitation handoff, explicit context, scoped meeting cookies and CSRF',{timeout:240000},async t=>{
  const origin='https://portal.example.test';
  Object.assign(process.env,clientMeetingEnvironment,{PUBLIC_MEETING_ORIGIN:origin,PUBLIC_CUSTOMER_PORTAL_ORIGIN:origin,CUSTOMER_COLLABORATION_SECRET:'isolated-customer-http-test-secret-2026'});
  const f=await createClientMeetingFixture(t),provider=new ClientMeetingTestMedia(),meetings=new ClientMeetings(f.db,provider),chat=new CommunicationsService(f.db,{meetingsProvider:provider});
  const collaboration=new ClientCollaboration(f.db,{meetings,verifyEmail:async()=>{}}),contact=await f.seedCustomer('http-contact@example.test','HTTP Contact');
  const channel=await collaboration.create(f.owner,{clientId:f.customer.id,name:'Private contact channel',staffUserIds:[],requestId:randomUUID()});
  const invitation=await collaboration.invite(f.owner,channel.id,{email:contact.identity.email,requestId:randomUUID()}),token=collaborationInvitationToken(invitation.id);
  const app=Fastify();await app.register(rateLimit,{global:false});await app.register(websocket);
  app.decorateRequest('auth',undefined);app.decorateRequest('authIdentity',undefined);app.decorateRequest('applicationContext',undefined);app.decorateRequest('customerSessionValidated',false);
  app.addHook('onRequest',async request=>{
    request.applicationContext=request.headers['x-ks-application-context'] as 'CUSTOMER'|'TENANT'|'AGENCY'|undefined;
    if(request.headers.authorization!=='Bearer contact')return;
    request.authIdentity={authUserId:contact.identity.authUserId,authSessionId:contact.identity.sessionId,email:contact.identity.email,assuranceLevel:'aal1',issuedAt:contact.identity.issuedAt,expiresAt:contact.identity.expiresAt};
    request.customerSessionValidated=true;
  });
  app.setErrorHandler((error:Error&{statusCode?:number;code?:string},_request,reply)=>reply.code(error instanceof ZodError?400:error.statusCode??500).send({error:{code:error.code??'BAD_REQUEST',message:error.message}}));
  await app.register(customerCollaborationRoutes,{prefix:'/api/v1/customer/collaboration',service:collaboration,meetings,chatService:chat});
  await app.register(publicMeetingRoutes,{prefix:'/api/v1/public/meetings',service:meetings});await app.ready();t.after(()=>app.close());
  const prefix='/api/v1/customer/collaboration',auth={authorization:'Bearer contact','x-ks-application-context':'CUSTOMER',origin};
  let pendingCookie='',relationshipId='',sessionId='',meetingId='',mediaCookie='',csrfToken='';

  await t.test('handoff uses a secure opaque cookie and never returns invitation secrets in JSON',async()=>{
    const blocked=await app.inject({method:'POST',url:`${prefix}/invitations/handoff`,headers:{origin:'https://attacker.example.test'},payload:{invitationToken:token}});assert.equal(blocked.statusCode,403);
    const response=await app.inject({method:'POST',url:`${prefix}/invitations/handoff`,headers:{origin},payload:{invitationToken:token}});assert.equal(response.statusCode,200,response.body);
    const header=String(response.headers['set-cookie']);pendingCookie=header.split(';')[0];
    assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Lax/);assert.match(header,/; Secure/);assert.ok(header.includes(`Path=${prefix}/invitations`));
    assert.ok(!response.body.includes(token));assert.ok(!response.body.includes(pendingCookie.split('=')[1]));assert.equal(response.json().data.credential,undefined);
    assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['referrer-policy'],'no-referrer');
    const pending=await app.inject({url:`${prefix}/invitations/pending`,headers:{cookie:pendingCookie,'sec-fetch-site':'same-origin'}});assert.deepEqual(pending.json().data,{available:true});
  });
  await t.test('acceptance requires CUSTOMER authentication and handles same-account response retries',async()=>{
    for(const context of ['TENANT','AGENCY','']){const response=await app.inject({method:'POST',url:`${prefix}/invitations/accept`,headers:{...auth,'x-ks-application-context':context,cookie:pendingCookie},payload:{}});assert.equal(response.statusCode,403,response.body);}
    const missing=await app.inject({method:'POST',url:`${prefix}/invitations/accept`,headers:{origin,'x-ks-application-context':'CUSTOMER',cookie:pendingCookie},payload:{}});assert.equal(missing.statusCode,401);
    const duplicateCookie=await app.inject({method:'POST',url:`${prefix}/invitations/accept`,headers:{...auth,cookie:`${pendingCookie}; ${pendingCookie}`},payload:{}});assert.equal(duplicateCookie.statusCode,404);
    const response=await app.inject({method:'POST',url:`${prefix}/invitations/accept`,headers:{...auth,cookie:pendingCookie},payload:{}});assert.equal(response.statusCode,200,response.body);relationshipId=response.json().data.relationshipId;
    const retry=await app.inject({method:'POST',url:`${prefix}/invitations/accept`,headers:{...auth,cookie:pendingCookie},payload:{}});assert.equal(retry.statusCode,200,retry.body);assert.deepEqual(retry.json(),response.json());
    assert.equal((await f.pg.query('SELECT id FROM customer_client_links')).rows.length,0,'Collaboration does not grant booking ownership');
  });
  await t.test('customer meeting request is scoped, recoverable and cannot bypass waiting-room admission',async()=>{
    const m=await meetings.create(f.owner,{requestId:randomUUID(),title:'Customer consultation',audience:'EXTERNAL_CLIENT',type:'VIDEO',localStart:f.startsAt,timezone:'UTC',durationMinutes:60,hostUserId:f.owner.userId,customerId:f.customer.id,attendeeIds:[],cohostIds:[],guestScreenShare:false});meetingId=m.id;
    await meetings.grantCustomerChannel(f.owner,channel.id,m.id);await meetings.start(f.owner,m.id);
    const url=`${prefix}/${relationshipId}/meetings/${m.id}/request`;
    const response=await app.inject({method:'POST',url,headers:auth,payload:{conversationId:channel.id,requestId:randomUUID()}});assert.equal(response.statusCode,200,response.body);
    sessionId=response.json().data.sessionId;csrfToken=response.json().data.csrfToken;const header=String(response.headers['set-cookie']);mediaCookie=header.split(';')[0];
    assert.ok(header.includes(`Path=${prefix}/${relationshipId}/meetings/${m.id}/sessions/${sessionId}`));assert.match(header,/HttpOnly/);assert.match(header,/; Secure/);
    assert.equal(response.json().data.state,'WAITING');assert.equal(response.json().data.credential,undefined);assert.equal(response.json().data.token,undefined);assert.ok(!response.body.includes(mediaCookie.split('=')[1]));
    const reload=await app.inject({method:'POST',url,headers:auth,payload:{conversationId:channel.id,requestId:randomUUID()}});assert.equal(reload.statusCode,200,reload.body);assert.equal(reload.json().data.sessionId,sessionId);
    const join=`${prefix}/${relationshipId}/meetings/${m.id}/sessions/${sessionId}/join`;
    assert.equal((await app.inject({method:'POST',url:join,headers:{...auth,cookie:mediaCookie},payload:{requestId:randomUUID()}})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:join,headers:{...auth,cookie:mediaCookie,'x-ksos-csrf':csrfToken},payload:{requestId:randomUUID()}})).statusCode,404);
    assert.equal(provider.issued.length,0);
  });
  await t.test('media credentials cannot cross meeting routes or bypass authenticated customer-session revocation',async()=>{
    await meetings.admit(f.owner,meetingId,sessionId,true);
    const base=`${prefix}/${relationshipId}/meetings/${meetingId}/sessions/${sessionId}`,headers={...auth,cookie:mediaCookie,'x-ksos-csrf':csrfToken};
    const joined=await app.inject({method:'POST',url:`${base}/join`,headers,payload:{requestId:randomUUID()}});assert.equal(joined.statusCode,200,joined.body);assert.ok(joined.json().data.token);
    const wrong=await app.inject({url:`${prefix}/${relationshipId}/meetings/${randomUUID()}/sessions/${sessionId}`,headers});assert.equal(wrong.statusCode,404);
    const publicAttempt=await app.inject({url:`/api/v1/public/meetings/sessions/${sessionId}`,headers:{origin,cookie:`ksos_meeting_guest=${mediaCookie.split('=')[1]}`}});assert.equal(publicAttempt.statusCode,404);
    await f.pg.query('DELETE FROM auth.sessions WHERE id=$1',[contact.identity.sessionId]);
    const revoked=await app.inject({url:base,headers});assert.equal(revoked.statusCode,401);assert.equal(revoked.json().data,undefined);
  });
});
