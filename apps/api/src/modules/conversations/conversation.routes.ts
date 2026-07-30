import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
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
import { ConversationService } from './conversation.service.js';

const inboxPermissions = new Set(['OPERATIONS_VIEW_ASSIGNED', 'OPERATIONS_VIEW_ALL', 'OPERATIONS_MANAGE']);

const actor = (request: FastifyRequest) => {
  request.requireAuth();
  const auth = request.auth!;
  if (auth.role !== 'owner' && !auth.permissions.some(permission => inboxPermissions.has(permission))) {
    throw Object.assign(new Error('Inbox access is not enabled for this team member'), { statusCode: 403, code: 'FORBIDDEN' });
  }
  return {
    tenantId: auth.tenantId,
    userId: auth.tenantUserId,
    role: auth.role,
  } as const;
};

export async function conversationRoutes(app: FastifyInstance) {
  const service = new ConversationService();

  app.get('/', async request => {
    const query = ConversationListQuerySchema.parse(request.query);
    return ConversationListResponseSchema.parse(await service.list(actor(request), query));
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
    return ConversationMessageResponseSchema.parse({ data: await service.send(actor(request), conversationId, input) });
  });

  app.post('/:conversationId/actions/payment-link', async request => {
    const { conversationId } = ConversationIdParamsSchema.parse(request.params);
    return ConversationPaymentLinkResponseSchema.parse({ data: await service.createPaymentLink(actor(request), conversationId) });
  });
}
