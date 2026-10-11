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

function actor(request: FastifyRequest): CommunicationsActor {
  request.requireAuth();
  if (request.auth!.supportMode) throw communicationError(403, 'COMMUNICATIONS_FORBIDDEN', 'Support sessions cannot access private communications');
  const identity = request.authIdentity;
  if (!identity?.authSessionId || !identity.issuedAt || !identity.expiresAt) throw communicationError(401, 'AUTH_REQUIRED', 'Authentication required');
  return CommunicationsActorSchema.parse({
    tenantId: request.auth!.tenantId, userId: request.auth!.tenantUserId, authUserId: request.auth!.authUserId,
    sessionId: identity.authSessionId, issuedAt: identity.issuedAt, expiresAt: identity.expiresAt,
  });
}

export async function communicationsRoutes(app: FastifyInstance, options: { service?: CommunicationsService }) {
  const service = options.service ?? new CommunicationsService();
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control','no-store'); return payload; });
  app.get('/capabilities', async request => ({data:await service.capabilities(actor(request))}));
  app.get('/discover', async request => service.discover(actor(request),ChannelDiscoveryQuerySchema.parse(request.query)));
  app.get('/people', async request => service.people(actor(request),null,NativePeopleQuerySchema.parse(request.query)));
  app.get('/:conversationId/members', async request => service.people(actor(request),params.parse(request.params).conversationId,NativePeopleQuerySchema.parse(request.query)));
  app.get('/:conversationId/candidates', async request => service.people(actor(request),params.parse(request.params).conversationId,NativePeopleQuerySchema.parse(request.query),true));
  app.patch('/:conversationId', async request => ({data:await service.updateChannel(actor(request),params.parse(request.params).conversationId,UpdateNativeChannelSchema.parse(request.body))}));
  app.post('/:conversationId/join', async request => ({data:await service.join(actor(request),params.parse(request.params).conversationId)}));
  app.post('/:conversationId/leave', async request => ({data:await service.leave(actor(request),params.parse(request.params).conversationId)}));
  app.post('/:conversationId/archive', async request => ({data:await service.archive(actor(request),params.parse(request.params).conversationId)}));
  app.post('/:conversationId/owner', async request => ({data:await service.transfer(actor(request),params.parse(request.params).conversationId,z.object({userId:z.string().uuid()}).strict().parse(request.body).userId)}));
  app.get('/:conversationId/messages/:messageId', async request => {
    const {conversationId,messageId}=messageParams.parse(request.params);
    return {data:await service.message(actor(request),conversationId,messageId)};
  });
  app.post('/:conversationId/messages/resolve', async request => ({data:await service.resolveMessages(actor(request),params.parse(request.params).conversationId,
    z.object({ids:z.array(z.string().uuid()).min(1).max(200)}).strict().parse(request.body).ids)}));
  app.patch('/:conversationId/messages/:messageId', async request => {
    const {conversationId,messageId}=messageParams.parse(request.params);
    return {data:await service.editMessage(actor(request),conversationId,messageId,UpdateNativeMessageSchema.parse(request.body))};
  });
  app.delete('/:conversationId/messages/:messageId', async request => {
    const {conversationId,messageId}=messageParams.parse(request.params);
    return {data:await service.editMessage(actor(request),conversationId,messageId,null)};
  });
  app.put('/:conversationId/messages/:messageId/reactions', async request => {
    const {conversationId,messageId}=messageParams.parse(request.params);
    return {data:await service.reaction(actor(request),conversationId,messageId,SetNativeReactionSchema.parse(request.body))};
  });
  app.post('/realtime-ticket', async request => ({data:await service.ticket(actor(request),null)}));
  app.get('/', async request => service.list(actor(request), NativeConversationQuerySchema.parse(request.query)));
  app.post('/', async (request, reply) => {
    const current = actor(request);
    const data = await service.create(current, CreateNativeConversationSchema.parse(request.body));
    return reply.code(201).send({ data });
  });
  app.get('/:conversationId', async request => ({ data: await service.get(actor(request), params.parse(request.params).conversationId) }));
  app.post('/:conversationId/members', async (request, reply) => {
    const current = actor(request);
    return reply.code(201).send({ data: await service.addMember(current, params.parse(request.params).conversationId, AddConversationMemberSchema.parse(request.body)) });
  });
  app.delete('/:conversationId/members/:userId', async request => {
    const current = actor(request);
    const { conversationId, userId } = memberParams.parse(request.params);
    return { data: await service.removeMember(current, conversationId, userId) };
  });
  app.get('/:conversationId/messages', async request => service.messages(actor(request), params.parse(request.params).conversationId, NativeMessageQuerySchema.parse(request.query)));
  app.post('/:conversationId/messages', async (request, reply) => {
    const current = actor(request);
    return reply.code(201).send({ data: await service.post(current, params.parse(request.params).conversationId, CreateNativeMessageSchema.parse(request.body)) });
  });
  app.post('/:conversationId/read', async request => {
    const current = actor(request);
    return { data: await service.read(current, params.parse(request.params).conversationId, MarkConversationReadSchema.parse(request.body).messageId) };
  });
  app.post('/:conversationId/realtime-ticket', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { data: await service.ticket(actor(request), params.parse(request.params).conversationId) };
  });

  // Bound live subscriptions per actor per API process, alongside the existing HTTP limiter.
  const presence=new CommunicationsPresence();
  const connectionCounts = new Map<string,number>();
  const subscriptions = new WeakMap<FastifyRequest, { actor: CommunicationsActor; id: string | null; after: string }>();
  for (const path of ['/events','/:conversationId/events']) app.get(path, {
    websocket: true,
    preValidation: async request => {
      const conversationId = path === '/events' ? null : params.parse(request.params).conversationId;
      const query = subscriptionQuery.parse(request.query);
      const current = await service.consumeTicket(conversationId, query.ticket);
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
          if(!current)throw new Error('Choose a conversation');
          await service.authorizeTyping(subscription.actor,current);
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
        const snapshot=JSON.stringify(presence.snapshot(connectionId,scope));
        if(snapshot!==lastSnapshot){socket.send(snapshot);lastSnapshot=snapshot;}
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
