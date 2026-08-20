import { and, eq } from 'drizzle-orm';
import { appointments, getDatabase } from '@ks-os/database';
import { EmailService } from '../email/email.service.js';

export class CustomerClaimEmailService {
  private email = new EmailService();
  async send(input: {
    recipientEmail: string;
    recipientName?: string;
    replyToEmail?: string | null;
    tenantName: string;
    tenantPrimaryColor: string;
    claimUrl?: string;
    bookingManagementUrl?: string;
    idempotencyKey: string;
    tenantId?: string;
    relatedEntityId?: string;
  }) {
    if (input.tenantId && input.relatedEntityId) {
      const db = getDatabase();
      const [booking] = await db.select({ status: appointments.status })
        .from(appointments)
        .where(and(
          eq(appointments.id, input.relatedEntityId),
          eq(appointments.tenantId, input.tenantId),
        ))
        .limit(1);

      // Pay-now/deposit bookings are created in a pending state before Stripe
      // completes. Never send a portal/claim email while the booking is still
      // awaiting payment; the successful payment flow sends the customer a
      // combined payment + booking confirmation instead.
      if (booking && booking.status !== 'CONFIRMED') {
        return { queued: false as const, reason: 'BOOKING_NOT_CONFIRMED' as const };
      }
    }

    const result = await this.email.enqueueEmail({
      tenantId: input.tenantId,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      replyToEmail: input.replyToEmail || undefined,
      templateKey: 'customer-portal-claim',
      templateDataJson: {
        tenantName: input.tenantName,
        tenantPrimaryColor: input.tenantPrimaryColor,
        customerName: input.recipientName || 'there',
        claimUrl: input.claimUrl,
        bookingManagementUrl: input.bookingManagementUrl,
      },
      idempotencyKey: input.idempotencyKey,
      relatedEntityType: input.relatedEntityId ? 'appointment' : undefined,
      relatedEntityId: input.relatedEntityId,
    });
    if (!result.queued && result.reason === 'SUPPRESSED') throw new Error('CUSTOMER_CLAIM_EMAIL_FAILED');
    return result;
  }
}
