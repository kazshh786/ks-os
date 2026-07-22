import { getDatabase, emailOutbox, emailSuppressions, reviewInvitations } from '@ks-os/database';
import { eq, sql } from 'drizzle-orm';
import { renderEmail } from '@ks-os/email';
import { getResend } from '../../lib/resend.js';
import { OperationsIssueReporter } from '../operations/operations.issue-service.js';
import { deriveReviewInvitationToken } from '../reputation/reputation.security.js';
import { env } from '../../config/env.js';

export type EnqueueEmailParams = {
  tenantId?: string;
  recipientEmail: string;
  recipientName?: string;
  replyToEmail?: string;
  templateKey: string;
  templateVersion?: string;
  templateDataJson: Record<string, unknown>;
  idempotencyKey: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  scheduledFor?: Date;
};

const SUBJECTS: Record<string, string> = {
  'booking-confirmed': 'Your booking is confirmed',
  'booking-rescheduled': 'Your booking has been rescheduled',
  'booking-cancelled': 'Your booking has been cancelled',
  'appointment-reminder': 'Reminder: upcoming appointment',
  'payment-confirmed': 'Payment confirmed',
  'refund-updated': 'Refund update',
  'form-assigned': 'Please complete your form',
  'form-reminder': 'Reminder: form completion required',
  'staff-operational-notification': 'Operational notification',
  'scheduled-report-ready': 'Your scheduled report is ready',
  'review-invitation': 'An invitation to share honest feedback',
  'customer-portal-claim': 'View your customer portal',
  'account-access-invitation': 'Your KS OS invitation',
};

const FROM_ENV: Record<string, string> = {
  'booking-confirmed': 'EMAIL_BOOKINGS_FROM',
  'booking-rescheduled': 'EMAIL_BOOKINGS_FROM',
  'booking-cancelled': 'EMAIL_BOOKINGS_FROM',
  'appointment-reminder': 'EMAIL_BOOKINGS_FROM',
  'payment-confirmed': 'EMAIL_PAYMENTS_FROM',
  'refund-updated': 'EMAIL_PAYMENTS_FROM',
  'form-assigned': 'EMAIL_FORMS_FROM',
  'form-reminder': 'EMAIL_FORMS_FROM',
  'scheduled-report-ready': 'EMAIL_BOOKINGS_FROM',
  'review-invitation': 'EMAIL_BOOKINGS_FROM',
  'customer-portal-claim': 'EMAIL_AUTH_FROM',
  'account-access-invitation': 'EMAIL_AUTH_FROM',
  'staff-operational-notification': 'EMAIL_AUTH_FROM',
};

export const EMAIL_SUBJECTS = SUBJECTS;
export const EMAIL_FROM_ENV = FROM_ENV;

export class EmailService {
  private issues=new OperationsIssueReporter();
  async enqueueEmail(params: EnqueueEmailParams, tx?: any) {
    const dbOrTx = tx || getDatabase();
    const normalizedRecipient = params.recipientEmail.trim().toLowerCase();
    const [suppression] = await dbOrTx.select({ id: emailSuppressions.id })
      .from(emailSuppressions)
      .where(eq(emailSuppressions.recipientEmailNormalized, normalizedRecipient))
      .limit(1);
    if (suppression) return { queued: false, reason: 'SUPPRESSED' as const };

    const scheduledFor = params.scheduledFor ?? new Date();
    await dbOrTx.insert(emailOutbox).values({
      ...params,
      recipientEmail: normalizedRecipient,
      templateVersion: params.templateVersion || '1.0.0',
      status: 'PENDING',
      scheduledFor,
      nextAttemptAt: scheduledFor,
    }).onConflictDoNothing({ target: emailOutbox.idempotencyKey });
    return { queued: true as const };
  }

  cancelAppointmentReminders(tenantId: string, appointmentId: string, tx?: any) {
    const dbOrTx = tx || getDatabase();
    return dbOrTx.update(emailOutbox).set({ status: 'CANCELLED' }).where(sql`
      tenant_id = ${tenantId}::uuid
      AND related_entity_type = 'appointment'
      AND related_entity_id = ${appointmentId}::uuid
      AND template_key = 'appointment-reminder'
      AND status IN ('PENDING','DELAYED','PROCESSING')
    `);
  }

  async processOutbox(limit = 10) {
    const db = getDatabase();
    const claimed = await db.execute(sql`
      WITH candidates AS (
        SELECT id FROM email_outbox
        WHERE status IN ('PENDING', 'DELAYED')
          AND scheduled_for <= NOW() AND next_attempt_at <= NOW()
        ORDER BY next_attempt_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE email_outbox AS outbox
      SET status = 'PROCESSING'
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING outbox.*
    `);

    const resend = getResend();
    for (const email of claimed.rows as any[]) {
      const nextAttempt = Number(email.attempt_count ?? 0) + 1;
      try {
        const templateData = { ...(email.template_data_json as Record<string, unknown>) };
        if (email.template_key === 'review-invitation') {
          const invitationId = String(templateData.reviewInvitationId ?? '');
          if (!env.PUBLIC_APP_ORIGIN || !invitationId) throw new Error('REVIEW_INVITATION_LINK_NOT_CONFIGURED');
          templateData.reviewUrl = env.PUBLIC_APP_ORIGIN.replace(/\/$/, '') + '/review/' + deriveReviewInvitationToken(invitationId);
        }
        const rendered = await renderEmail(email.template_key, templateData);
        const tenantName = String(templateData.tenantName || 'Your salon');
        const fromAddress = process.env[FROM_ENV[email.template_key] || 'EMAIL_BOOKINGS_FROM'];
        if (!fromAddress) throw new Error('EMAIL_FROM_NOT_CONFIGURED');

        const response = await resend.emails.send({
          from: `${tenantName} via KS OS <${fromAddress}>`,
          to: email.recipient_name ? `${email.recipient_name} <${email.recipient_email}>` : email.recipient_email,
          replyTo: email.reply_to_email || process.env.EMAIL_SUPPORT_REPLY_TO,
          subject: SUBJECTS[email.template_key] || 'Update from KS OS',
          html: rendered.html,
          text: rendered.text,
        }, { idempotencyKey: email.idempotency_key });
        if (response.error || !response.data?.id) throw new Error(response.error?.name || 'PROVIDER_REJECTED');

        await db.update(emailOutbox).set({ status: 'SENT', providerMessageId: response.data.id, attemptCount: nextAttempt, sentAt: new Date(), lastErrorCode: null })
          .where(eq(emailOutbox.id, email.id));
        if (email.related_entity_type === 'review_invitation' && email.related_entity_id) {
          await db.update(reviewInvitations).set({ status: 'SENT', sentAt: new Date(), updatedAt: new Date() }).where(eq(reviewInvitations.id, email.related_entity_id));
        }
      } catch (error) {
        const code = error instanceof Error ? error.message.slice(0, 255) : 'UNKNOWN_ERROR';
        const permanent = /INVALID|VALIDATION|SUPPRESSED|NOT_CONFIGURED/i.test(code);
        const failed = permanent || nextAttempt >= 5;
        const delayMinutes = Math.min(2 ** nextAttempt, 60);
        await db.update(emailOutbox).set({
          status: failed ? 'FAILED' : 'DELAYED', attemptCount: nextAttempt,
          nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000), lastErrorCode: code,
          failedAt: failed ? new Date() : null,
        }).where(eq(emailOutbox.id, email.id));
        if(failed&&email.tenant_id){const formDelivery=String(email.template_key).startsWith('form-');const issueType=formDelivery?'FORM_DELIVERY_FAILED':'EMAIL_FAILED';await this.issues.report({tenantId:email.tenant_id,category:formDelivery?'FORM':'EMAIL',issueType,severity:'WARNING',title:formDelivery?'Form delivery failed':'Email delivery failed',message:'A transactional email could not be sent after retrying.',sourceType:'EMAIL_OUTBOX',sourceId:email.id,deduplicationKey:`${issueType}:${email.id}`,relatedAppointmentId:email.related_entity_type==='appointment'?email.related_entity_id:null,metadata:{templateKey:email.template_key,errorCode:code}});}
      }
    }
    return { claimed: claimed.rows.length };
  }
}
