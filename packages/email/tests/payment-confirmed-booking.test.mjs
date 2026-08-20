import assert from 'node:assert/strict';
import test from 'node:test';
import { renderEmail } from '../dist/index.js';

test('payment confirmation includes booking details and payment receipt in the existing email design system', async () => {
  const rendered = await renderEmail('payment-confirmed', {
    tenantName: 'Glow Studio',
    businessName: 'Glow Studio',
    businessEmail: 'hello@example.test',
    customerName: 'Amelia',
    amount: '45.00',
    currency: 'GBP',
    status: 'Paid',
    serviceName: 'Signature appointment',
    appointmentDateTime: '2026-08-21T13:30:00.000Z',
    timezone: 'Europe/London',
    staffName: 'Alex',
    locationName: 'High Street',
    bookingReference: 'KS-BOOKING-123',
    paymentReference: 'pi_123456789',
    emailDesignStyle: 'CLEAN',
    emailTheme: { primaryColor: '#7c3aed' },
  });

  assert.match(rendered.text, /PAYMENT & BOOKING CONFIRMED/);
  assert.match(rendered.text, /Signature appointment/);
  assert.match(rendered.text, /Alex/);
  assert.match(rendered.text, /High Street/);
  assert.match(rendered.text, /KS-BOOKING-123/);
  assert.match(rendered.text, /PAYMENT RECEIPT/);
  assert.match(rendered.text, /45\.00 GBP/);
  assert.match(rendered.text, /pi_123456789/);
  assert.match(rendered.html, /data-email-logo-panel="white"/);
});
