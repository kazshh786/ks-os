import test from 'node:test';
import assert from 'node:assert/strict';
import { BookingService } from '../src/modules/bookings/booking.service.js';

for (const covered of [true, false, undefined]) {
  test(`customer confirmation coverage ${covered} preserves reminders and fallback`, async () => {
    const booking = { status: 'CONFIRMED', startTime: new Date('2027-01-01T12:00:00Z'), clientEmail: 'customer@example.test', clientName: 'Customer', serviceName: 'Treatment' };
    const service = new BookingService() as any;
    service.repository = { getBookingById: async () => booking };
    const sent: any[] = [];
    let reminders = 0;
    service.emailSettings = { get: async () => ({ branding: { businessName: 'Studio' }, bookingConfirmationEnabled: true, templates: { customerBookingConfirmation: { subject: 'Confirmed', heading: 'Confirmed', body: 'Your booking is confirmed.' } }, automations: {} }) };
    service.emailService = { enqueueEmail: async (email: any) => { sent.push(email); return { queued: true }; } };
    service.businessEvents = { emit: async () => {} };
    service.issues = { resolve: async () => {} };
    service.enqueueEmailReminders = async () => { reminders++; };
    const results = [[{ timezone: 'Europe/London' }], [], [], []];
    const db = { select() { const result = results.shift(); const chain: any = { from: () => chain, where: () => chain, limit: () => Promise.resolve(result), orderBy: () => Promise.resolve(result), then: (resolve: any) => Promise.resolve(result).then(resolve) }; return chain; } };
    await service.notifyPublicBookingConfirmed('tenant', 'booking', 'event', db, { customerConfirmationCovered: covered });
    assert.equal(reminders, 1);
    assert.equal(sent.length, covered ? 0 : 1);
    if (!covered) { assert.equal(sent[0].recipientEmail, 'customer@example.test'); assert.equal(sent[0].templateKey, 'booking-confirmed'); }
  });
}
