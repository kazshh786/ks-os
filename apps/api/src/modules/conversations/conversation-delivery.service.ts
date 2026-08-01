import { and, eq, sql } from 'drizzle-orm';
import {
  communicationChannels,
  conversationMessages,
  conversations,
  getDatabase,
  integrationConnections,
  tenants,
} from '@ks-os/database';
import type { ConversationChannel } from '@ks-os/contracts';
import { getResend } from '../../lib/resend.js';
import { getTwilioClient } from '../../lib/twilio.js';
import { decryptSecret } from '../integrations/integration-security.js';
import { MailboxService } from '../mailboxes/mailbox.service.js';
import { normalizeSmsPhone } from '../sms/phone.js';

const MAX_ATTEMPTS = 5;
const graphVersion = () => process.env.META_GRAPH_VERSION || '';
const safeCode = (value: unknown) => String(value || 'PROVIDER_FAILURE').replace(/[^A-Z0-9_:-]/gi, '_').slice(0, 120).toUpperCase();
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]!));
const tokenFrom = (ciphertext: string | null) => {
  if (!ciphertext) return '';
  const secret = decryptSecret<Record<string, unknown>>(ciphertext);
  return String(secret.accessToken || secret.access_token || secret.token || '');
};

class DeliveryError extends Error {
  constructor(public readonly code: string, public readonly permanent = false) {
    super(code);
  }
}

export class ConversationDeliveryService {
  private db = getDatabase();
  private mailbox = new MailboxService();

  private async context(messageId: string) {
    const [row] = await this.db.select({
      messageId: conversationMessages.id,
      tenantId: conversationMessages.tenantId,
      conversationId: conversationMessages.conversationId,
      channel: conversationMessages.channelType,
      body: conversationMessages.body,
      messageMetadata: conversationMessages.metadataJson,
      attemptCount: conversationMessages.attemptCount,
      subject: conversations.subject,
      customerEmail: conversations.customerEmail,
      customerPhone: conversations.customerPhone,
      conversationMetadata: conversations.metadataJson,
      channelProvider: communicationChannels.provider,
      channelExternalAccountId: communicationChannels.externalAccountId,
      channelMetadata: communicationChannels.metadataJson,
      credentialsReference: communicationChannels.credentialsReference,
      tokenCiphertext: integrationConnections.tokenCiphertext,
      tenantName: tenants.name,
      senderDisplayName: tenants.senderDisplayName,
      replyToEmail: tenants.replyToEmail,
    }).from(conversationMessages)
      .innerJoin(conversations, and(
        eq(conversations.id, conversationMessages.conversationId),
        eq(conversations.tenantId, conversationMessages.tenantId),
      ))
      .innerJoin(communicationChannels, and(
        eq(communicationChannels.id, conversationMessages.channelId),
        eq(communicationChannels.tenantId, conversationMessages.tenantId),
        eq(communicationChannels.status, 'CONNECTED'),
      ))
      .innerJoin(tenants, eq(tenants.id, conversationMessages.tenantId))
      .leftJoin(integrationConnections, and(
        eq(integrationConnections.id, communicationChannels.credentialsReference),
        eq(integrationConnections.tenantId, conversationMessages.tenantId),
      ))
      .where(eq(conversationMessages.id, messageId))
      .limit(1);
    if (!row) throw new DeliveryError('CHANNEL_NOT_CONNECTED', true);
    return row;
  }

  private async deliverEmail(context: Awaited<ReturnType<ConversationDeliveryService['context']>>) {
    if (!context.customerEmail) throw new DeliveryError('EMAIL_RECIPIENT_REQUIRED', true);
    const sender = context.senderDisplayName || context.tenantName;
    if (context.channelProvider === 'GOOGLE_MAIL' || context.channelProvider === 'ZOHO_MAIL') {
      if (!context.credentialsReference) throw new DeliveryError('MAILBOX_CREDENTIALS_REQUIRED', true);
      try {
        return await this.mailbox.sendConnectedEmail(context.credentialsReference, {
          to: context.customerEmail,
          subject: context.subject || `Message from ${sender}`,
          body: context.body,
          senderName: sender,
          conversationMetadata: context.conversationMetadata as Record<string, unknown>,
        });
      } catch (cause) {
        const statusCode = Number((cause as any)?.statusCode || 0);
        throw new DeliveryError(safeCode((cause as any)?.code || (cause instanceof Error ? cause.message : cause)), statusCode === 400 || statusCode === 401 || statusCode === 403 || statusCode === 404);
      }
    }
    const fromAddress = process.env.EMAIL_BOOKINGS_FROM;
    if (!fromAddress) throw new DeliveryError('EMAIL_FROM_NOT_CONFIGURED', true);
    const response = await getResend().emails.send({
      from: `${sender} via KS OS <${fromAddress}>`,
      to: context.customerEmail,
      replyTo: context.replyToEmail || process.env.EMAIL_SUPPORT_REPLY_TO,
      subject: context.subject || `Message from ${sender}`,
      text: context.body,
      html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(context.body)}</div>`,
    }, { idempotencyKey: `conversation-${context.messageId}` });
    if (response.error || !response.data?.id) throw new DeliveryError('EMAIL_PROVIDER_REJECTED');
    return response.data.id;
  }

  private async deliverSms(context: Awaited<ReturnType<ConversationDeliveryService['context']>>) {
    if (!context.customerPhone) throw new DeliveryError('SMS_RECIPIENT_REQUIRED', true);
    const to = normalizeSmsPhone(context.customerPhone);
    const statusCallback = process.env.TWILIO_STATUS_CALLBACK_URL;
    if (!statusCallback) throw new DeliveryError('SMS_STATUS_CALLBACK_NOT_CONFIGURED', true);
    const externalAccount = context.channelExternalAccountId || '';
    const options: Record<string, unknown> = { to, body: context.body, statusCallback };
    if (externalAccount.startsWith('+')) options.from = externalAccount;
    else options.messagingServiceSid = externalAccount.startsWith('MG') ? externalAccount : process.env.TWILIO_MESSAGING_SERVICE_SID;
    if (!options.from && !options.messagingServiceSid) throw new DeliveryError('SMS_SENDER_NOT_CONFIGURED', true);
    const message = await getTwilioClient().messages.create(options as any);
    if (!message.sid) throw new DeliveryError('SMS_PROVIDER_REJECTED');
    return message.sid;
  }

  private metaRecipient(context: Awaited<ReturnType<ConversationDeliveryService['context']>>) {
    const metadata = context.conversationMetadata as Record<string, unknown>;
    return String(
      metadata.externalRecipientId
      || metadata.whatsappId
      || metadata.instagramScopedId
      || metadata.facebookPsid
      || '',
    );
  }

  private async metaRequest(context: Awaited<ReturnType<ConversationDeliveryService['context']>>, body: Record<string, unknown>) {
    const version = graphVersion();
    const accessToken = tokenFrom(context.tokenCiphertext);
    if (!version) throw new DeliveryError('META_GRAPH_VERSION_NOT_CONFIGURED', true);
    if (!accessToken) throw new DeliveryError('META_ACCESS_TOKEN_REQUIRED', true);
    if (!context.channelExternalAccountId) throw new DeliveryError('META_SENDER_ACCOUNT_REQUIRED', true);
    const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(context.channelExternalAccountId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new DeliveryError(`META_HTTP_${response.status}`, response.status >= 400 && response.status < 500 && response.status !== 429);
    return payload;
  }

  private async deliverWhatsApp(context: Awaited<ReturnType<ConversationDeliveryService['context']>>) {
    const recipient = this.metaRecipient(context) || context.customerPhone?.replace(/\D/g, '') || '';
    if (!recipient) throw new DeliveryError('WHATSAPP_RECIPIENT_REQUIRED', true);
    const metadata = (context.messageMetadata || {}) as Record<string, unknown>;
    const template = metadata.whatsappTemplate as {
      name?: string;
      language?: string;
      components?: unknown[];
    } | undefined;
    const requestBody: Record<string, unknown> = template?.name && template.language
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'template',
          template: {
            name: template.name,
            language: { code: template.language },
            ...(Array.isArray(template.components) && template.components.length ? { components: template.components } : {}),
          },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'text',
          text: { preview_url: false, body: context.body },
        };
    const payload = await this.metaRequest(context, requestBody);
    const messageId = payload.messages?.[0]?.id;
    if (!messageId) throw new DeliveryError('WHATSAPP_MESSAGE_ID_MISSING');
    return String(messageId);
  }

  private async deliverMetaInbox(context: Awaited<ReturnType<ConversationDeliveryService['context']>>) {
    const recipient = this.metaRecipient(context);
    if (!recipient) throw new DeliveryError(`${context.channel}_RECIPIENT_REQUIRED`, true);
    const payload = await this.metaRequest(context, {
      recipient: { id: recipient },
      message_type: 'RESPONSE',
      message: { text: context.body },
    });
    const messageId = payload.message_id || payload.messageId;
    if (!messageId) throw new DeliveryError(`${context.channel}_MESSAGE_ID_MISSING`);
    return String(messageId);
  }

  private async deliver(context: Awaited<ReturnType<ConversationDeliveryService['context']>>) {
    switch (context.channel as ConversationChannel) {
      case 'EMAIL': return this.deliverEmail(context);
      case 'SMS': return this.deliverSms(context);
      case 'WHATSAPP': return this.deliverWhatsApp(context);
      case 'INSTAGRAM':
      case 'FACEBOOK': return this.deliverMetaInbox(context);
      default: throw new DeliveryError('CHANNEL_NOT_SUPPORTED', true);
    }
  }

  async process(limit = 20) {
    const claimed = await this.db.execute(sql`
      WITH candidates AS (
        SELECT id
        FROM conversation_messages
        WHERE status = 'QUEUED' AND next_attempt_at <= now()
        ORDER BY next_attempt_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(1, Math.min(limit, 100))}
      )
      UPDATE conversation_messages AS message
      SET attempt_count = message.attempt_count + 1,
          next_attempt_at = now() + interval '5 minutes'
      FROM candidates
      WHERE message.id = candidates.id
      RETURNING message.id
    `);

    let sent = 0;
    let failed = 0;
    let retried = 0;
    for (const claimedRow of claimed.rows as Array<{ id: string }>) {
      try {
        const context = await this.context(claimedRow.id);
        const providerMessageId = await this.deliver(context);
        await this.db.update(conversationMessages).set({
          status: 'SENT',
          externalMessageId: providerMessageId,
          errorCode: null,
          sentAt: new Date(),
          failedAt: null,
        }).where(eq(conversationMessages.id, claimedRow.id));
        sent += 1;
      } catch (cause) {
        const deliveryError = cause instanceof DeliveryError
          ? cause
          : new DeliveryError(safeCode(cause instanceof Error ? cause.message : cause));
        const [current] = await this.db.select({ attemptCount: conversationMessages.attemptCount })
          .from(conversationMessages).where(eq(conversationMessages.id, claimedRow.id)).limit(1);
        const attemptCount = current?.attemptCount || 1;
        const terminal = deliveryError.permanent || attemptCount >= MAX_ATTEMPTS;
        const retryMinutes = Math.min(2 ** attemptCount, 60);
        await this.db.update(conversationMessages).set({
          status: terminal ? 'FAILED' : 'QUEUED',
          errorCode: safeCode(deliveryError.code),
          nextAttemptAt: new Date(Date.now() + retryMinutes * 60_000),
          failedAt: terminal ? new Date() : null,
        }).where(eq(conversationMessages.id, claimedRow.id));
        if (terminal) failed += 1;
        else retried += 1;
      }
    }
    return { claimed: claimed.rows.length, sent, failed, retried };
  }

  async applyProviderStatus(channel: ConversationChannel, externalMessageId: string, providerStatus: string) {
    const normalized = providerStatus.toLowerCase();
    const status = normalized === 'read' ? 'READ'
      : normalized === 'delivered' ? 'DELIVERED'
        : ['failed', 'undelivered'].includes(normalized) ? 'FAILED'
          : ['sent', 'accepted', 'queued'].includes(normalized) ? 'SENT'
            : null;
    if (!status) return false;
    const now = new Date();
    const result = await this.db.update(conversationMessages).set({
      status,
      ...(status === 'DELIVERED' ? { deliveredAt: now } : {}),
      ...(status === 'READ' ? { readAt: now, deliveredAt: now } : {}),
      ...(status === 'FAILED' ? { failedAt: now, errorCode: safeCode(providerStatus) } : {}),
    }).where(and(
      eq(conversationMessages.channelType, channel),
      eq(conversationMessages.externalMessageId, externalMessageId),
    )).returning({ id: conversationMessages.id });
    return result.length > 0;
  }
}
