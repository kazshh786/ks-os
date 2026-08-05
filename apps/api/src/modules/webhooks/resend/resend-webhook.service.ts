import {
  communicationChannels,
  emailOutbox,
  emailSuppressions,
  emailWebhookEvents,
  getDatabase,
  reviewInvitations,
} from '@ks-os/database';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Webhook } from 'svix';
import { getResend } from '../../../lib/resend.js';
import { ConversationDeliveryService } from '../../conversations/conversation-delivery.service.js';
import { ConversationIngestService } from '../../conversations/conversation-ingest.service.js';
import { OperationsIssueReporter } from '../../operations/operations.issue-service.js';
import { resendOutboxStatusesBefore } from './resend-delivery-status.js';

const STATUS_BY_EVENT: Record<string, string> = {
  'email.sent': 'SENT',
  'email.delivered': 'DELIVERED',
  'email.delivery_delayed': 'DELAYED',
  'email.bounced': 'BOUNCED',
  'email.complained': 'COMPLAINED',
  'email.failed': 'FAILED',
};

const PROVIDER_STATUS_BY_EVENT: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'sent',
  'email.bounced': 'failed',
  'email.complained': 'failed',
  'email.failed': 'failed',
};

const values = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(values);
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
};

const emailAddress = (value: string) => {
  const angleMatch = value.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].trim().toLowerCase();
  const plainMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return plainMatch?.[0]?.toLowerCase() || '';
};

const displayName = (value: string) => {
  const address = emailAddress(value);
  const candidate = value.replace(/<[^>]+>/g, '').replace(address, '').replace(/^['"]|['"]$/g, '').trim();
  return candidate || undefined;
};

const plainText = (html: string) => html
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#0?39;/gi, "'")
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

export class ResendWebhookService {
  private issues = new OperationsIssueReporter();
  private ingest = new ConversationIngestService();
  private delivery = new ConversationDeliveryService();

  private async processInboundEmail(eventId: string, providerMessageId: string, event: any) {
    const db = getDatabase();
    const [existing] = await db.select({ eventId: emailWebhookEvents.eventId })
      .from(emailWebhookEvents)
      .where(eq(emailWebhookEvents.eventId, eventId))
      .limit(1);
    if (existing) return;

    const receivingApi = (getResend().emails as any).receiving;
    if (!receivingApi?.get) throw new Error('RESEND_INBOUND_EMAIL_API_UNAVAILABLE');
    const response = await receivingApi.get(providerMessageId);
    if (response?.error) throw new Error(response.error.message || response.error.name || 'RESEND_INBOUND_EMAIL_RETRIEVE_FAILED');
    const received = response?.data || {};

    const recipients = [...values(received.to), ...values(event.data?.to)]
      .map(emailAddress)
      .filter(Boolean);
    let channel: { id: string; tenantId: string } | undefined;
    for (const recipient of recipients) {
      [channel] = await db.select({ id: communicationChannels.id, tenantId: communicationChannels.tenantId })
        .from(communicationChannels)
        .where(and(
          eq(communicationChannels.channelType, 'EMAIL'),
          eq(communicationChannels.status, 'CONNECTED'),
          sql`lower(${communicationChannels.externalAccountId}) = ${recipient}`,
        ))
        .limit(1);
      if (channel) break;
    }

    if (channel) {
      const rawFrom = values(received.from)[0] || values(event.data?.from)[0] || '';
      const senderEmail = emailAddress(rawFrom);
      if (!senderEmail) throw new Error('RESEND_INBOUND_EMAIL_SENDER_REQUIRED');
      const attachmentCount = Array.isArray(received.attachments) ? received.attachments.length : 0;
      const content = String(received.text || '').trim()
        || plainText(String(received.html || ''))
        || (attachmentCount ? '[Email attachment received]' : '[Email received]');
      const body = attachmentCount > 0 ? `${content}\n\n[${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'} received]` : content;
      await this.ingest.ingest({
        tenantId: channel.tenantId,
        channelId: channel.id,
        channel: 'EMAIL',
        externalSenderId: senderEmail,
        externalMessageId: providerMessageId,
        body,
        customerName: displayName(rawFrom),
        customerEmail: senderEmail,
        metadata: {
          subject: String(received.subject || event.data?.subject || ''),
          messageId: String(received.message_id || event.data?.message_id || providerMessageId),
          recipients,
          attachmentCount,
          receivedAt: event.created_at || null,
        },
      });
    }

    await db.insert(emailWebhookEvents).values({
      eventId,
      eventType: event.type,
      providerMessageId,
      processedAt: new Date(),
    }).onConflictDoNothing({ target: emailWebhookEvents.eventId });
  }

  async processWebhook(payload: string, headers: Record<string, string | string[] | undefined>) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) throw new Error('RESEND_WEBHOOK_SECRET is not configured');
    let event: any;
    try {
      event = new Webhook(secret).verify(payload, headers as Record<string, string>);
    } catch {
      throw new Error('Invalid signature');
    }

    const eventId = headers['svix-id'];
    const providerMessageId = event.data?.email_id;
    if (typeof eventId !== 'string' || !providerMessageId) return;

    if (event.type === 'email.received') {
      await this.processInboundEmail(eventId, providerMessageId, event);
      return;
    }

    const status = STATUS_BY_EVENT[event.type];
    if (!status) return;
    const db = getDatabase();
    await db.transaction(async tx => {
      const inserted = await tx.insert(emailWebhookEvents).values({ eventId, eventType: event.type, providerMessageId })
        .onConflictDoNothing({ target: emailWebhookEvents.eventId })
        .returning({ eventId: emailWebhookEvents.eventId });
      if (!inserted.length) return;

      const providerStatus = PROVIDER_STATUS_BY_EVENT[event.type];
      if (providerStatus) await this.delivery.applyProviderStatus('EMAIL', providerMessageId, providerStatus);

      const [message] = await tx.select().from(emailOutbox).where(eq(emailOutbox.providerMessageId, providerMessageId)).limit(1);
      if (!message) {
        await tx.update(emailWebhookEvents).set({ processedAt: new Date() }).where(eq(emailWebhookEvents.eventId, eventId));
        return;
      }

      const allowedCurrentStatuses = resendOutboxStatusesBefore(status);
      const applied = allowedCurrentStatuses.length
        ? await tx.update(emailOutbox).set({
          status,
          deliveredAt: status === 'DELIVERED' ? new Date() : message.deliveredAt,
          failedAt: ['BOUNCED', 'COMPLAINED', 'FAILED'].includes(status) ? new Date() : message.failedAt,
          lastErrorCode: ['BOUNCED', 'COMPLAINED', 'FAILED'].includes(status) ? status : message.lastErrorCode,
        }).where(and(
          eq(emailOutbox.id, message.id),
          inArray(emailOutbox.status, allowedCurrentStatuses),
        )).returning({ id: emailOutbox.id })
        : [];
      if (applied.length) {
        if (status === 'BOUNCED' || status === 'COMPLAINED') {
          await tx.insert(emailSuppressions).values({ recipientEmailNormalized: message.recipientEmail.toLowerCase(), reason: status })
            .onConflictDoUpdate({ target: emailSuppressions.recipientEmailNormalized, set: { reason: status } });
        }
        if (message.relatedEntityType === 'review_invitation' && message.relatedEntityId && message.tenantId) {
          await tx.update(reviewInvitations).set({
            status: status === 'DELIVERED' ? 'DELIVERED' : ['BOUNCED', 'COMPLAINED', 'FAILED'].includes(status) ? 'FAILED' : undefined,
            deliveredAt: status === 'DELIVERED' ? new Date() : undefined,
            failureCode: ['BOUNCED', 'COMPLAINED', 'FAILED'].includes(status) ? `EMAIL_${status}` : undefined,
            updatedAt: new Date(),
          }).where(and(eq(reviewInvitations.id, message.relatedEntityId), eq(reviewInvitations.tenantId, message.tenantId)));
        }
        if (message.tenantId && ['BOUNCED', 'COMPLAINED', 'FAILED'].includes(status)) {
          const formDelivery = message.templateKey.startsWith('form-');
          const issueType = formDelivery ? 'FORM_DELIVERY_FAILED' : status === 'BOUNCED' ? 'EMAIL_BOUNCED' : 'EMAIL_FAILED';
          await this.issues.report({
            tenantId: message.tenantId,
            category: formDelivery ? 'FORM' : 'EMAIL',
            issueType,
            severity: status === 'COMPLAINED' ? 'CRITICAL' : 'WARNING',
            title: formDelivery ? 'Form delivery failed' : status === 'BOUNCED' ? 'Email bounced' : 'Email delivery failed',
            message: 'A provider reported a permanent transactional email delivery problem.',
            sourceType: 'EMAIL_OUTBOX',
            sourceId: message.id,
            deduplicationKey: `${issueType}:${message.id}`,
            relatedAppointmentId: message.relatedEntityType === 'appointment' ? message.relatedEntityId : null,
            metadata: { providerStatus: status },
          }, tx);
        }
        if (message.tenantId && status === 'DELIVERED') {
          await this.issues.resolve(message.tenantId, `EMAIL_FAILED:${message.id}`, tx);
          await this.issues.resolve(message.tenantId, `EMAIL_BOUNCED:${message.id}`, tx);
          await this.issues.resolve(message.tenantId, `FORM_DELIVERY_FAILED:${message.id}`, tx);
        }
      }
      await tx.update(emailWebhookEvents).set({ processedAt: new Date() }).where(eq(emailWebhookEvents.eventId, eventId));
    });
  }
}
