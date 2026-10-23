import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ClientCollaboration, ClientChannelInput, collaborationIdentity } from './communications.client-collaboration.js';
import { ClientMeetings } from './communications.client-meetings.js';
import type { CommunicationsService } from './communications.service.js';
import { communicationError } from './communications.authorization.js';
import { communicationsRoutes, staffCommunicationsActor } from './communications.routes.js';
import { collaborationOrigin } from './communications.collaboration-secrets.js';
import { guestCsrf, sameSecret, secretHash } from './communications.meeting-secrets.js';

const uuid=z.string().uuid(),empty=z.object({}).strict(),channel=z.object({channelId:uuid}),relationship=z.object({relationshipId:uuid}),meeting=relationship.extend({meetingId:uuid}),guest=meeting.extend({sessionId:uuid});
const rate=(max:number)=>({config:{rateLimit:{max,timeWindow:'1 minute'}}});
function privacy(app:FastifyInstance){app.addHook('onSend',async(_request,reply,payload)=>{reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer').header('X-Content-Type-Options','nosniff');return payload;});}
function origin(request:FastifyRequest){if(request.headers.origin!==collaborationOrigin()&&!(request.method==='GET'&&!request.headers.origin&&request.headers['sec-fetch-site']==='same-origin'))throw communicationError(403,'CUSTOMER_ORIGIN','Open the invitation from the configured customer website.');}
function cookie(request:FastifyRequest,name:string,pattern:RegExp){const values=(request.headers.cookie??'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(name+'='));if(values.length!==1||!pattern.test(values[0].slice(name.length+1)))throw communicationError(404,'COLLABORATION_UNAVAILABLE','This customer collaboration is unavailable.');return values[0].slice(name.length+1);}
function csrf(request:FastifyRequest,id:string){const value=request.headers['x-ksos-csrf'];if(typeof value!=='string'||!sameSecret(value,secretHash(guestCsrf(id))))throw communicationError(403,'GUEST_CSRF','Refresh the meeting page before trying again.');}
const pendingCookie='ksos_customer_invite',pendingPath='/api/v1/customer/collaboration/invitations',guestCookie='ksos_customer_meeting';

export async function clientCollaborationRoutes(app:FastifyInstance,options:{service?:ClientCollaboration;meetings?:ClientMeetings}){
  const service=options.service??new ClientCollaboration(),meetings=options.meetings??new ClientMeetings();privacy(app);
  app.get('/customers',async request=>{const q=z.object({q:z.string().max(100).optional(),clientReference:uuid.optional()}).strict().parse(request.query);return {data:await service.customers(staffCommunicationsActor(request),q.q,q.clientReference)};});
  app.get('/config',async request=>({data:await service.config(staffCommunicationsActor(request),z.object({clientId:uuid.optional()}).strict().parse(request.query).clientId)}));
  app.get('/channels',async request=>service.channels(staffCommunicationsActor(request),z.object({clientId:uuid.optional(),clientReference:uuid.optional(),after:uuid.optional()}).strict().parse(request.query)));
  app.post('/channels',rate(20),async(request,reply)=>reply.code(201).send({data:await service.create(staffCommunicationsActor(request),ClientChannelInput.parse(request.body))}));
  app.get('/channels/:channelId/access',async request=>({data:await service.access(staffCommunicationsActor(request),channel.parse(request.params).channelId)}));
  app.post('/channels/:channelId/invitations',rate(20),async request=>({data:await service.invite(staffCommunicationsActor(request),channel.parse(request.params).channelId,z.object({email:z.string().trim().email().max(254),requestId:uuid}).strict().parse(request.body))}));
  app.post('/channels/:channelId/invitations/:invitationId/revoke',rate(20),async request=>{empty.parse(request.body??{});const p=channel.extend({invitationId:uuid}).parse(request.params);return {data:await service.revokeInvitation(staffCommunicationsActor(request),p.channelId,p.invitationId)};});
  app.post('/channels/:channelId/contacts',rate(20),async request=>({data:await service.addContact(staffCommunicationsActor(request),channel.parse(request.params).channelId,z.object({relationshipId:uuid}).strict().parse(request.body).relationshipId)}));
  app.delete('/channels/:channelId/contacts/:relationshipId',rate(20),async request=>{const p=channel.extend({relationshipId:uuid}).parse(request.params);return {data:await service.removeContact(staffCommunicationsActor(request),p.channelId,p.relationshipId)};});
  app.post('/relationships/:relationshipId/revoke',rate(20),async request=>{empty.parse(request.body??{});return {data:await service.revokeRelationship(staffCommunicationsActor(request),relationship.parse(request.params).relationshipId)};});
  app.get('/channels/:channelId/meetings',async request=>meetings.channelMeetings(staffCommunicationsActor(request),channel.parse(request.params).channelId));
  app.post('/channels/:channelId/meetings',rate(20),async request=>({data:await meetings.grantCustomerChannel(staffCommunicationsActor(request),channel.parse(request.params).channelId,z.object({meetingId:uuid}).strict().parse(request.body).meetingId)}));
  app.delete('/channels/:channelId/meetings/:meetingId',rate(20),async request=>{const p=channel.extend({meetingId:uuid}).parse(request.params);return {data:await meetings.revokeCustomerGrant(staffCommunicationsActor(request),p.channelId,p.meetingId)};});
}

export async function customerCollaborationRoutes(app:FastifyInstance,options:{service?:ClientCollaboration;meetings?:ClientMeetings;chatService?:CommunicationsService}){
  const service=options.service??new ClientCollaboration(),meetings=options.meetings??new ClientMeetings();privacy(app);
  const actor=async(request:FastifyRequest)=>service.actor(collaborationIdentity(request),relationship.parse(request.params).relationshipId);
  app.get('/session',rate(60),async request=>({data:await service.session(collaborationIdentity(request))}));
  app.post('/invitations/handoff',{...rate(15),bodyLimit:2048},async(request,reply)=>{
    origin(request);const result=await service.handoff(z.object({invitationToken:z.string().max(100)}).strict().parse(request.body).invitationToken);
    reply.header('Set-Cookie',`${pendingCookie}=${result.credential}; Path=${pendingPath}; HttpOnly; SameSite=Lax; Max-Age=1800${collaborationOrigin().startsWith('https:')?'; Secure':''}`);
    return {data:{expiresAt:result.expiresAt}};
  });
  app.get('/invitations/pending',rate(30),async request=>{origin(request);try{return {data:await service.pending(cookie(request,pendingCookie,/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/))};}catch(error){if((error as {statusCode?:number}).statusCode===404)return {data:{available:false}};throw error;}});
  app.post('/invitations/accept',rate(10),async request=>{origin(request);empty.parse(request.body??{});return {data:await service.accept(collaborationIdentity(request),cookie(request,pendingCookie,/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/))};});
  app.get('/:relationshipId/meetings',rate(90),async request=>meetings.customerList(await actor(request),z.object({conversationId:uuid.optional(),after:uuid.optional()}).strict().parse(request.query)));
  app.post('/:relationshipId/meetings/:meetingId/request',rate(6),async(request,reply)=>{
    origin(request);const p=meeting.parse(request.params),input=z.object({conversationId:uuid,requestId:uuid}).strict().parse(request.body);
    const result=await meetings.requestCustomer(await actor(request),p.meetingId,input.conversationId,input.requestId),{credential,...data}=result;
    reply.header('Set-Cookie',`${guestCookie}=${credential}; Path=/api/v1/customer/collaboration/${p.relationshipId}/meetings/${p.meetingId}/sessions/${result.sessionId}; HttpOnly; SameSite=Lax; Max-Age=32400${collaborationOrigin().startsWith('https:')?'; Secure':''}`);
    return {data};
  });
  app.get('/:relationshipId/meetings/:meetingId/sessions/:sessionId',rate(90),async request=>{origin(request);const p=guest.parse(request.params);return {data:await meetings.customerGuestSession(await actor(request),p.meetingId,p.sessionId,cookie(request,guestCookie,/^[A-Za-z0-9_-]{43}$/),'state')};});
  app.post('/:relationshipId/meetings/:meetingId/sessions/:sessionId/join',rate(12),async request=>{origin(request);const p=guest.parse(request.params);csrf(request,p.sessionId);return {data:await meetings.customerGuestSession(await actor(request),p.meetingId,p.sessionId,cookie(request,guestCookie,/^[A-Za-z0-9_-]{43}$/),'join',z.object({requestId:uuid}).strict().parse(request.body).requestId)};});
  app.post('/:relationshipId/meetings/:meetingId/sessions/:sessionId/leave',rate(12),async request=>{origin(request);const p=guest.parse(request.params);csrf(request,p.sessionId);empty.parse(request.body??{});return {data:await meetings.customerGuestSession(await actor(request),p.meetingId,p.sessionId,cookie(request,guestCookie,/^[A-Za-z0-9_-]{43}$/),'leave')};});
  await app.register(communicationsRoutes,{prefix:'/:relationshipId/chat',resolveActor:actor,customer:true,service:options.chatService});
}
