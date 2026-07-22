import { EmailService } from '../email/email.service.js';

export class AccountInvitationEmailService {
  private email = new EmailService();
  async sendExistingAccountNotice(input: {
    recipientEmail: string;
    recipientName: string;
    accessLabel: string;
    invitationUrl: string;
    idempotencyKey?: string;
  }) {
    const result = await this.email.enqueueEmail({
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      templateKey: 'account-access-invitation',
      templateDataJson: { tenantName: 'KS OS', tenantPrimaryColor: '#4f46e5', existingAccount: true, ...input },
      idempotencyKey: input.idempotencyKey || `account-access-invitation:${input.recipientEmail.toLowerCase()}:${input.invitationUrl}`,
    });
    if (!result.queued && result.reason === 'SUPPRESSED') {
      throw Object.assign(new Error('The invitation notification could not be delivered.'), { code: 'AUTH_EMAIL_FAILED' });
    }
  }
}
