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
  }
}
