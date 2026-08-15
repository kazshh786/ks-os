import assert from 'node:assert/strict';
import test from 'node:test';
import { getContrastRatio, getEmailDesign, getReadableTextColor, renderEmail, templates } from '../dist/index.js';

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
  assert.match(rendered.text, /New Client Consultation/i);
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
  assert.match(fallback.text, /Reminder: please complete your form/i);
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
  assert.match(assigned.text, /Consultation form/i);
  assert.match(reminder.text, /Consultation form/i);
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
  assert.match(rendered.text, /Before your appointment/i);
  assert.match(rendered.text, /1 form needs completing/);
  assert.match(rendered.text, /Complete intake form/);
});


test('all four design styles render the production booking, reminder and form templates', async () => {
  for (const emailDesignStyle of ['CLEAN', 'EDITORIAL', 'STUDIO', 'CONTRAST']) {
    const base = {
      tenantName: 'Glow Studio',
      businessName: 'Glow Studio',
      businessLogoUrl: 'https://example.test/logo.png',
      customerName: 'Amelia',
      serviceName: 'Signature appointment',
      staffName: 'Alex',
      bookingDate: 'Friday 14 August 2026',
      bookingTime: '14:30',
      formName: 'Consultation',
      formLink,
      amount: '45.00',
      currency: 'GBP',
      emailDesignStyle,
      emailTheme: {
        primaryColor: '#7c3aed',
        secondaryColor: '#334155',
        accentColor: '#ec4899',
        surfaceColor: '#ffffff',
        textColor: '#0f172a',
      },
    };
    for (const key of ['booking-confirmed', 'appointment-reminder', 'form-assigned', 'form-reminder']) {
      const rendered = await renderEmail(key, base);
      assert.match(rendered.html, /data-email-logo-panel="white"/);
      assert.match(rendered.html, /Glow Studio logo/);
      assert.ok(rendered.text.trim().length > 0);
    }
  }
});

test('the white logo panel falls back gracefully to the business name', async () => {
  const rendered = await renderEmail('booking-confirmed', {
    tenantName: 'Glow Studio',
    businessName: 'Glow Studio',
    customerName: 'Amelia',
    serviceName: 'Signature appointment',
    bookingDate: 'Friday 14 August 2026',
    bookingTime: '14:30',
    emailDesignStyle: 'CONTRAST',
  });
  assert.match(rendered.html, /data-email-logo-panel="white"/);
  assert.match(rendered.text, /Glow Studio/);
});

test('arbitrary pale and dark brand colours produce WCAG-readable action text', () => {
  for (const primaryColor of ['#fff2a8', '#111827']) {
    const design = getEmailDesign('CLEAN', { primaryColor });
    assert.ok(getContrastRatio(design.tokens.primaryAction, design.tokens.primaryActionText) >= 4.5);
  }
});

test('payment confirmation renders a receipt-quality summary', async () => {
  const rendered = await renderEmail('payment-confirmed', {
    tenantName: 'Glow Studio',
    customerName: 'Amelia',
    amount: '45.00',
    currency: 'GBP',
    serviceName: 'Signature appointment',
    bookingReference: 'KS-PREVIEW',
    status: 'Paid',
  });
  assert.match(rendered.text, /PAYMENT RECEIPT/);
  assert.match(rendered.text, /Booking reference/);
  assert.match(rendered.text, /45\.00 GBP/);
});
