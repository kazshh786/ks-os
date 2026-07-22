import { and, eq, inArray, sql } from 'drizzle-orm';
import { clients, getDatabase, reviewInvitations, smsOutbox, tenants } from '@ks-os/database';
import { renderSms, type SmsTemplateKey } from '@ks-os/notifications';
import { env } from '../../config/env.js';
import { getTwilioClient, isSmsConfigured } from '../../lib/twilio.js';
import { normalizeSmsPhone } from './phone.js';
import { OperationsIssueReporter } from '../operations/operations.issue-service.js';
import { deriveReviewInvitationToken } from '../reputation/reputation.security.js';

export class SmsService {
  private issues=new OperationsIssueReporter();
  async enqueue(params: { tenantId: string; clientId?: string; appointmentId?: string; formAssignmentId?: string; recipientPhone: string; templateKey: SmsTemplateKey; templateData: Record<string, unknown>; idempotencyKey: string; scheduledFor?: Date; validUntil?: Date }, tx?: any) {
    const db = tx ?? getDatabase();
    let phone: string;
    try { phone = normalizeSmsPhone(params.recipientPhone); } catch { return false; }
    if (params.clientId) {
      const [client] = await db.select().from(clients).where(and(eq(clients.id, params.clientId), eq(clients.tenantId, params.tenantId))).limit(1);
      if (!client || client.smsTransactionalStatus === 'OPTED_OUT' || client.smsTransactionalStatus === 'SUPPRESSED') return false;
    }
    await db.insert(smsOutbox).values({ tenantId: params.tenantId, clientId: params.clientId, appointmentId: params.appointmentId, formAssignmentId: params.formAssignmentId, recipientPhoneE164: phone, templateKey: params.templateKey, templateDataJson: params.templateData, idempotencyKey: params.idempotencyKey, scheduledFor: params.scheduledFor ?? new Date(), validUntil: params.validUntil, nextAttemptAt: params.scheduledFor ?? new Date() }).onConflictDoNothing({ target: smsOutbox.idempotencyKey });
    return true;
  }
  async cancelAppointmentReminders(tenantId: string, appointmentId: string, tx?: any) {
    await (tx ?? getDatabase()).update(smsOutbox).set({ status: 'CANCELLED' }).where(and(eq(smsOutbox.tenantId, tenantId), eq(smsOutbox.appointmentId, appointmentId), eq(smsOutbox.templateKey, 'appointment-reminder'), inArray(smsOutbox.status, ['PENDING','PROCESSING'])));
  }
  async processOutbox(limit = 10) {
    if (!isSmsConfigured()) throw new Error('SMS_NOT_CONFIGURED');
    const db = getDatabase();
    const claimed = await db.execute(sql`UPDATE sms_outbox SET status='PROCESSING' WHERE id IN (SELECT id FROM sms_outbox WHERE status='PENDING' AND scheduled_for<=now() AND next_attempt_at<=now() ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT ${limit}) RETURNING *`);
    for (const row of claimed.rows as any[]) {
      try {
        if (row.valid_until && new Date(row.valid_until) <= new Date()) { await db.update(smsOutbox).set({ status: 'EXPIRED', failedAt: new Date(), lastErrorCode: 'EXPIRED' }).where(eq(smsOutbox.id, row.id)); continue; }
        const [tenant] = await db.select().from(tenants).where(eq(tenants.id, row.tenant_id)).limit(1);
        if (!tenant?.smsEnabled) { await db.update(smsOutbox).set({ status: 'SUPPRESSED', lastErrorCode: 'SMS_DISABLED' }).where(eq(smsOutbox.id, row.id)); continue; }
        if (row.client_id) {
          const [client] = await db.select().from(clients).where(eq(clients.id, row.client_id)).limit(1);
          if (client?.smsTransactionalStatus === 'OPTED_OUT' || client?.smsTransactionalStatus === 'SUPPRESSED') { await db.update(smsOutbox).set({ status: 'SUPPRESSED', lastErrorCode: 'SMS_RECIPIENT_SUPPRESSED' }).where(eq(smsOutbox.id, row.id)); continue; }
        }
        const templateData = { ...(row.template_data_json as Record<string, unknown>), salonName: tenant.name } as any;
        if (row.template_key === 'review-invitation') {
          const invitationId = String(templateData.reviewInvitationId ?? '');
          if (!env.PUBLIC_APP_ORIGIN || !invitationId) throw new Error('REVIEW_INVITATION_LINK_NOT_CONFIGURED');
          templateData.secureUrl = env.PUBLIC_APP_ORIGIN.replace(/\/$/, '') + '/review/' + deriveReviewInvitationToken(invitationId);
        }
        const rendered = renderSms(row.template_key, templateData, 2);
        const message = await getTwilioClient().messages.create({ messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID!, to: row.recipient_phone_e164, body: rendered.body, statusCallback: env.TWILIO_STATUS_CALLBACK_URL!, validityPeriod: env.SMS_DEFAULT_VALIDITY_SECONDS });
        await db.update(smsOutbox).set({ status: 'ACCEPTED', providerMessageSid: message.sid, attemptCount: row.attempt_count + 1, segmentCount: rendered.segmentCount, encoding: rendered.encoding, sentAt: new Date() }).where(eq(smsOutbox.id, row.id));
        if (row.template_key === 'review-invitation' && templateData.reviewInvitationId) await db.update(reviewInvitations).set({ status: 'SENT', sentAt: new Date(), updatedAt: new Date() }).where(eq(reviewInvitations.id, String(templateData.reviewInvitationId)));
      } catch (error: any) {
        const attempts = row.attempt_count + 1; const permanent = ['SMS_RECIPIENT_INVALID','SMS_RECIPIENT_OPTED_OUT','SMS_TEMPLATE_TOO_LONG'].includes(error.message) || ['21211','21610','21614'].includes(String(error.code));
        const failed=permanent || attempts >= env.SMS_MAX_ATTEMPTS;await db.update(smsOutbox).set({ status: failed ? 'FAILED' : 'PENDING', attemptCount: attempts, nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts, 60) * 60000), lastErrorCode: permanent ? 'INVALID_PHONE_NUMBER' : 'TEMPORARY_PROVIDER_FAILURE', failedAt: failed ? new Date() : null }).where(eq(smsOutbox.id, row.id));
        if(failed){const formDelivery=!!row.form_assignment_id;const issueType=formDelivery?'FORM_DELIVERY_FAILED':'SMS_FAILED';await this.issues.report({tenantId:row.tenant_id,category:formDelivery?'FORM':'SMS',issueType,severity:'WARNING',title:formDelivery?'Form delivery failed':'SMS delivery failed',message:'A transactional SMS could not be delivered after retrying.',sourceType:'SMS_OUTBOX',sourceId:row.id,deduplicationKey:`${issueType}:${row.id}`,relatedAppointmentId:row.appointment_id,metadata:{templateKey:row.template_key,errorCode:permanent?'INVALID_PHONE_NUMBER':'TEMPORARY_PROVIDER_FAILURE'}});}
      }
    }
    return claimed.rows.length;
  }
}
