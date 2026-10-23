import { fileLimits } from './communications.file-policy.js';
import { ChatPreferencesSchema,ChatSearchQuerySchema,ChatFileQuerySchema } from '@ks-os/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { CommunicationsPresence } from './communications.presence.js';
import { z } from 'zod';
import {
  ChatSignalSchema, AddConversationMemberSchema, CommunicationPositionSchema, CreateNativeConversationSchema,
  CreateNativeMessageSchema, MarkConversationReadSchema, NativeConversationQuerySchema, NativeMessageQuerySchema,
  UpdateNativeMessageSchema, UpdateNativeChannelSchema, SetNativeReactionSchema, ChannelDiscoveryQuerySchema, NativePeopleQuerySchema,
} from '@ks-os/contracts';
import { CommunicationsActorSchema, communicationError, type CommunicationsActor } from './communications.authorization.js';
import { CommunicationsService } from './communications.service.js';

const params = z.object({ conversationId: z.string().uuid() });
const memberParams = params.extend({ userId: z.string().uuid() });
const messageParams = params.extend({ messageId: z.string().uuid() });
const subscriptionQuery = z.object({ ticket: z.string().regex(/^[a-f0-9]{64}$/), after: CommunicationPositionSchema.default('0') }).strict();
// Staff and customer route prefixes share one bounded process registry so their
// authorized channel rosters receive the same ephemeral presence and typing.
const presence = new CommunicationsPresence();
const connectionCounts = new Map<string,number>();
// Buffer admission is shared across internal and customer route registrations.
let incomingUploads=0;
const uploadsInFlight=new WeakSet<FastifyRequest>();

export function staffCommunicationsActor(request: FastifyRequest): CommunicationsActor {
  request.requireAuth();
  if (request.auth!.supportMode) throw communicationError(403, 'COMMUNICATIONS_FORBIDDEN', 'Support sessions cannot access private communications');
  const identity = request.authIdentity;
  if (!identity?.authSessionId || !identity.issuedAt || !identity.expiresAt) throw communicationError(401, 'AUTH_REQUIRED', 'Authentication required');
  return CommunicationsActorSchema.parse({
    tenantId: request.auth!.tenantId, userId: request.auth!.tenantUserId, authUserId: request.auth!.authUserId,
    sessionId: identity.authSessionId, issuedAt: identity.issuedAt, expiresAt: identity.expiresAt,
  });
}

export async function communicationsRoutes(app: FastifyInstance, options: { service?: CommunicationsService; resolveActor?:(request:FastifyRequest)=>Promise<CommunicationsActor>|CommunicationsActor; customer?:boolean }) {
  const service = options.service ?? new CommunicationsService();
  const actor=async(request:FastifyRequest)=>options.resolveActor?options.resolveActor(request):staffCommunicationsActor(request);
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control','no-store'); return payload; });
  app.addContentTypeParser('application/octet-stream',{parseAs:'buffer'},(_request,body,done)=>done(null,body));

  if(!options.customer) {
  const meetingParams=z.object({meetingId:z.string().uuid()});
  const empty=z.object({}).strict();
  app.addContentTypeParser('application/webhook+json',{parseAs:'string',bodyLimit:65536},(_request,body,done)=>done(null,body));
  app.post('/meetings/webhook',{bodyLimit:65536,config:{rateLimit:{max:300,timeWindow:'1 minute'}}},async request=>{
    if(typeof request.body!=='string')throw communicationError(400,'WEBHOOK_BODY','Invalid media notification');
    return service.meetings.webhook(request.body,request.headers.authorization??'');
  });
  app.get('/meetings/config',async request=>({data:await service.meetings.config(await actor(request))}));
  app.get('/meetings/incoming',async request=>service.meetings.incoming(await actor(request)));
  app.get('/:conversationId/meetings',async request=>service.meetings.history(await actor(request),params.parse(request.params).conversationId,z.object({before:z.string().uuid().optional()}).strict().parse(request.query).before));
  app.post('/:conversationId/meetings',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(request,reply)=>reply.code(201).send({data:await service.meetings.create(await actor(request),params.parse(request.params).conversationId,z.object({type:z.enum(['AUDIO','VIDEO']),requestId:z.string().uuid()}).strict().parse(request.body))}));
  app.get('/meetings/:meetingId',async request=>({data:await service.meetings.get(await actor(request),meetingParams.parse(request.params).meetingId)}));
  app.post('/meetings/:meetingId/invitation',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async request=>({data:await service.meetings.respond(await actor(request),meetingParams.parse(request.params).meetingId,z.object({accept:z.boolean()}).strict().parse(request.body).accept)}));
  app.post('/meetings/:meetingId/join',{config:{rateLimit:{max:12,timeWindow:'1 minute'}}},async request=>({data:await service.meetings.join(await actor(request),meetingParams.parse(request.params).meetingId,z.object({requestId:z.string().uuid()}).strict().parse(request.body).requestId)}));
  app.post('/meetings/:meetingId/leave',async request=>({data:await service.meetings.leave(await actor(request),meetingParams.parse(request.params).meetingId,z.object({sessionId:z.string().uuid()}).strict().parse(request.body).sessionId)}));
  app.post('/meetings/:meetingId/end',async request=>{empty.parse(request.body??{});return {data:await service.meetings.end(await actor(request),meetingParams.parse(request.params).meetingId)};});
  app.post('/meetings/:meetingId/participants/:userId/remove',async request=>{empty.parse(request.body??{});const p=meetingParams.extend({userId:z.string().uuid()}).parse(request.params);return {data:await service.meetings.remove(await actor(request),p.meetingId,p.userId)};});
  let reconciling=false;
  const reconcile=async()=>{if(reconciling)return;reconciling=true;try{await service.meetings.reconcile();}catch{app.log.warn('Meeting reconciliation unavailable; retained state will be retried.');}finally{reconciling=false;}};
  const timer=setInterval(()=>void reconcile(),15000);timer.unref();
  app.addHook('onClose',async()=>{clearInterval(timer);});
  }

  app.get('/search',async request=>service.discovery.search(await actor(request),ChatSearchQuerySchema.parse(request.query)));
  app.get('/preferences',async request=>({data:await service.discovery.preferences(await actor(request))}));
  app.put('/preferences',async request=>({data:await service.discovery.preferences(await actor(request),ChatPreferencesSchema.parse(request.body))}));
  app.get('/notifications',async request=>service.discovery.notifications(await actor(request),z.object({after:z.string().max(300).optional()}).strict().parse(request.query).after));
  app.post('/notifications/:notificationId/read',async request=>({data:await service.discovery.readNotification(await actor(request),z.object({notificationId:z.string().uuid()}).parse(request.params).notificationId)}));
  app.get('/file-policy',async request=>{await service.capabilities(await actor(request));return {data:fileLimits()};});
  app.get('/:conversationId/notification-preference',async request=>({data:await service.discovery.conversationPreference(await actor(request),params.parse(request.params).conversationId)}));
  app.put('/:conversationId/notification-preference',async request=>({data:await service.discovery.conversationPreference(await actor(request),params.parse(request.params).conversationId,z.object({mode:z.enum(['ALL','MENTIONS','NONE'])}).strict().parse(request.body).mode)}));
  app.addHook('onResponse',async request=>{if(uploadsInFlight.delete(request))incomingUploads--;});
  const fileParams=params.extend({fileId:z.string().uuid()});
  app.post('/:conversationId/files',async(request,reply)=>reply.code(201).send({data:await service.attachments.reserve(await actor(request),params.parse(request.params).conversationId,z.object({name:z.string().min(1).max(500),size:z.number().int().positive()}).strict().parse(request.body))}));
  app.put('/:conversationId/files/:fileId',{
    bodyLimit:fileLimits().maxBytes,
    onRequest:async request=>{await service.attachments.authorize(await actor(request),fileParams.parse(request.params).conversationId);if(incomingUploads>=2)throw communicationError(429,'UPLOAD_BUSY','Upload capacity is busy. Retry shortly.');incomingUploads++;uploadsInFlight.add(request);request.raw.once('aborted',()=>{if(uploadsInFlight.delete(request))incomingUploads--;});},
    config:{rateLimit:{max:20,timeWindow:'1 minute'}},
  },async request=>{
    const {conversationId,fileId}=fileParams.parse(request.params);
    if(!Buffer.isBuffer(request.body))throw communicationError(400,'FILE_BODY','Upload binary file data');
    return {data:await service.attachments.upload(await actor(request),conversationId,fileId,request.body)};
  });
  app.delete('/:conversationId/files/:fileId',async request=>{const {conversationId,fileId}=fileParams.parse(request.params);return {data:await service.attachments.remove(await actor(request),conversationId,fileId)};});
  app.get('/:conversationId/files',async request=>service.attachments.files(await actor(request),params.parse(request.params).conversationId,ChatFileQuerySchema.parse(request.query)));
  app.get('/:conversationId/files/:fileId/content',async(request,reply)=>{
    const {conversationId,fileId}=fileParams.parse(request.params);
    const {thumbnail}=z.object({thumbnail:z.enum(['true']).optional()}).strict().parse(request.query);
    const result=await service.attachments.download(await actor(request),conversationId,fileId,Boolean(thumbnail));
    reply.header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"sandbox; default-src 'none'")
      .header('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(result.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())).type(result.mime);
    return reply.send(result.bytes);
  });
  app.get('/capabilities', async request => ({data:await service.capabilities(await actor(request))}));
  app.get('/discover', async request => service.discover(await actor(request),ChannelDiscoveryQuerySchema.parse(request.query)));
  app.get('/people', async request => service.people(await actor(request),null,NativePeopleQuerySchema.parse(request.query)));
  app.get('/:conversationId/members', async request => service.people(await actor(request),params.parse(request.params).conversationId,NativePeopleQuerySchema.parse(request.query)));
  app.get('/:conversationId/candidates', async request => service.people(await actor(request),params.parse(request.params).conversationId,NativePeopleQuerySchema.parse(request.query),true));
  app.patch('/:conversationId', async request => ({data:await service.updateChannel(await actor(request),params.parse(request.params).conversationId,UpdateNativeChannelSchema.parse(request.body))}));
  app.post('/:conversationId/join', async request => ({data:await service.join(await actor(request),params.parse(request.params).conversationId)}));
  app.post('/:conversationId/leave', async request => ({data:await service.leave(await actor(request),params.parse(request.params).conversationId)}));
  app.post('/:conversationId/archive', async request => ({data:await service.archive(await actor(request),params.parse(request.params).conversationId)}));
  app.post('/:conversationId/owner', async request => ({data:await service.transfer(await actor(request),params.parse(request.params).conversationId,z.object({userId:z.string().uuid()}).strict().parse(request.body).userId)}));
  app.get('/:conversationId/messages/:messageId', async request => {
    const {conversationId,messageId}=messageParams.parse(request.params);
    return {data:await service.message(await actor(request),conversationId,messageId)};
  });
  app.post('/:conversationId/messages/resolve', async request => ({data:await service.resolveMessages(await actor(request),params.parse(request.params).conversationId,
    z.object({ids:z.array(z.string().uuid()).min(1).max(200)}).strict().parse(request.body).ids)}));
  app.patch('/:conversationId/messages/:messageId', async request => {
    const {conversationId,messageId}=messageParams.parse(request.params);
    return {data:await service.editMessage(await actor(request),conversationId,messageId,UpdateNativeMessageSchema.parse(request.body))};
  });
  app.delete('/:conversationId/messages/:messageId', async request => {
    const {conversationId,messageId}=messageParams.parse(request.params);
    return {data:await service.editMessage(await actor(request),conversationId,messageId,null)};
  });
  app.put('/:conversationId/messages/:messageId/reactions', async request => {
    const {conversationId,messageId}=messageParams.parse(request.params);
    return {data:await service.reaction(await actor(request),conversationId,messageId,SetNativeReactionSchema.parse(request.body))};
  });
  app.post('/realtime-ticket', async request => ({data:await service.ticket(await actor(request),null)}));
  app.get('/', async request => service.list(await actor(request), NativeConversationQuerySchema.parse(request.query)));
  app.post('/', async (request, reply) => {
    const current = await actor(request);
    const data = await service.create(current, CreateNativeConversationSchema.parse(request.body));
    return reply.code(201).send({ data });
  });
  app.get('/:conversationId', async request => ({ data: await service.get(await actor(request), params.parse(request.params).conversationId) }));
  app.post('/:conversationId/members', async (request, reply) => {
    const current = await actor(request);
    return reply.code(201).send({ data: await service.addMember(current, params.parse(request.params).conversationId, AddConversationMemberSchema.parse(request.body)) });
  });
  app.delete('/:conversationId/members/:userId', async request => {
    const current = await actor(request);
    const { conversationId, userId } = memberParams.parse(request.params);
    return { data: await service.removeMember(current, conversationId, userId) };
  });
  app.get('/:conversationId/messages', async request => service.messages(await actor(request), params.parse(request.params).conversationId, NativeMessageQuerySchema.parse(request.query)));
  app.post('/:conversationId/messages', async (request, reply) => {
    const current = await actor(request);
    return reply.code(201).send({ data: await service.post(current, params.parse(request.params).conversationId, CreateNativeMessageSchema.parse(request.body)) });
  });
  app.post('/:conversationId/read', async request => {
    const current = await actor(request);
    return { data: await service.read(current, params.parse(request.params).conversationId, MarkConversationReadSchema.parse(request.body).messageId) };
  });
  app.post('/:conversationId/realtime-ticket', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { data: await service.ticket(await actor(request), params.parse(request.params).conversationId) };
  });

  // Bound live subscriptions per actor per API process, alongside the existing HTTP limiter.
  const subscriptions = new WeakMap<FastifyRequest, { actor: CommunicationsActor; id: string | null; after: string }>();
  for (const path of ['/events','/:conversationId/events']) app.get(path, {
    websocket: true,
    preValidation: async request => {
      const conversationId = path === '/events' ? null : params.parse(request.params).conversationId;
      const query = subscriptionQuery.parse(request.query);
      const current = await service.consumeTicket(conversationId, query.ticket);
      if(options.customer) {
        const relationshipId=z.object({relationshipId:z.string().uuid()}).parse(request.params).relationshipId;
        if(current.kind!=='CUSTOMER'||current.customerRelationshipId!==relationshipId)throw communicationError(401,'INVALID_REALTIME_TICKET','Realtime ticket is invalid');
      } else if(current.kind==='CUSTOMER') throw communicationError(401,'INVALID_REALTIME_TICKET','Realtime ticket is invalid');
      subscriptions.set(request, { actor: current, id: conversationId, after: query.after });
    },
  }, (socket, request) => {
    const subscription = subscriptions.get(request)!;
    const connectionKey=subscription.actor.tenantId+':'+subscription.actor.userId;
    const count=connectionCounts.get(connectionKey) ?? 0;
    if(count>=12){socket.close(1013,'Too many open Chat connections');return;}
    connectionCounts.set(connectionKey,count+1);
    const connectionId=randomUUID();presence.open(connectionId,subscription.actor);
    let ephemeralEnabled=false;
    let lastSnapshot='',signalQueue=Promise.resolve(),signalWindow=Date.now(),signalCount=0;
    let released=false;
    const release=()=>{if(released)return;released=true;const remaining=(connectionCounts.get(connectionKey) ?? 1)-1;if(remaining>0)connectionCounts.set(connectionKey,remaining);else connectionCounts.delete(connectionKey);};
    let after = subscription.after;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let alive = true;
    let polls = 0;
    const stop = () => { stopped = true; presence.close(connectionId); release(); if (timer) clearTimeout(timer); };
    socket.on('close', stop);
    socket.on('error', stop);
    socket.on('pong', () => { alive = true; presence.touch(connectionId); });
    // Only bounded ephemeral control frames may use this socket. Message writes stay HTTP.
    socket.on('message', raw => {
      if(stopped)return;
      if(Date.now()-signalWindow>10000){signalWindow=Date.now();signalCount=0;}
      if(raw.toString().length>8192 || ++signalCount>30){stop();socket.close(1008,'Chat signal rate exceeded');return;}
      signalQueue=signalQueue.then(async()=>{
        if(stopped)return;
        const signal=ChatSignalSchema.parse(JSON.parse(raw.toString()));
        ephemeralEnabled=true;
        await service.capabilities(subscription.actor);
        if(signal.type==='watch' && signal.conversationId) {
          if(subscription.id && subscription.id!==signal.conversationId)throw new Error('Wrong conversation');
          await service.get(subscription.actor,signal.conversationId);
        }
        if(signal.type==='typing'){
          const current=presence.watch(connectionId).conversationId;
          if(signal.active){if(!current)throw new Error('Choose a conversation');await service.authorizeTyping(subscription.actor,current);}
          else if(current)await service.get(subscription.actor,current);
        }
        if(!stopped)presence.signal(connectionId,signal);
      }).catch(()=>{stop();socket.close(1008,'Chat signal not available');});
    });
    const poll = async () => {
      if (stopped || socket.readyState !== 1) return;
      try {
        if (socket.bufferedAmount > 262144) { stop(); socket.close(1013, 'Reconnect with your last cursor'); return; }
        const events = await service.events(subscription.actor, subscription.id, after);
        if (stopped || socket.readyState !== 1) return;
        for (const event of events) { socket.send(JSON.stringify(event)); after = event.id; }
        if(ephemeralEnabled){
        const watch=presence.watch(connectionId);
        const scope=await service.liveScope(subscription.actor,watch.conversationId,watch.userIds);
        if(stopped || socket.readyState!==1)return;
        const currentWatch=presence.watch(connectionId);
        if(currentWatch.conversationId===watch.conversationId && currentWatch.userIds===watch.userIds){
          const snapshot=JSON.stringify(presence.snapshot(connectionId,scope));
          if(snapshot!==lastSnapshot || polls%20===0){socket.send(snapshot);lastSnapshot=snapshot;}
        }
        }
        if (++polls % 20 === 0) {
          if (!alive) { stop(); socket.terminate(); return; }
          alive = false;
          socket.ping();
        }
        timer = setTimeout(() => { void poll(); }, 1000);
        timer.unref();
      } catch {
        stop();
        socket.close(1008, 'Subscription no longer available');
      }
    };
    void poll();
  });
}
