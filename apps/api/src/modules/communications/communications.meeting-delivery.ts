import { z } from 'zod';
import { EmailService } from '../email/email.service.js';
import type { CommunicationsDatabase } from './communications.database.js';

const request = z.object({
  tenantId: z.string().uuid(), meetingId: z.string().uuid(), invitationId: z.string().uuid(),
  version: z.number().int().positive(), kind: z.enum(['invite', 'rescheduled', 'cancelled']),
  to: z.string().min(1).max(254),
}).strict();
export type MeetingEmailRequest = z.infer<typeof request>;

/** Caller authorizes the action and binds the invitation recipient in its transaction. */
export async function enqueueMeetingEmail(input: MeetingEmailRequest, tx?: CommunicationsDatabase) {
  const value = request.parse(input);
  return new EmailService().enqueueEmail({
    tenantId: value.tenantId,
    recipientEmail: value.to,
    templateKey: 'meeting-notification',
    // Only references are persisted. The worker resolves branding, schedule and
    // the signed invitation link immediately before sending; no bearer link in DB.
    templateDataJson: { meetingId: value.meetingId, invitationId: value.invitationId, version: value.version, kind: value.kind },
    idempotencyKey: `meeting:${value.tenantId}:${value.meetingId}:${value.invitationId}:${value.version}:${value.kind}`,
    relatedEntityType: 'communication_meeting_invitation', relatedEntityId: value.invitationId,
  }, tx);
}
