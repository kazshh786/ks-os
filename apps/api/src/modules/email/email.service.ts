import {
  getDatabase,
  emailOutbox,
  emailSuppressions,
  reviewInvitations,
  siteReviewCycles,
  siteReviewInvitations,
  factFindingInvitations,
  factFindingQuestionnaires,
  appointments,
} from '@ks-os/database';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { renderEmail } from '@ks-os/email';
import { decideOutboxRetry } from '@ks-os/notifications';
import { getResend } from '../../lib/resend.js';
import { OperationsIssueReporter } from '../operations/operations.issue-service.js';
import { deriveReviewInvitationToken as deriveReputationReviewInvitationToken } from '../reputation/reputation.security.js';
import { env } from '../../config/env.js';
import { deriveReviewInvitationToken } from '@ks-os/site-review';
import { deriveFactFindingInvitationToken } from '@ks-os/fact-finding';
import {
  appointmentNotificationCancellationCode,
  isPermanentEmailFailure,
  normalizeAndValidateEmailAddress,
  normalizeEmailDisplayName,
  prepareEmailTemplateData,
  validateEmailIdempotencyKey,
  validateEmailTemplateData,
} from './email-safety.js';

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
  'site-review-invitation': 'Your website draft is ready for review',
  'site-review-notification': 'Website review update',
  'fact-finding-invitation': 'Complete your business questionnaire',
  'fact-finding-notification': 'Your business questionnaire needs attention',
  'business-booking-confirmed': 'New booking confirmed',
  'business-payment-received': 'Payment received',
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
  'site-review-invitation': 'EMAIL_AUTH_FROM',
  'site-review-notification': 'EMAIL_AUTH_FROM',
  'fact-finding-invitation': 'EMAIL_AUTH_FROM',
  'fact-finding-notification': 'EMAIL_AUTH_FROM',
  'business-booking-confirmed': 'EMAIL_BOOKINGS_FROM',
  'business-payment-received': 'EMAIL_PAYMENTS_FROM',
};

export const EMAIL_SUBJECTS = SUBJECTS;
export const EMAIL_FROM_ENV = FROM_ENV;

const productionEmailSafetyEnabled = () => env.NODE_ENV === 'production';

export class EmailService {
  private issues = new OperationsIssueReporter();

  async enqueueEmail(params: EnqueueEmailParams, tx?: any) {
    const dbOrTx = tx || getDatabase();
    const production = productionEmailSafetyEnabled();
    const recipient = normalizeAndValidateEmailAddress(params.recipientEmail, production);
    if (!recipient.valid) return { queued: false, reason: recipient.reason } as const;

    let normalizedReplyTo: string | undefined;
    if (params.replyToEmail) {
      const replyTo = normalizeAndValidateEmailAddress(params.replyToEmail, production);
      if (!replyTo.valid) return { queued: false, reason: 'INVALID_REPLY_TO' as const };
      normalizedReplyTo = replyTo.email;
    }
    if (!validateEmailIdempotencyKey(params.idempotencyKey)) {
      return { queued: false, reason: 'INVALID_IDEMPOTENCY_KEY' as const };
    }

    const templateDataJson = prepareEmailTemplateData(params.templateKey, params.templateDataJson);
    if (production) {
      const templateValidation = validateEmailTemplateData(params.templateKey, templateDataJson, true);
      if (!templateValidation.valid) {
        return {
          queued: false,
          reason: 'INVALID_TEMPLATE_DATA' as const,
          invalidTokens: templateValidation.invalidTokens,
        };
      }
    }

    const [suppression] = await dbOrTx.select({ id: emailSuppressions.id })
      .from(emailSuppressions)
      .where(eq(emailSuppressions.recipientEmailNormalized, recipient.email))
      .limit(1);
    if (suppression) return { queued: false, reason: 'SUPPRESSED' as const };

    const scheduledFor = params.scheduledFor ?? new Date();
    if (!Number.isFinite(scheduledFor.getTime())) return { queued: false, reason: 'INVALID_SCHEDULE' as const };

    await dbOrTx.insert(emailOutbox).values({
      ...params,
      recipientEmail: recipient.email,
      recipientName: normalizeEmailDisplayName(params.recipientName),
      replyToEmail: normalizedReplyTo,
      templateDataJson,
      templateVersion: params.templateVersion || '1.0.0',
      status: 'PENDING',
      scheduledFor,
      nextAttemptAt: scheduledFor,
    }).onConflictDoNothing({ target: emailOutbox.idempotencyKey });
    return { queued: true as const };
  }

  cancelAppointmentReminders(tenantId: string, appointmentId: string, tx?: any) {
    const dbOrTx = tx || getDatabase();
    return dbOrTx.update(emailOutbox).set({
      status: 'CANCELLED',
      lastErrorCode: 'APPOINTMENT_NOTIFICATION_SUPERSEDED',
    }).where(sql`
      tenant_id = ${tenantId}::uuid
      AND related_entity_type = 'appointment'
      AND related_entity_id = ${appointmentId}::uuid
      AND (
        template_key IN ('appointment-reminder','booking-confirmed','booking-rescheduled','business-booking-confirmed')
        OR idempotency_key LIKE 'business-booking-rescheduled:%'
      )
      AND status IN ('PENDING','DELAYED','PROCESSING')
    `);
  }

  async processOutbox(limit = 10, randomSource: number | (() => number) = Math.random) {
    const db = getDatabase();
    const production = productionEmailSafetyEnabled();
    const recovered = await db.execute(sql`
      UPDATE email_outbox
      SET status = 'PENDING',
          next_attempt_at = NOW(),
          last_error_code = 'PROCESSING_LEASE_EXPIRED'
      WHERE status = 'PROCESSING'
        AND next_attempt_at <= NOW()
      RETURNING id
    `);
    const claimed = await db.execute(sql`
      WITH candidates AS (
        SELECT id FROM email_outbox
        WHERE status IN ('PENDING', 'DELAYED')
          AND scheduled_for <= NOW() AND next_attempt_at <= NOW()
        ORDER BY next_attempt_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(1, Math.min(limit, 100))}
      )
      UPDATE email_outbox AS outbox
      SET status = 'PROCESSING',
          next_attempt_at = NOW() + interval '10 minutes'
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING outbox.*
    `);

    const resend = getResend();
    for (const email of claimed.rows as any[]) {
      const nextAttempt = Number(email.attempt_count ?? 0) + 1;
      try {
        const recipient = normalizeAndValidateEmailAddress(email.recipient_email, production);
        if (!recipient.valid) {
          await db.update(emailOutbox).set({
            status: 'CANCELLED',
            lastErrorCode: `EMAIL_${recipient.reason}`,
          }).where(eq(emailOutbox.id, email.id));
          continue;
        }
        if (!validateEmailIdempotencyKey(email.idempotency_key)) throw new Error('EMAIL_INVALID_IDEMPOTENCY_KEY');

        const templateData = prepareEmailTemplateData(
          email.template_key,
          email.template_data_json as Record<string, unknown>,
        );
        const templateValidation = validateEmailTemplateData(email.template_key, templateData, production);
        if (!templateValidation.valid) throw new Error(templateValidation.errorCode);

        if (email.related_entity_type === 'appointment' && email.related_entity_id) {
          const [appointment] = await db.select({
            startTime: appointments.startTime,
            status: appointments.status,
          }).from(appointments)
            .where(eq(appointments.id, email.related_entity_id))
            .limit(1);
          const cancellationCode = appointmentNotificationCancellationCode({
            exists: Boolean(appointment),
            startTime: appointment?.startTime,
            status: appointment?.status,
          }, {
            templateKey: email.template_key,
            idempotencyKey: email.idempotency_key,
            templateData,
          });
          if (cancellationCode) {
            await db.update(emailOutbox).set({
              status: 'CANCELLED',
              lastErrorCode: cancellationCode,
            }).where(eq(emailOutbox.id, email.id));
            continue;
          }
        }
        if (email.related_entity_type === 'site_review_invitation' && email.related_entity_id) {
          const [reviewState] = await db.select({
            invitationStatus: siteReviewInvitations.status,
            reviewStatus: siteReviewCycles.status,
            expiresAt: siteReviewInvitations.expiresAt,
          }).from(siteReviewInvitations)
            .innerJoin(siteReviewCycles, eq(siteReviewInvitations.reviewCycleId, siteReviewCycles.id))
            .where(and(
              eq(siteReviewInvitations.id, email.related_entity_id),
              inArray(siteReviewInvitations.status, ['QUEUED', 'SENT', 'OPENED', 'ACCEPTED']),
              inArray(siteReviewCycles.status, [
                'READY_FOR_CLIENT_REVIEW',
                'CLIENT_REVIEW',
                'CLIENT_CHANGES_REQUESTED',
              ]),
            )).limit(1);
          if (!reviewState || reviewState.expiresAt.getTime() <= Date.now()) {
            await db.update(emailOutbox).set({
              status: 'CANCELLED',
              lastErrorCode: 'SITE_REVIEW_NOTIFICATION_NO_LONGER_APPLICABLE',
            }).where(eq(emailOutbox.id, email.id));
            continue;
          }
        }
        if (email.related_entity_type === 'fact_finding_invitation' && email.related_entity_id) {
          const [factFindingState] = await db.select({
            invitationStatus: factFindingInvitations.status,
            questionnaireStatus: factFindingQuestionnaires.status,
            expiresAt: factFindingInvitations.expiresAt,
          }).from(factFindingInvitations)
            .innerJoin(factFindingQuestionnaires, eq(factFindingInvitations.questionnaireId, factFindingQuestionnaires.id))
            .where(and(
              eq(factFindingInvitations.id, email.related_entity_id),
              inArray(factFindingInvitations.status, ['PENDING', 'SENT', 'ACCEPTED']),
              inArray(factFindingQuestionnaires.status, ['INVITED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED']),
            )).limit(1);
          if (!factFindingState || factFindingState.expiresAt.getTime() <= Date.now()) {
            await db.update(emailOutbox).set({
              status: 'CANCELLED',
              lastErrorCode: 'FACT_FINDING_NOTIFICATION_NO_LONGER_APPLICABLE',
            }).where(eq(emailOutbox.id, email.id));
            continue;
          }
        }
        if (email.template_key === 'review-invitation') {
          const invitationId = String(templateData.reviewInvitationId ?? '');
          if (!env.PUBLIC_APP_ORIGIN || !invitationId) throw new Error('REVIEW_INVITATION_LINK_NOT_CONFIGURED');
          templateData.reviewUrl = env.PUBLIC_APP_ORIGIN.replace(/\/$/, '') + '/review/' + deriveReputationReviewInvitationToken(invitationId);
        }
        if (
          email.template_key === 'site-review-invitation'
          || (
            email.template_key === 'site-review-notification'
            && templateData.invitationReference
          )
        ) {
          const invitationReference = String(templateData.invitationReference ?? '');
          const reviewReference = String(templateData.reviewReference ?? '');
          const reviewRevision = Number(templateData.reviewRevision);
          const secret = process.env.SITE_REVIEW_INVITATION_SECRET;
          if (
            !env.PUBLIC_APP_ORIGIN
            || !secret
            || secret.length < 32
            || !invitationReference
            || !reviewReference
            || !Number.isInteger(reviewRevision)
          ) {
            throw new Error('SITE_REVIEW_INVITATION_LINK_NOT_CONFIGURED');
          }
          const token = deriveReviewInvitationToken({
            invitationReference,
            reviewCycleReference: reviewReference,
            reviewRevision,
            secret,
          });
          templateData.reviewUrl = `${env.PUBLIC_APP_ORIGIN.replace(/\/$/, '')}/site-review?invitation=${encodeURIComponent(token)}`;
        }
        if (
          email.template_key === 'fact-finding-invitation'
          || email.template_key === 'fact-finding-notification'
        ) {
          const invitationReference = String(templateData.invitationReference ?? '');
          const questionnaireReference = String(templateData.questionnaireReference ?? '');
          const participantReference = String(templateData.participantReference ?? '');
          const secret = process.env.FACT_FINDING_INVITATION_SECRET;
          const origin = process.env.FACT_FINDING_CLIENT_ORIGIN;
          if (!origin || !secret || secret.length < 32 || !invitationReference || !questionnaireReference || !participantReference) {
            throw new Error('FACT_FINDING_INVITATION_LINK_NOT_CONFIGURED');
          }
          const invitationToken = deriveFactFindingInvitationToken({
            invitationReference,
            questionnaireReference,
            participantReference,
            secret,
          });
          const clientRoute = origin.replace(/\/$/, '').endsWith('/fact-finding')
            ? origin.replace(/\/$/, '')
            : `${origin.replace(/\/$/, '')}/fact-finding`;
          templateData.questionnaireUrl = `${clientRoute}?invitation=${encodeURIComponent(invitationToken)}`;
        }

        const [current] = await db.select({ status: emailOutbox.status })
          .from(emailOutbox)
          .where(eq(emailOutbox.id, email.id))
          .limit(1);
        if (current?.status !== 'PROCESSING') continue;

        const rendered = await renderEmail(email.template_key, templateData);
        const tenantName = String(templateData.tenantName || 'Your business');
        const senderName = tenantName.replace(/[\r\n\"<>]/g, '').trim().slice(0, 120) || 'Your business';
        const fromAddress = process.env[FROM_ENV[email.template_key] || 'EMAIL_BOOKINGS_FROM'];
        if (!fromAddress) throw new Error('EMAIL_FROM_NOT_CONFIGURED');
        const configuredSubject = String(templateData.emailSubject || SUBJECTS[email.template_key] || 'Update from KS OS')
          .replace(/[\r\n]/g, ' ').trim().slice(0, 160);
        const recipientName = normalizeEmailDisplayName(email.recipient_name);

        const response = await resend.emails.send({
          from: senderName + ' <' + fromAddress + '>',
          to: recipientName ? `${recipientName} <${recipient.email}>` : recipient.email,
          replyTo: email.reply_to_email || process.env.EMAIL_SUPPORT_REPLY_TO,
          subject: configuredSubject,
          html: rendered.html,
          text: rendered.text,
        }, { idempotencyKey: email.idempotency_key });
        if (response.error || !response.data?.id) throw new Error(response.error?.name || 'PROVIDER_REJECTED');

        await db.update(emailOutbox).set({
          status: 'SENT',
          providerMessageId: response.data.id,
          attemptCount: nextAttempt,
          sentAt: new Date(),
          lastErrorCode: null,
        }).where(eq(emailOutbox.id, email.id));
        if (email.related_entity_type === 'review_invitation' && email.related_entity_id) {
          await db.update(reviewInvitations).set({ status: 'SENT', sentAt: new Date(), updatedAt: new Date() }).where(eq(reviewInvitations.id, email.related_entity_id));
        }
        if (
          email.template_key === 'site-review-invitation'
          && email.related_entity_type === 'site_review_invitation'
          && email.related_entity_id
        ) {
          await db.update(siteReviewInvitations).set({ status: 'SENT', sentAt: new Date() }).where(eq(siteReviewInvitations.id, email.related_entity_id));
        }
      } catch (error) {
        const code = error instanceof Error ? error.message.slice(0, 255) : 'UNKNOWN_ERROR';
        const randomVal = typeof randomSource === 'function' ? randomSource() : randomSource;
        const decision = decideOutboxRetry({
          attemptNumber: nextAttempt,
          isTerminalFailure: isPermanentEmailFailure(code),
          randomValue: randomVal,
        });
        const finalStatus = decision.deadLetter ? 'DEAD_LETTER' : 'PENDING';
        await db.update(emailOutbox).set({
          status: finalStatus,
          attemptCount: nextAttempt,
          nextAttemptAt: decision.retry ? new Date(Date.now() + decision.delayMs) : new Date(),
          lastErrorCode: code,
          failedAt: decision.deadLetter ? new Date() : null,
        }).where(eq(emailOutbox.id, email.id));
        if (decision.deadLetter && email.tenant_id) {
          const formDelivery = String(email.template_key).startsWith('form-');
          const issueType = formDelivery ? 'FORM_DELIVERY_FAILED' : 'EMAIL_FAILED';
          await this.issues.report({
            tenantId: email.tenant_id,
            category: formDelivery ? 'FORM' : 'EMAIL',
            issueType,
            severity: 'WARNING',
            title: formDelivery ? 'Form delivery failed' : 'Email delivery failed',
            message: 'A transactional email could not be sent after retrying.',
            sourceType: 'EMAIL_OUTBOX',
            sourceId: email.id,
            deduplicationKey: `${issueType}:${email.id}`,
            relatedAppointmentId: email.related_entity_type === 'appointment' ? email.related_entity_id : null,
            metadata: { templateKey: email.template_key, errorCode: code },
          });
        }
      }
    }
    return { claimed: claimed.rows.length, recovered: recovered.rows.length };
  }

  async retryDeadLetter(tenantId: string, emailOutboxId: string, tx?: any) {
    const dbOrTx = tx || getDatabase();
    const [existing] = await dbOrTx.select().from(emailOutbox).where(and(
      eq(emailOutbox.id, emailOutboxId),
      eq(emailOutbox.tenantId, tenantId),
      inArray(emailOutbox.status, ['DEAD_LETTER', 'FAILED']),
    )).limit(1);
    if (!existing) return { retried: false, reason: 'NOT_ELIGIBLE' as const };

    await dbOrTx.update(emailOutbox).set({
      status: 'PENDING',
      attemptCount: 0,
      nextAttemptAt: new Date(),
      scheduledFor: new Date(),
      failedAt: null,
      lastErrorCode: null,
    }).where(eq(emailOutbox.id, emailOutboxId));

    return { retried: true as const, emailOutboxId };
  }
}
