import assert from 'node:assert/strict';
import test from 'node:test';
import { renderEmail, templates } from '../dist/index.js';

test('every registered template renders HTML and plain text with KS OS identification', async () => {
  for (const templateKey of Object.keys(templates)) {
    const rendered = await renderEmail(templateKey, {
      tenantName: 'Test Salon', tenantPrimaryColor: '#123456', clientName: '<Client>', customerName: '<Client>',
      staffName: 'Stylist', serviceName: 'Haircut', bookingDate: '20 July 2026', bookingTime: '10:00',
      startTime: '2026-07-20T09:00:00.000Z', timezone: 'Europe/London', formTitle: 'Consent form',
      formUrl: 'https://example.test/forms/token', amount: '20.00', status: 'processed', message: 'Schedule updated',
    });
    assert.ok(rendered.html.includes('KS OS'), `${templateKey} omits platform identity`);
    assert.ok(rendered.text.trim().length > 0, `${templateKey} omits plain text`);
    assert.ok(!rendered.html.includes('<Client>'), `${templateKey} failed to escape customer data`);
  }
});
