import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { conversationMessages, conversations, getDatabase } from '@ks-os/database';
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
  UpdateWhatsAppMarketingConsentSchema,
  WhatsAppTemplateListResponseSchema,
} from '@ks-os/contracts';
import { ConversationChannelService } from './conversation-channel.service.js';
import { ConversationDeliveryService } from './conversation-delivery.service.js';
import { ConversationService } from './conversation.service.js';
import { WhatsAppMessagingService } from './whatsapp-messaging.service.js';

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
  const db = getDatabase();
  const service = new ConversationService();
  const channelService = new ConversationChannelService();
  const deliveryService = new ConversationDeliveryService();
  const whatsappService = new WhatsAppMessagingService();

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

  app.post('/whatsapp/templates/sync', async request => {
    const currentActor = actor(request);
    if (currentActor.role !== 'owner') {
      throw Object.assign(new Error('Business owner access is required to sync WhatsApp templates.'), { statusCode: 403, code: 'WHATSAPP_TEMPLATE_SYNC_FORBIDDEN' });
    }
    return { data: await whatsappService.syncTemplates(currentActor.tenantId) };
  });

  app.get('/:conversationId/whatsapp/templates', async request => {
    const currentActor = actor(request);
    const { conversationId } = ConversationIdParamsSchema.parse(request.params);
    await service.get(currentActor, conversationId);
    return WhatsAppTemplateListResponseSchema.parse(await whatsappService.listTemplates(currentActor.tenantId, conversationId));
  });

  app.patch('/:conversationId/whatsapp/marketing-consent', async request => {
    const currentActor = actor(request);
    if (currentActor.role !== 'owner') {
      throw Object.assign(new Error('Business owner access is required to change WhatsApp marketing consent.'), { statusCode: 403, code: 'WHATSAPP_CONSENT_FORBIDDEN' });
    }
    const { conversationId } = ConversationIdParamsSchema.parse(request.params);
    await service.get(currentActor, conversationId);
    const input = UpdateWhatsAppMarketingConsentSchema.parse(request.body);
    return { data: await whatsappService.setMarketingConsent(currentActor.tenantId, currentActor.userId, conversationId, input) };
  });

  app.get('/:conversationId', async request => {
    const currentActor = actor(request);
    const { conversationId } = ConversationIdParamsSchema.parse(request.params);
    const data = await service.get(currentActor, conversationId);
    const whatsapp = data.conversation.channel === 'WHATSAPP'
      ? await whatsappService.policy(currentActor.tenantId, conversationId)
      : null;
    return ConversationDetailResponseSchema.parse({ data: { ...data, whatsapp } });
  });

  app.patch('/:conversationId', async request => {
    const { conversationId } = ConversationIdParamsSchema.parse(request.params);
    const input = UpdateConversationSchema.parse(request.body);
    return ConversationResponseSchema.parse({ data: await service.update(actor(request), conversationId, input) });
  });

  app.post('/:conversationId/messages', async request => {
    const currentActor = actor(request);
    const { conversationId } = ConversationIdParamsSchema.parse(request.params);
    const input = SendConversationMessageSchema.parse(request.body);
    const [conversation] = await db.select({ channel: conversations.primaryChannel })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, currentActor.tenantId)))
      .limit(1);
    const resolvedChannel = input.channel || conversation?.channel;
    const prepared = resolvedChannel === 'WHATSAPP'
      ? await whatsappService.validateSend(currentActor.tenantId, conversationId, { ...input, channel: 'WHATSAPP' })
      : { metadata: { source: 'KS_OS_INBOX' } };
    const message = await service.send(currentActor, conversationId, { ...input, channel: resolvedChannel });
    await db.update(conversationMessages).set({ metadataJson: prepared.metadata })
      .where(and(eq(conversationMessages.id, message.id), eq(conversationMessages.tenantId, currentActor.tenantId)));

    void deliveryService.process(20).catch(cause => {
      request.log.error({
        errorType: cause instanceof Error ? cause.name : 'UnknownError',
        conversationId,
        messageId: message.id,
      }, 'Immediate conversation delivery kick failed');
    });

    return ConversationMessageResponseSchema.parse({
      data: { ...message, whatsappTemplate: input.whatsappTemplate || null },
    });
  });

  app.post('/:conversationId/actions/payment-link', async request => {
    const { conversationId } = ConversationIdParamsSchema.parse(request.params);
    return ConversationPaymentLinkResponseSchema.parse({ data: await service.createPaymentLink(actor(request), conversationId) });
  });
}
