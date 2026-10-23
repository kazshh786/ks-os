import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ClientMeetings, ClientMeetingInputSchema, ClientMeetingUpdateSchema } from './communications.client-meetings.js';
import { CommunicationsActorSchema, communicationError } from './communications.authorization.js';
import { guestCsrf, meetingOrigin, sameSecret, secretHash } from './communications.meeting-secrets.js';

const uuid=z.string().uuid(), params=z.object({meetingId:uuid}), empty=z.object({}).strict();
function actor(request:FastifyRequest){
 request.requireAuth();if(request.auth!.supportMode)throw communicationError(403,'MEETING_FORBIDDEN','Support access cannot attend or administer private meetings.');
 const identity=request.authIdentity;if(!identity?.authSessionId||!identity.issuedAt||!identity.expiresAt)throw communicationError(401,'AUTH_REQUIRED','Authentication required');
 return CommunicationsActorSchema.parse({tenantId:request.auth!.tenantId,userId:request.auth!.tenantUserId,authUserId:request.auth!.authUserId,sessionId:identity.authSessionId,issuedAt:identity.issuedAt,expiresAt:identity.expiresAt});
}
function privateHeaders(app:FastifyInstance){app.addHook('onSend',async(_req,reply,payload)=>{reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer').header('X-Content-Type-Options','nosniff');return payload;});}
export async function clientMeetingRoutes(app:FastifyInstance,options:{service?:ClientMeetings}){
 const service=options.service??new ClientMeetings();privateHeaders(app);
 app.get('/config',async request=>({data:await service.config(actor(request),z.object({customerReference:uuid.optional()}).strict().parse(request.query))}));
 app.get('/',async request=>service.list(actor(request),z.object({search:z.string().max(100).optional(),status:z.enum(['SCHEDULED','CREATED','RINGING','ACTIVE','ENDED','CANCELLED','FAILED','EXPIRED']).optional(),hostId:uuid.optional(),customerId:uuid.optional(),customerReference:uuid.optional(),from:z.string().datetime().optional(),to:z.string().datetime().optional(),cursor:uuid.optional(),limit:z.coerce.number().int().min(1).max(30).optional()}).strict().parse(request.query) as Record<string,string|undefined>));
 app.post('/',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async(request,reply)=>reply.code(201).send({data:await service.create(actor(request),ClientMeetingInputSchema.parse(request.body))}));
 app.get('/:meetingId',async request=>({data:await service.get(actor(request),params.parse(request.params).meetingId)}));
 app.patch('/:meetingId',async request=>({data:await service.update(actor(request),params.parse(request.params).meetingId,ClientMeetingUpdateSchema.parse(request.body))}));
 for(const action of ['start','cancel','end'] as const)app.post(`/:meetingId/${action}`,async request=>{empty.parse(request.body??{});return {data:await service[action](actor(request),params.parse(request.params).meetingId)};});
 app.post('/:meetingId/join',{config:{rateLimit:{max:12,timeWindow:'1 minute'}}},async request=>({data:await service.join(actor(request),params.parse(request.params).meetingId,z.object({requestId:uuid}).strict().parse(request.body).requestId)}));
 app.post('/:meetingId/leave',async request=>({data:await service.leave(actor(request),params.parse(request.params).meetingId,z.object({sessionId:uuid}).strict().parse(request.body).sessionId)}));
 app.get('/:meetingId/waiting',async request=>service.waiting(actor(request),params.parse(request.params).meetingId));
 app.post('/:meetingId/guests/:guestId/admission',async request=>{const p=params.extend({guestId:uuid}).parse(request.params);return {data:await service.admit(actor(request),p.meetingId,p.guestId,z.object({approve:z.boolean()}).strict().parse(request.body).approve)};});
 app.post('/:meetingId/participants/:participantId/remove',async request=>{empty.parse(request.body??{});const p=params.extend({participantId:uuid}).parse(request.params);return {data:await service.remove(actor(request),p.meetingId,p.participantId)};});
 app.post('/:meetingId/invitations',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async request=>({data:await service.invite(actor(request),params.parse(request.params).meetingId,z.object({requestId:uuid,email:z.string().email().max(254).optional(),expiresAt:z.string().datetime().optional()}).strict().parse(request.body))}));
 app.post('/:meetingId/invitations/:invitationId/revoke',async request=>{empty.parse(request.body??{});const p=params.extend({invitationId:uuid}).parse(request.params);return {data:await service.revokeInvitation(actor(request),p.meetingId,p.invitationId)};});
}

const sessionParams=z.object({sessionId:uuid});
const cookieName='ksos_meeting_guest';
function credential(request:FastifyRequest){
 const cookies=(request.headers.cookie??'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(cookieName+'='));
 if(cookies.length!==1)throw communicationError(404,'MEETING_UNAVAILABLE','This meeting or invitation is unavailable.');
 const value=cookies[0].slice(cookieName.length+1);if(!/^[A-Za-z0-9_-]{43}$/.test(value))throw communicationError(404,'MEETING_UNAVAILABLE','This meeting or invitation is unavailable.');return value;
}
function origin(request:FastifyRequest){
 const expected=meetingOrigin();
 if(request.headers.origin!==expected&&!(request.method==='GET'&&!request.headers.origin&&request.headers['sec-fetch-site']==='same-origin'))throw communicationError(403,'GUEST_ORIGIN','Open the invitation from the configured meeting website.');
}
function csrf(request:FastifyRequest,id:string){const value=request.headers['x-ksos-csrf'];if(typeof value!=='string'||!sameSecret(value,secretHash(guestCsrf(id))))throw communicationError(403,'GUEST_CSRF','Refresh the meeting page before trying again.');}
export async function publicMeetingRoutes(app:FastifyInstance,options:{service?:ClientMeetings}){
 const service=options.service??new ClientMeetings();privateHeaders(app);
 app.addHook('onRequest',async request=>origin(request));
 app.post('/resolve',{bodyLimit:2048,config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async request=>({data:await service.resolve(z.object({invitationToken:z.string().max(100)}).strict().parse(request.body).invitationToken)}));
 app.post('/request',{bodyLimit:2048,config:{rateLimit:{max:6,timeWindow:'1 minute'}}},async(request,reply)=>{
  const result=await service.requestGuest(z.object({invitationToken:z.string().max(100),name:z.string().trim().min(1).max(100),requestId:uuid}).strict().parse(request.body));
  const {credential:secret,...data}=result;
  reply.header('Set-Cookie',`${cookieName}=${secret}; Path=/api/v1/public/meetings/sessions/${result.sessionId}; HttpOnly; SameSite=Lax; Max-Age=32400${meetingOrigin().startsWith('https:')?'; Secure':''}`);
  return {data};
 });
 app.get('/sessions/:sessionId',{config:{rateLimit:{max:90,timeWindow:'1 minute'}}},async request=>({data:await service.guestState(sessionParams.parse(request.params).sessionId,credential(request))}));
 app.post('/sessions/:sessionId/join',{config:{rateLimit:{max:12,timeWindow:'1 minute'}}},async request=>{const id=sessionParams.parse(request.params).sessionId;csrf(request,id);return {data:await service.guestJoin(id,credential(request),z.object({requestId:uuid}).strict().parse(request.body).requestId)};});
 app.post('/sessions/:sessionId/leave',async request=>{const id=sessionParams.parse(request.params).sessionId;csrf(request,id);empty.parse(request.body??{});return {data:await service.guestLeave(id,credential(request))};});
}
