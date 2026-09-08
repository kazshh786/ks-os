import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentsService } from '../src/modules/payments/payments.service.js';

for (const queued of [true, false]) {
  test(`combined payment email uses customer recipient and reports queue result ${queued}`, async () => {
    const service = new PaymentsService() as any;
    const emails: any[] = [];
    const issues: any[] = [];
    service.emailSettings = { get: async () => ({ branding: { businessName: 'Studio' }, automations: { businessPaymentReceivedEnabled: true }, templates: { businessPaymentReceived: { subject: 'Payment', heading: 'Payment', body: 'Received' } } }) };
    service.email = { enqueueEmail: async (email: any) => { emails.push(email); return email.templateKey === 'payment-confirmed' ? { queued, reason: queued ? null : 'SUPPRESSED' } : { queued: true }; } };
    service.issues = { report: async (issue: any) => { issues.push(issue); }, resolve: async () => {} };
    const results = [
      [{ transactionId: 'payment', appointmentId: 'booking', amount: 2000, quotedAmount: 8000, currency: 'GBP', clientEmail: 'customer@example.test', clientName: 'Customer', bookingChannel: 'mobile', mobileAddress: { line1: '10 Customer Road', city: 'London', postcode: 'SW1A 1AA' }, locationName: 'Salon', appointmentStartTime: new Date('2027-01-01T12:00:00Z') }],
      [{ name: 'Treatment' }],
      [{ id: 'owner', email: 'owner@example.test', name: 'Owner' }],
    ];
    const tx = { select() { const result = results.shift(); const chain: any = { from: () => chain, leftJoin: () => chain, where: () => chain, limit: () => Promise.resolve(result), orderBy: () => Promise.resolve(result), then: (resolve: any) => Promise.resolve(result).then(resolve) }; return chain; } };
    const result = await service.enqueuePaymentEmail(tx, 'tenant', 'payment', 'payment-confirmed', 'payment-confirmed:payment', { bookingConfirmed: true });
    assert.equal(result.queued, queued, 'business delivery must not conceal customer suppression');
    assert.equal(result.businessRecipients, 1);
    assert.equal(emails[0].recipientEmail, 'customer@example.test');
    assert.equal(emails[1].recipientEmail, 'owner@example.test');
    assert.equal(emails[0].templateDataJson.balanceDue, '60.00');
    assert.equal(emails[0].templateDataJson.amount, '20.00');
    assert.equal(emails[0].templateDataJson.locationName, '10 Customer Road, London, SW1A 1AA');
    assert.equal(emails[0].templateDataJson.bookingConfirmed, true);
    assert.equal(issues.length, queued ? 0 : 1);
  });
}
