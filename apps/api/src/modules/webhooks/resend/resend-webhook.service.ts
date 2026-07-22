import { getDatabase, emailOutbox, emailSuppressions, emailWebhookEvents, reviewInvitations } from '@ks-os/database';
import { and, eq } from 'drizzle-orm';
import { Webhook } from 'svix';
import { OperationsIssueReporter } from '../../operations/operations.issue-service.js';

const STATUS_BY_EVENT: Record<string, string> = {
  'email.sent': 'SENT', 'email.delivered': 'DELIVERED', 'email.delivery_delayed': 'DELAYED',
  'email.bounced': 'BOUNCED', 'email.complained': 'COMPLAINED', 'email.failed': 'FAILED',
};

export class ResendWebhookService {
  private issues=new OperationsIssueReporter();
  async processWebhook(payload: string, headers: Record<string, string | string[] | undefined>) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) throw new Error('RESEND_WEBHOOK_SECRET is not configured');
    let event: any;
    try { event = new Webhook(secret).verify(payload, headers as Record<string, string>); }
    catch { throw new Error('Invalid signature'); }

    const eventId = headers['svix-id'];
    const providerMessageId = event.data?.email_id;
    if (typeof eventId !== 'string' || !providerMessageId || !STATUS_BY_EVENT[event.type]) return;
    const db = getDatabase();
    await db.transaction(async (tx) => {
      const inserted = await tx.insert(emailWebhookEvents).values({ eventId, eventType: event.type, providerMessageId })
        .onConflictDoNothing({ target: emailWebhookEvents.eventId }).returning({ eventId: emailWebhookEvents.eventId });
      if (!inserted.length) return;
      const [message] = await tx.select().from(emailOutbox).where(eq(emailOutbox.providerMessageId, providerMessageId)).limit(1);
      if (!message) return;
      const status = STATUS_BY_EVENT[event.type];
      await tx.update(emailOutbox).set({
        status,
        deliveredAt: status === 'DELIVERED' ? new Date() : message.deliveredAt,
        failedAt: ['BOUNCED', 'COMPLAINED', 'FAILED'].includes(status) ? new Date() : message.failedAt,
        lastErrorCode: ['BOUNCED', 'COMPLAINED', 'FAILED'].includes(status) ? status : message.lastErrorCode,
      }).where(eq(emailOutbox.id, message.id));
      if (status === 'BOUNCED' || status === 'COMPLAINED') {
        await tx.insert(emailSuppressions).values({ recipientEmailNormalized: message.recipientEmail.toLowerCase(), reason: status })
          .onConflictDoUpdate({ target: emailSuppressions.recipientEmailNormalized, set: { reason: status } });
      }
      if (message.relatedEntityType === 'review_invitation' && message.relatedEntityId && message.tenantId) {
        await tx.update(reviewInvitations).set({
          status: status === 'DELIVERED' ? 'DELIVERED' : ['BOUNCED', 'COMPLAINED', 'FAILED'].includes(status) ? 'FAILED' : undefined,
          deliveredAt: status === 'DELIVERED' ? new Date() : undefined,
          failureCode: ['BOUNCED', 'COMPLAINED', 'FAILED'].includes(status) ? 'EMAIL_' + status : undefined,
          updatedAt: new Date(),
        }).where(and(eq(reviewInvitations.id, message.relatedEntityId), eq(reviewInvitations.tenantId, message.tenantId)));
      }
      if(message.tenantId&&['BOUNCED','COMPLAINED','FAILED'].includes(status)){const formDelivery=message.templateKey.startsWith('form-');const issueType=formDelivery?'FORM_DELIVERY_FAILED':status==='BOUNCED'?'EMAIL_BOUNCED':'EMAIL_FAILED';await this.issues.report({tenantId:message.tenantId,category:formDelivery?'FORM':'EMAIL',issueType,severity:status==='COMPLAINED'?'CRITICAL':'WARNING',title:formDelivery?'Form delivery failed':status==='BOUNCED'?'Email bounced':'Email delivery failed',message:'A provider reported a permanent transactional email delivery problem.',sourceType:'EMAIL_OUTBOX',sourceId:message.id,deduplicationKey:`${issueType}:${message.id}`,relatedAppointmentId:message.relatedEntityType==='appointment'?message.relatedEntityId:null,metadata:{providerStatus:status}},tx);}
      if(message.tenantId&&status==='DELIVERED'){await this.issues.resolve(message.tenantId,`EMAIL_FAILED:${message.id}`,tx);await this.issues.resolve(message.tenantId,`EMAIL_BOUNCED:${message.id}`,tx);await this.issues.resolve(message.tenantId,`FORM_DELIVERY_FAILED:${message.id}`,tx);}
      await tx.update(emailWebhookEvents).set({ processedAt: new Date() }).where(eq(emailWebhookEvents.eventId, eventId));
    });
  }
}
