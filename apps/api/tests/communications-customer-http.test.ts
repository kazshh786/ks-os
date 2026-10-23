import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
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
import { MobileDevices, requireMobileDevice } from '../src/modules/authentication/mobile-devices.service.js';
import { CommunicationLinks } from '../src/modules/communications/communications.links.js';

test('customer HTTP boundary: private invitation handoff, explicit context, scoped meeting cookies and CSRF',{timeout:240000},async t=>{
  const origin='https://portal.example.test';
  Object.assign(process.env,clientMeetingEnvironment,{PUBLIC_MEETING_ORIGIN:origin,PUBLIC_CUSTOMER_PORTAL_ORIGIN:origin,CUSTOMER_COLLABORATION_SECRET:'isolated-customer-http-test-secret-2026'});
  const f=await createClientMeetingFixture(t),provider=new ClientMeetingTestMedia(),meetings=new ClientMeetings(f.db,provider),chat=new CommunicationsService(f.db,{meetingsProvider:provider});
  const collaboration=new ClientCollaboration(f.db,{meetings,verifyEmail:async()=>{}}),contact=await f.seedCustomer('http-contact@example.test','HTTP Contact');
  const channel=await collaboration.create(f.owner,{clientId:f.customer.id,name:'Private contact channel',staffUserIds:[],requestId:randomUUID()});
  const invitation=await collaboration.invite(f.owner,channel.id,{email:contact.identity.email,requestId:randomUUID()}),token=collaborationInvitationToken(invitation.id);
  const app=Fastify();await app.register(rateLimit,{global:false});await app.register(websocket);
  app.decorateRequest('auth',undefined);app.decorateRequest('authIdentity',undefined);app.decorateRequest('applicationContext',undefined);app.decorateRequest('customerSessionValidated',false);
  app.decorateRequest('requireIdentity',function(){if(!this.authIdentity)throw Object.assign(new Error('Sign in required'),{statusCode:401});return this.authIdentity;});
  app.addHook('onRequest',async request=>{
    request.applicationContext=request.headers['x-ks-application-context'] as 'CUSTOMER'|'TENANT'|'AGENCY'|undefined;
    if(request.headers.authorization!=='Bearer contact')return;
    request.authIdentity={authUserId:contact.identity.authUserId,authSessionId:contact.identity.sessionId,email:contact.identity.email,assuranceLevel:'aal1',issuedAt:contact.identity.issuedAt,expiresAt:contact.identity.expiresAt};
    request.customerSessionValidated=true;
  });
  app.setErrorHandler((error:Error&{statusCode?:number;code?:string},_request,reply)=>reply.code(error instanceof ZodError?400:error.statusCode??500).send({error:{code:error.code??'BAD_REQUEST',message:error.message}}));
  await app.register(customerCollaborationRoutes,{prefix:'/api/v1/customer/collaboration',service:collaboration,meetings,chatService:chat,requireDevice:request=>requireMobileDevice(request,f.db)});
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
  await t.test('native customer device uses the same waiting room without cookies and cannot fall back after device denial',async()=>{
    const registration={applicationId:'test.ksos.customer-meetings',platform:'IOS' as const,environment:'SANDBOX' as const,installationId:randomUUID()},devices=new MobileDevices(f.db,{MOBILE_APPLICATIONS_JSON:JSON.stringify([{...registration,installationId:undefined,redirectUri:'https://portal.example.test/auth/callback'}])});
    const identity={authUserId:contact.identity.authUserId,authSessionId:contact.identity.sessionId,email:contact.identity.email,assuranceLevel:'aal1' as const,issuedAt:contact.identity.issuedAt,expiresAt:contact.identity.expiresAt};
    const registrationRequest={applicationContext:'CUSTOMER',headers:{},requireIdentity:()=>identity} as unknown as FastifyRequest;
    const device=await devices.register(registrationRequest,registration),headers={authorization:'Bearer contact','x-ks-application-context':'CUSTOMER','x-ks-device-id':String(device.id)},base=`${prefix}/${relationshipId}/meetings/${meetingId}`;
    const request=await app.inject({method:'POST',url:`${base}/request`,headers,payload:{conversationId:channel.id,requestId:randomUUID()}});assert.equal(request.statusCode,200,request.body);assert.equal(request.json().data.sessionId,sessionId);assert.equal(request.headers['set-cookie'],undefined);assert.equal(request.json().data.credential,undefined);
    const state=await app.inject({url:`${base}/sessions/${sessionId}`,headers});assert.equal(state.statusCode,200,state.body);assert.equal(state.json().data.state,'WAITING');
    const blocked=await app.inject({method:'POST',url:`${base}/sessions/${sessionId}/join`,headers,payload:{requestId:randomUUID()}});assert.equal(blocked.statusCode,404,blocked.body);assert.equal(provider.issued.length,0);
    for(const invalid of [randomUUID(),'malformed']){const response=await app.inject({url:`${base}/sessions/${sessionId}`,headers:{...auth,cookie:mediaCookie,'x-ks-device-id':invalid}});assert.equal(response.statusCode,401,response.body);}
    const browser=await app.inject({url:`${base}/sessions/${sessionId}`,headers:{authorization:'Bearer contact','x-ks-application-context':'CUSTOMER',cookie:mediaCookie}});assert.equal(browser.statusCode,403,'A browser without Origin cannot borrow the native exception');
    const bodyDevice=await app.inject({method:'POST',url:`${base}/request`,headers,payload:{conversationId:channel.id,requestId:randomUUID(),deviceId:device.id}});assert.equal(bodyDevice.statusCode,400);
    const publicAttempt=await app.inject({url:`/api/v1/public/meetings/sessions/${sessionId}`,headers});assert.equal(publicAttempt.statusCode,403,'Public guests never inherit native cookie bypass');
  });
  await t.test('customer deep links resolve only explicit grants and exact meeting filtering does not broaden discovery',async()=>{
    const actor=await collaboration.actor(contact.identity,relationshipId),links=new CommunicationLinks(f.db,()=>origin);
    const target={kind:'MEETING' as const,tenantId:f.owner.tenantId,relationshipId,meetingId};
    const resolved=await links.create(actor,target);assert.equal(resolved.webPath,`/customer/collaboration/${relationshipId}/meetings?meetingId=${meetingId}`);assert.equal(resolved.requiresAdmission,true);
    const filtered=await app.inject({url:`${prefix}/${relationshipId}/meetings?meetingId=${meetingId}`,headers:auth});assert.equal(filtered.statusCode,200,filtered.body);assert.deepEqual(filtered.json().data.map((m:{id:string})=>m.id),[meetingId]);
    const missing=await app.inject({url:`${prefix}/${relationshipId}/meetings?meetingId=${randomUUID()}`,headers:auth});assert.equal(missing.statusCode,200);assert.deepEqual(missing.json().data,[]);
    await f.pg.query('UPDATE communication_meeting_customer_grants SET revoked_at=now() WHERE meeting_id=$1 AND conversation_id=$2',[meetingId,channel.id]);await assert.rejects(links.create(actor,target));
    assert.deepEqual((await meetings.customerList(actor,{meetingId})).data,[]);await f.pg.query('UPDATE communication_meeting_customer_grants SET revoked_at=NULL WHERE meeting_id=$1 AND conversation_id=$2',[meetingId,channel.id]);
    assert.equal(provider.issued.length,0,'Opening a meeting link does not mint media credentials');
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
