import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { communicationChannels, getDatabase } from '@ks-os/database';
import type { ConversationChannel } from '@ks-os/contracts';
import { ConversationDeliveryService } from '../../conversations/conversation-delivery.service.js';
import { ConversationIngestService } from '../../conversations/conversation-ingest.service.js';

const verifySignature = (rawBody: string, supplied: string | undefined) => {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !supplied?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
};

const messageBody = (message: any) => {
  if (message?.text?.body) return String(message.text.body);
  if (message?.button?.text) return String(message.button.text);
  if (message?.interactive?.button_reply?.title) return String(message.interactive.button_reply.title);
  if (message?.interactive?.list_reply?.title) return String(message.interactive.list_reply.title);
  if (message?.image?.caption) return String(message.image.caption);
  if (message?.video?.caption) return String(message.video.caption);
  if (message?.document?.caption) return String(message.document.caption);
  return message?.type ? `[${String(message.type).replaceAll('_', ' ')} received]` : '[Message received]';
};

export const metaWebhookRoutes: FastifyPluginAsync = async app => {
  const db = getDatabase();
  const ingest = new ConversationIngestService();
  const delivery = new ConversationDeliveryService();

  app.get('/', async (request, reply) => {
    const query = request.query as Record<string, string>;
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      return reply.type('text/plain').send(query['hub.challenge'] || '');
    }
    return reply.code(403).send({ error: { code: 'META_WEBHOOK_VERIFICATION_FAILED' } });
  });

  app.post('/', async (request, reply) => {
    const rawBody = String((request as any).rawBody || '');
    const signature = request.headers['x-hub-signature-256'] as string | undefined;
    if (!verifySignature(rawBody, signature)) return reply.code(401).send({ error: { code: 'META_WEBHOOK_SIGNATURE_INVALID' } });
    const payload = request.body as any;
    const object = String(payload?.object || '');

    if (object === 'whatsapp_business_account') {
      for (const entry of payload.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value || {};
          const senderAccountId = String(value.metadata?.phone_number_id || '');
          const [channel] = senderAccountId ? await db.select({ id: communicationChannels.id, tenantId: communicationChannels.tenantId })
            .from(communicationChannels)
            .where(and(
              eq(communicationChannels.channelType, 'WHATSAPP'),
              eq(communicationChannels.status, 'CONNECTED'),
              eq(communicationChannels.externalAccountId, senderAccountId),
            )).limit(1) : [];

          for (const status of value.statuses || []) {
            if (status.id) await delivery.applyProviderStatus('WHATSAPP', String(status.id), String(status.status || ''));
          }
          if (!channel) continue;
          const names = new Map<string, string>((value.contacts || []).map((contact: any) => [String(contact.wa_id || ''), String(contact.profile?.name || '')]));
          for (const message of value.messages || []) {
            if (!message.id || !message.from) continue;
            const sender = String(message.from);
            await ingest.ingest({
              tenantId: channel.tenantId,
              channelId: channel.id,
              channel: 'WHATSAPP',
              externalSenderId: sender,
              externalMessageId: String(message.id),
              body: messageBody(message),
              customerName: names.get(sender) || undefined,
              customerPhone: sender.startsWith('+') ? sender : `+${sender}`,
              metadata: {
                whatsappId: sender,
                messageType: message.type || 'unknown',
                contextMessageId: message.context?.id || null,
                providerTimestamp: message.timestamp || null,
              },
            });
          }
        }
      }
      return reply.code(200).send({ received: true });
    }

    const channelType: ConversationChannel | null = object === 'instagram' ? 'INSTAGRAM' : object === 'page' ? 'FACEBOOK' : null;
    if (!channelType) return reply.code(200).send({ received: true });
    for (const entry of payload.entry || []) {
      const senderAccountId = String(entry.id || '');
      const [channel] = senderAccountId ? await db.select({ id: communicationChannels.id, tenantId: communicationChannels.tenantId })
        .from(communicationChannels)
        .where(and(
          eq(communicationChannels.channelType, channelType),
          eq(communicationChannels.status, 'CONNECTED'),
          eq(communicationChannels.externalAccountId, senderAccountId),
        )).limit(1) : [];
      for (const event of entry.messaging || []) {
        for (const mid of event.delivery?.mids || []) await delivery.applyProviderStatus(channelType, String(mid), 'delivered');
        if (!channel || event.message?.is_echo || !event.message?.mid || !event.sender?.id) continue;
        const attachments = event.message.attachments || [];
        await ingest.ingest({
          tenantId: channel.tenantId,
          channelId: channel.id,
          channel: channelType,
          externalSenderId: String(event.sender.id),
          externalMessageId: String(event.message.mid),
          body: event.message.text || (attachments.length ? '[Attachment received]' : '[Message received]'),
          metadata: {
            externalRecipientId: String(event.sender.id),
            attachments: attachments.map((attachment: any) => ({ type: attachment.type, url: attachment.payload?.url || null })),
            providerTimestamp: event.timestamp || null,
          },
        });
      }
    }
    return reply.code(200).send({ received: true });
  });
};
