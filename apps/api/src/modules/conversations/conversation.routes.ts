import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CommunicationChannelListResponseSchema,
  ConversationDetailResponseSchema,
  ConversationIdParamsSchema,
  ConversationListQuerySchema,
  ConversationListResponseSchema,
  ConversationMessageResponseSchema,
  ConversationPaymentLinkResponseSchema,
  ConversationResponseSchema,
  SendConversationMessageSchema,
  UpdateConversationSchema,
} from '@ks-os/contracts';
import { ConversationChannelService } from './conversation-channel.service.js';
import { ConversationDeliveryService } from './conversation-delivery.service.js';
import { ConversationService } from './conversation.service.js';

const inboxPermissions = new Set(['OPERATIONS_VIEW_ASSIGNED', 'OPERATIONS_VIEW_ALL', 'OPERATIONS_MANAGE']);

const actor = (request: FastifyRequest) => {
  request.requireAuth();
  const auth = request.auth!;
  if (auth.role !== 'owner' && !auth.permissions.some(permission => inboxPermissions.has(permission))) {
    throw Object.assign(new Error('Inbox access is not enabled for this team member'), { statusCode: 403, code: 'FORBIDDEN' });
  }
  const scope = auth.role === 'owner' || auth.permissions.some(permission => permission === 'OPERATIONS_VIEW_ALL' || permission === 'OPERATIONS_MANAGE')
    ? 'ALL'
    : 'ASSIGNED';
  return {
    tenantId: auth.tenantId,
    userId: auth.tenantUserId,
    role: auth.role,
    scope,
  } as const;
};

export async function conversationRoutes(app: FastifyInstance) {
  const service = new ConversationService();
  const channelService = new ConversationChannelService();
  const deliveryService = new ConversationDeliveryService();

  app.get('/', async request => {
    const query = ConversationListQuerySchema.parse(request.query);
    return ConversationListResponseSchema.parse(await service.list(actor(request), query));
  });

  app.get('/channels', async request => {
    const currentActor = actor(request);
    return CommunicationChannelListResponseSchema.parse({ data: await channelService.list(currentActor.tenantId) });
  });

  app.post('/worker/run', async request => {
    const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!process.env.CONVERSATION_WORKER_SECRET || supplied !== process.env.CONVERSATION_WORKER_SECRET) {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401, code: 'UNAUTHENTICATED' });
    }
    const requestedLimit = Number((request.query as { limit?: string }).limit || 20);
    return { data: await deliveryService.process(Number.isFinite(requestedLimit) ? requestedLimit : 20) };
  });

  app.get('/:conversationId', async request => {
    const { conversationId } = ConversationIdParamsSchema.parse(request.params);
    return ConversationDetailResponseSchema.parse({ data: await service.get(actor(request), conversationId) });
  });

  app.patch('/:conversationId', async request => {
    const { conversationId } = ConversationIdParamsSchema.parse(request.params);
    const input = UpdateConversationSchema.parse(request.body);
    return ConversationResponseSchema.parse({ data: await service.update(actor(request), conversationId, input) });
  });

  app.post('/:conversationId/messages', async request => {
    const { conversationId } = ConversationIdParamsSchema.parse(request.params);
    const input = SendConversationMessageSchema.parse(request.body);
    const message = await service.send(actor(request), conversationId, input);

    void deliveryService.process(20).catch(cause => {
      request.log.error({
        errorType: cause instanceof Error ? cause.name : 'UnknownError',
        conversationId,
        messageId: message.id,
      }, 'Immediate conversation delivery kick failed');
    });

    return ConversationMessageResponseSchema.parse({ data: message });
  });

  app.post('/:conversationId/actions/payment-link', async request => {
    const { conversationId } = ConversationIdParamsSchema.parse(request.params);
    return ConversationPaymentLinkResponseSchema.parse({ data: await service.createPaymentLink(actor(request), conversationId) });
  });
}
