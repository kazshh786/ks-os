import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { ClientMeetings } from '../src/modules/communications/communications.client-meetings.js';
import { clientMeetingRoutes, publicMeetingRoutes } from '../src/modules/communications/communications.client-meetings.routes.js';
import { invitationToken } from '../src/modules/communications/communications.meeting-secrets.js';
import { createClientMeetingFixture } from './helpers/client-meetings-fixture.js';
import { ClientMeetingTestMedia, clientMeetingEnvironment } from './helpers/client-meetings-media.js';

test('client meeting HTTP boundary: origin, private cookie, CSRF, identity and abuse protection',{timeout:180000},async t=>{
  const origin='https://meetings.example.test';
  Object.assign(process.env,clientMeetingEnvironment,{PUBLIC_MEETING_ORIGIN:origin});
  const f=await createClientMeetingFixture(t),provider=new ClientMeetingTestMedia(),service=new ClientMeetings(f.db,provider);
  const app=Fastify();await app.register(rateLimit,{global:false});
  app.decorateRequest('auth',undefined);app.decorateRequest('authIdentity',undefined);
  app.decorateRequest('requireAuth',function(){if(!this.auth)throw Object.assign(new Error('Authentication required'),{statusCode:401});});
  const actors={owner:f.owner,host:f.host,attendee:f.attendee,outsider:f.outsider,other:f.other,support:f.owner};
  app.addHook('onRequest',async request=>{
    const label=request.headers.authorization?.replace('Bearer ','') as keyof typeof actors,actor=actors[label];
    if(!actor)return;
    request.auth={tenantId:actor.tenantId,tenantUserId:actor.userId,authUserId:actor.authUserId,membershipReference:actor.userId,businessReference:actor.tenantId,tenantName:'Fixture',tenantSubdomain:'fixture',email:null,role:'owner',permissions:[],...(label==='support'?{supportMode:{}}:{})} as never;
    request.authIdentity={authUserId:actor.authUserId,authSessionId:actor.sessionId,email:null,assuranceLevel:'aal1',issuedAt:actor.issuedAt,expiresAt:actor.expiresAt};
  });
  app.setErrorHandler((error:Error&{statusCode?:number;code?:string},_request,reply)=>reply.code(error instanceof ZodError?400:error.statusCode??500).send({error:{code:error.code??'BAD_REQUEST',message:error.message}}));
  await app.register(clientMeetingRoutes,{prefix:'/api/v1/meetings',service});
  await app.register(publicMeetingRoutes,{prefix:'/api/v1/public/meetings',service});
  await app.ready();t.after(()=>app.close());
  const staff='/api/v1/meetings',publicPath='/api/v1/public/meetings';
  const body=()=>({requestId:randomUUID(),title:'Private consultation',audience:'EXTERNAL_CLIENT',type:'VIDEO',localStart:f.startsAt,timezone:'UTC',durationMinutes:60,hostUserId:f.owner.userId,attendeeIds:[],cohostIds:[],guestScreenShare:false});
  const create=()=>service.create(f.owner,body() as never);
  let address=1;
  const request=async(meetingId:string,name='Guest')=>{
    const invitation=await service.invite(f.owner,meetingId,{requestId:randomUUID()});
    const payload={invitationToken:invitationToken(invitation.id),name,requestId:randomUUID()};
    const response=await app.inject({method:'POST',url:`${publicPath}/request`,remoteAddress:`127.0.1.${address++}`,headers:{origin},payload});
    assert.equal(response.statusCode,200,response.body);
    const cookie=String(response.headers['set-cookie']).split(';')[0],data=response.json().data;
    return {invitation,payload,response,cookie,data};
  };
  t.beforeEach(async()=>{provider.liveRooms.clear();provider.issued.length=0;await f.pg.exec('TRUNCATE communication_meetings CASCADE;');});

  await t.test('strict staff payloads derive tenant and media identity from trusted authentication',async()=>{
    for(const extra of [{tenantId:f.other.tenantId},{organisationId:f.other.tenantId},{providerRoomName:'chosen-room'},{identity:'chosen-identity'},{waitingRoomEnabled:false}]){
      const response=await app.inject({method:'POST',url:staff,headers:{authorization:'Bearer owner'},payload:{...body(),...extra}});
      assert.equal(response.statusCode,400,response.body);
    }
    assert.equal((await app.inject({method:'POST',url:staff,payload:body()})).statusCode,401);
    const m=await create();
    assert.equal((await app.inject({url:`${staff}/${m.id}`,headers:{authorization:'Bearer other'}})).statusCode,404);
    assert.equal((await app.inject({method:'POST',url:`${staff}/${m.id}/join`,headers:{authorization:'Bearer owner'},payload:{requestId:randomUUID(),room:'chosen'}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:`${staff}/${m.id}/start`,headers:{authorization:'Bearer support'},payload:{}})).statusCode,403);
  });

  await t.test('guest request sets a scoped secure HttpOnly cookie without putting credentials into JSON',async()=>{
    const m=await create(),guest=await request(m.id);
    const header=String(guest.response.headers['set-cookie']);
    assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Lax/);assert.match(header,/; Secure/);
    assert.ok(header.includes(`Path=${publicPath}/sessions/${guest.data.sessionId}`));
    const secret=guest.cookie.slice(guest.cookie.indexOf('=')+1);
    assert.ok(secret.length>=43);assert.ok(!guest.response.body.includes(secret));assert.equal(guest.data.credential,undefined);assert.equal(guest.data.token,undefined);
    assert.equal(guest.data.state,'WAITING');assert.ok(guest.data.csrfToken);
    assert.equal(guest.response.headers['cache-control'],'no-store');assert.equal(guest.response.headers['referrer-policy'],'no-referrer');
    const refresh=await app.inject({url:`${publicPath}/sessions/${guest.data.sessionId}`,headers:{cookie:guest.cookie,'sec-fetch-site':'same-origin'}});
    assert.equal(refresh.statusCode,200,refresh.body);assert.equal(refresh.json().data.state,'WAITING');
  });

  await t.test('cross-site requests and missing CSRF cannot trigger guest admission or issue a token',async()=>{
    const m=await create();await service.start(f.owner,m.id);const guest=await request(m.id),url=`${publicPath}/sessions/${guest.data.sessionId}/join`;
    for(const headers of [{cookie:guest.cookie},{origin:'https://attacker.example.test',cookie:guest.cookie},{origin,cookie:guest.cookie},{origin,cookie:guest.cookie,'x-ksos-csrf':'wrong'}]){
      assert.equal((await app.inject({method:'POST',url,headers,payload:{requestId:randomUUID()}})).statusCode,403);
    }
    const headers={origin,cookie:guest.cookie,'x-ksos-csrf':guest.data.csrfToken};
    assert.equal((await app.inject({method:'POST',url,headers,payload:{requestId:randomUUID()}})).statusCode,404);
    assert.equal(provider.issued.length,0);
    const approve=await app.inject({method:'POST',url:`${staff}/${m.id}/guests/${guest.data.sessionId}/admission`,headers:{authorization:'Bearer owner'},payload:{approve:true}});
    assert.equal(approve.statusCode,200,approve.body);
    const joined=await app.inject({method:'POST',url,headers,payload:{requestId:randomUUID()}});
    assert.equal(joined.statusCode,200,joined.body);assert.ok(joined.json().data.token);assert.equal(joined.headers['cache-control'],'no-store');
    assert.equal(joined.json().data.meeting.canManage,false);
  });

  await t.test('guest credentials cannot become staff authentication or access another session',async()=>{
    const m=await create(),a=await request(m.id),b=await request(m.id,'Other guest');
    for(const headers of [{cookie:a.cookie},{authorization:`Bearer ${a.cookie.split('=')[1]}`}]){
      assert.equal((await app.inject({url:staff,headers})).statusCode,401);
      assert.equal((await app.inject({method:'POST',url:`${staff}/${m.id}/guests/${a.data.sessionId}/admission`,headers,payload:{approve:true}})).statusCode,401);
    }
    assert.equal((await app.inject({url:`${publicPath}/sessions/${b.data.sessionId}`,headers:{origin,cookie:a.cookie}})).statusCode,404);
    assert.equal((await app.inject({url:`${publicPath}/sessions/${a.data.sessionId}`,headers:{origin,cookie:`${a.cookie}; ${b.cookie}`}})).statusCode,404);
    assert.equal((await app.inject({method:'POST',url:`${staff}/${m.id}/guests/${a.data.sessionId}/admission`,headers:{authorization:'Bearer other'},payload:{approve:true}})).statusCode,404);
  });

  await t.test('public requests reject supplied roles, tenants and rooms and keep invalid invitations indistinguishable',async()=>{
    const m=await create(),invitation=await service.invite(f.owner,m.id,{requestId:randomUUID()}),token=invitationToken(invitation.id);
    for(const extra of [{tenantId:f.other.tenantId},{role:'ORGANIZER'},{room:'chosen'},{approved:true},{credential:'chosen'}]){
      const response=await app.inject({method:'POST',url:`${publicPath}/request`,remoteAddress:`127.0.2.${address++}`,headers:{origin},payload:{invitationToken:token,name:'Guest',requestId:randomUUID(),...extra}});
      assert.equal(response.statusCode,400,response.body);
    }
    const responses=[];
    for(const invitationToken of ['not-an-invitation',`${randomUUID()}.${'x'.repeat(43)}`])responses.push(await app.inject({method:'POST',url:`${publicPath}/resolve`,headers:{origin},payload:{invitationToken}}));
    assert.equal(responses[0].statusCode,404);assert.equal(responses[1].statusCode,404);assert.deepEqual(responses[0].json(),responses[1].json());
    const crossOrigin=await app.inject({method:'POST',url:`${publicPath}/resolve`,headers:{origin:'https://other-business.example.test'},payload:{invitationToken:token}});assert.equal(crossOrigin.statusCode,403);
  });

  await t.test('public join throttling runs before expensive session creation',async()=>{
    const m=await create(),invitation=await service.invite(f.owner,m.id,{requestId:randomUUID()}),payload={invitationToken:invitationToken(invitation.id),name:'Retrying guest',requestId:randomUUID()};
    const responses=[];
    for(let n=0;n<7;n++)responses.push(await app.inject({method:'POST',url:`${publicPath}/request`,remoteAddress:'127.0.99.1',headers:{origin},payload}));
    assert.equal(responses[0].statusCode,200,responses[0].body);assert.equal(responses[6].statusCode,429,responses[6].body);
    assert.equal((await f.pg.query('SELECT id FROM communication_meeting_guests')).rows.length,1);
  });
});
