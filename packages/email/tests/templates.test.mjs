import assert from 'node:assert/strict';
import test from 'node:test';
import { getReadableTextColor, renderEmail, templates } from '../dist/index.js';

const formLink = 'https://example.test/forms/token';

test('every registered template renders HTML and plain text with KS OS identification', async () => {
  for (const templateKey of Object.keys(templates)) {
    const rendered = await renderEmail(templateKey, {
      tenantName: 'Test Salon', tenantPrimaryColor: '#123456', clientName: '<Client>', customerName: '<Client>',
      staffName: 'Stylist', serviceName: 'Haircut', bookingDate: '20 July 2026', bookingTime: '10:00',
      startTime: '2026-07-20T09:00:00.000Z', timezone: 'Europe/London', formName: 'Consent form',
      formLink, formTitle: 'Consent form', formUrl: formLink, amount: '20.00', status: 'processed',
      message: 'Schedule updated',
    });
    assert.ok(rendered.html.includes('KS OS'), templateKey + ' omits platform identity');
    assert.ok(rendered.text.trim().length > 0, templateKey + ' omits plain text');
    assert.ok(!rendered.html.includes('<Client>'), templateKey + ' failed to escape customer data');
  }
});

test('form-assigned renders safely with only required form metadata', async () => {
  const rendered = await renderEmail('form-assigned', { formName: 'New Client Consultation', formLink });
  assert.match(rendered.html, /ACTION REQUIRED/);
  assert.match(rendered.text, /Complete form/);
  assert.match(rendered.text, /New Client Consultation/);
});

test('form-assigned renders optional appointment context when supplied', async () => {
  const rendered = await renderEmail('form-assigned', {
    tenantName: 'Bare Beauty',
    businessName: 'Bare Beauty',
    customerName: 'Sarah',
    formName: 'New Client Consultation',
    formLink,
    estimatedMinutes: 4,
    appointmentDate: 'Thursday 20 August',
    appointmentTime: '14:30',
    serviceName: 'Brow Lamination',
    staffName: 'Jo',
    locationName: 'High Street',
  });
  assert.match(rendered.text, /Approx\. 4 minutes/);
  assert.match(rendered.text, /Thursday 20 August at 14:30/);
  assert.match(rendered.text, /Brow Lamination/);
});

test('form-reminder has a distinct outstanding-form hierarchy and graceful fallback', async () => {
  const withAppointment = await renderEmail('form-reminder', {
    tenantName: 'Bare Beauty', customerName: 'Sarah', formName: 'Consultation', formLink,
    appointmentDate: 'Thursday 20 August', appointmentTime: '14:30', serviceName: 'Brow Lamination',
  });
  assert.match(withAppointment.text, /FORM STILL OUTSTANDING/);
  assert.match(withAppointment.text, /Please complete this before arriving/);

  const fallback = await renderEmail('form-reminder', {
    tenantName: 'Bare Beauty', customerName: 'Sarah', formName: 'Consultation', formLink,
  });
  assert.match(fallback.text, /Reminder: please complete your form/);
  assert.doesNotMatch(fallback.text, /before arriving/);
});

test('tenant colour contrast selects a readable foreground', () => {
  assert.equal(getReadableTextColor('#fff2a8'), '#111827');
  assert.equal(getReadableTextColor('#111827'), '#ffffff');
  assert.equal(getReadableTextColor('not-a-colour'), '#111827');
});

test('social follow section is hidden without links', async () => {
  const rendered = await renderEmail('form-assigned', {
    tenantName: 'Bare Beauty', formName: 'Consultation', formLink,
  });
  assert.doesNotMatch(rendered.text, /Follow Bare Beauty|Follow us on Instagram/);
});

test('social follow section renders configured channels only', async () => {
  const rendered = await renderEmail('form-assigned', {
    tenantName: 'Bare Beauty',
    businessName: 'Bare Beauty',
    formName: 'Consultation',
    formLink,
    instagramUrl: 'https://instagram.com/barebeauty',
    tiktokUrl: 'https://tiktok.com/@barebeauty',
  });
  assert.match(rendered.text, /Follow Bare Beauty/);
  assert.match(rendered.text, /Instagram/);
  assert.match(rendered.text, /TikTok/);
  assert.doesNotMatch(rendered.text, /Facebook/);
});

test('legacy form template payloads remain renderable', async () => {
  const legacyPayload = {
    tenantName: 'Legacy Salon',
    tenantPrimaryColor: '#ec4899',
    customerName: 'Customer',
    formName: 'Consultation form',
    formLink,
  };
  const assigned = await renderEmail('form-assigned', legacyPayload);
  const reminder = await renderEmail('form-reminder', legacyPayload);
  assert.match(assigned.text, /Consultation form/);
  assert.match(reminder.text, /Consultation form/);
});

test('booking confirmation only renders already-supplied secure assignment links', async () => {
  const rendered = await renderEmail('booking-confirmed', {
    tenantName: 'Bare Beauty',
    customerName: 'Sarah',
    bookingDate: 'Thursday 20 August',
    bookingTime: '14:30',
    serviceName: 'Brow Lamination',
    outstandingForms: [{ formName: 'Consultation', formLink, estimatedMinutes: 4 }],
  });
  assert.match(rendered.text, /Before your appointment/);
  assert.match(rendered.text, /1 form needs completing/);
  assert.match(rendered.text, /Complete intake form/);
});
