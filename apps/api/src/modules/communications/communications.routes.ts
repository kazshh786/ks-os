import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AddConversationMemberSchema, CommunicationPositionSchema, CreateNativeConversationSchema,
  CreateNativeMessageSchema, MarkConversationReadSchema, NativeConversationQuerySchema, NativeMessageQuerySchema,
} from '@ks-os/contracts';
import { CommunicationsActorSchema, communicationError, type CommunicationsActor } from './communications.authorization.js';
import { CommunicationsService } from './communications.service.js';

const params = z.object({ conversationId: z.string().uuid() });
const memberParams = params.extend({ userId: z.string().uuid() });
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

  const subscriptions = new WeakMap<FastifyRequest, { actor: CommunicationsActor; id: string; after: string }>();
  app.get('/:conversationId/events', {
    websocket: true,
    preValidation: async request => {
      const { conversationId } = params.parse(request.params);
      const query = subscriptionQuery.parse(request.query);
      const current = await service.consumeTicket(conversationId, query.ticket);
      subscriptions.set(request, { actor: current, id: conversationId, after: query.after });
    },
  }, (socket, request) => {
    const subscription = subscriptions.get(request)!;
    let after = subscription.after;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let alive = true;
    let polls = 0;
    const stop = () => { stopped = true; if (timer) clearTimeout(timer); };
    socket.on('close', stop);
    socket.on('error', stop);
    socket.on('pong', () => { alive = true; });
    // Writes always go through the authenticated, validated HTTP APIs.
    socket.on('message', () => { stop(); socket.close(1008, 'Use the HTTP API for writes'); });
    const poll = async () => {
      if (stopped || socket.readyState !== 1) return;
      try {
        if (socket.bufferedAmount > 262144) { stop(); socket.close(1013, 'Reconnect with your last cursor'); return; }
        const events = await service.events(subscription.actor, subscription.id, after);
        if (stopped || socket.readyState !== 1) return;
        for (const event of events) { socket.send(JSON.stringify(event)); after = event.id; }
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
