import assert from 'node:assert/strict';
import test from 'node:test';
import { decideOutboxRetry } from '@ks-os/notifications';
import {
  appointmentNotificationCancellationCode,
  formReminderCancellationCode,
  isBlockedProductionEmailDomain,
  isPermanentEmailFailure,
  normalizeAndValidateEmailAddress,
  normalizeEmailDisplayName,
  prepareEmailTemplateData,
  validateEmailIdempotencyKey,
  validateEmailTemplateData,
} from '../src/modules/email/email-safety.js';

const secureUrl = 'https://app.kasimshah.com/example';
const futureIso = '2026-08-10T10:00:00.000Z';
const expiryIso = '2026-08-11T10:00:00.000Z';

const validTemplatePayloads: Record<string, Record<string, unknown>> = {
  'booking-confirmed': { tenantName: 'KS OS', customerName: 'Test Customer', startTime: futureIso, serviceName: 'Consultation' },
  'booking-rescheduled': { tenantName: 'KS OS', clientName: 'Test Customer', startTime: futureIso, serviceName: 'Consultation' },
  'booking-cancelled': { tenantName: 'KS OS', clientName: 'Test Customer', startTime: futureIso, serviceName: 'Consultation' },
  'appointment-reminder': { tenantName: 'KS OS', customerName: 'Test Customer', bookingTime: '11:00', bookingDate: '10 August 2026', serviceName: 'Consultation' },
  'payment-confirmed': { tenantName: 'KS OS', clientName: 'Test Customer', amount: '25.00', currency: 'GBP' },
  'refund-updated': { tenantName: 'KS OS', clientName: 'Test Customer', status: 'SUCCEEDED' },
  'form-assigned': { tenantName: 'KS OS', customerName: 'Test Customer', formName: 'Consultation form', formLink: secureUrl },
  'form-reminder': { tenantName: 'KS OS', customerName: 'Test Customer', formName: 'Consultation form', formLink: secureUrl },
  'staff-operational-notification': { tenantName: 'KS OS', staffName: 'Owner', message: 'A booking changed.' },
  'scheduled-report-ready': { tenantName: 'KS OS', reportName: 'Daily report', reportType: 'BOOKINGS', downloadPageUrl: secureUrl, expiresAt: expiryIso },
  'review-invitation': { tenantName: 'KS OS', customerName: 'Test Customer', message: 'Thank you for visiting.', appointmentDate: '10 August 2026', reviewInvitationId: '11111111-1111-4111-8111-111111111111', reviewProvider: 'GOOGLE' },
  'customer-portal-claim': { tenantName: 'KS OS', customerName: 'Test Customer', claimUrl: secureUrl },
  'account-access-invitation': { tenantName: 'KS OS', recipientName: 'Test User', accessLabel: 'KS OS workspace', invitationUrl: secureUrl },
  'site-review-invitation': { tenantName: 'KS OS', participantName: 'Test Reviewer', invitationReference: 'invite-1', reviewReference: 'review-1', reviewRevision: 1, expiresAt: expiryIso },
  'site-review-notification': { tenantName: 'KS OS', participantName: 'Test Reviewer', heading: 'Website review update', message: 'A review update is available.' },
  'fact-finding-invitation': { tenantName: 'KS OS', participantName: 'Test Participant', invitationReference: 'invite-1', questionnaireReference: 'questionnaire-1', participantReference: 'participant-1', expiresAt: expiryIso },
  'fact-finding-notification': { tenantName: 'KS OS', participantName: 'Test Participant', invitationReference: 'invite-1', questionnaireReference: 'questionnaire-1', participantReference: 'participant-1', heading: 'Questionnaire update', message: 'More detail is required.', expiresAt: expiryIso },
  'business-booking-confirmed': { tenantName: 'KS OS', recipientName: 'Owner', customerName: 'Test Customer', serviceName: 'Consultation', bookingDate: '10 August 2026', bookingTime: '11:00', emailBody: 'A booking has been confirmed.' },
  'business-payment-received': { tenantName: 'KS OS', recipientName: 'Owner', customerName: 'Test Customer', serviceName: 'Consultation', amount: '25.00', currency: 'GBP', emailBody: 'A payment has been received.' },
};

test('email addresses are normalized to a canonical ASCII form', () => {
  assert.deepEqual(normalizeAndValidateEmailAddress('  User+Tag@BÜCHER.de  '), {
    valid: true,
    email: 'user+tag@xn--bcher-kva.de',
    domain: 'xn--bcher-kva.de',
  });
  assert.equal(normalizeEmailDisplayName('  Alice\r\n<admin>  '), 'Alice admin');
});

test('malformed or display-name email input is rejected', () => {
  for (const value of [
    '',
    'Alice <alice@example.com>',
    'alice @example.com',
    '.alice@example.com',
    'alice..smith@example.com',
    'alice@example',
    'alice@-example.com',
    'alice@example.com.',
  ]) {
    assert.deepEqual(normalizeAndValidateEmailAddress(value), { valid: false, reason: 'INVALID_RECIPIENT' });
  }
});

test('production blocks reserved and Resend test domains without breaking non-production probes', () => {
  for (const domain of ['example.com', 'sub.example.net', 'example.test', 'mail.invalid', 'localhost', 'resend.dev']) {
    assert.equal(isBlockedProductionEmailDomain(domain), true, domain);
  }
  assert.deepEqual(normalizeAndValidateEmailAddress('delivered+phase2@resend.dev', true), {
    valid: false,
    reason: 'PRODUCTION_TEST_RECIPIENT_BLOCKED',
  });
  assert.equal(normalizeAndValidateEmailAddress('delivered+phase2@resend.dev', false).valid, true);
  assert.equal(normalizeAndValidateEmailAddress('customer@example-business.co.uk', true).valid, true);
});

test('all 19 production templates satisfy an explicit token contract', () => {
  assert.equal(Object.keys(validTemplatePayloads).length, 19);
  for (const [templateKey, payload] of Object.entries(validTemplatePayloads)) {
    assert.deepEqual(validateEmailTemplateData(templateKey, payload, true), { valid: true }, templateKey);
  }
});

test('template validation rejects missing, unsafe and insecure production tokens', () => {
  const missing = validateEmailTemplateData('booking-confirmed', {
    tenantName: 'KS OS',
    customerName: 'Test Customer',
    serviceName: 'Consultation',
  }, true);
  assert.equal(missing.valid, false);
  if (!missing.valid) assert.ok(missing.invalidTokens.includes('startTime|bookingDate+bookingTime'));

  const insecure = validateEmailTemplateData('form-assigned', {
    tenantName: 'KS OS',
    customerName: 'Test Customer',
    formName: 'Consultation form',
    formLink: 'http://app.kasimshah.com/form',
  }, true);
  assert.equal(insecure.valid, false);

  const polluted = JSON.parse('{"tenantName":"KS OS","staffName":"Owner","message":"Hello","__proto__":{"admin":true}}');
  assert.equal(validateEmailTemplateData('staff-operational-notification', polluted, true).valid, false);
  assert.equal(validateEmailTemplateData('unknown-template', { tenantName: 'KS OS' }, true).valid, false);
});

test('legacy appointment payload aliases are prepared before rendering', () => {
  const prepared = prepareEmailTemplateData('booking-rescheduled', {
    tenantName: 'KS OS',
    clientName: 'Test Customer',
    serviceName: 'Consultation',
    startTime: futureIso,
    timezone: 'Europe/London',
  });
  assert.equal(prepared.customerName, 'Test Customer');
  assert.match(String(prepared.newDateTime), /10 Aug 2026/);
});

test('appointment messages are cancelled when stale, superseded or inconsistent', () => {
  const confirmed = { exists: true, status: 'CONFIRMED', startTime: futureIso };
  assert.equal(appointmentNotificationCancellationCode(confirmed, {
    templateKey: 'booking-rescheduled',
    idempotencyKey: 'reschedule:1',
    templateData: { startTime: futureIso },
  }, Date.parse('2026-08-05T10:00:00.000Z')), null);

  assert.equal(appointmentNotificationCancellationCode(confirmed, {
    templateKey: 'booking-rescheduled',
    idempotencyKey: 'reschedule:old',
    templateData: { startTime: '2026-08-09T10:00:00.000Z' },
  }, Date.parse('2026-08-05T10:00:00.000Z')), 'APPOINTMENT_NOTIFICATION_SUPERSEDED');

  assert.equal(appointmentNotificationCancellationCode(confirmed, {
    templateKey: 'appointment-reminder',
    idempotencyKey: 'reminder:legacy-display-time',
    templateData: { appointmentDateTime: '10 Aug 2026, 11:00' },
  }, Date.parse('2026-08-05T10:00:00.000Z')), null);

  assert.equal(appointmentNotificationCancellationCode(confirmed, {
    templateKey: 'appointment-reminder',
    idempotencyKey: 'reminder:authoritative-time',
    templateData: { appointmentDateTime: '2026-08-09T10:00:00.000Z' },
  }, Date.parse('2026-08-05T10:00:00.000Z')), 'APPOINTMENT_NOTIFICATION_SUPERSEDED');

  assert.equal(appointmentNotificationCancellationCode({ exists: true, status: 'CANCELLED', startTime: futureIso }, {
    templateKey: 'appointment-reminder',
    templateData: {},
  }, Date.parse('2026-08-05T10:00:00.000Z')), 'APPOINTMENT_NOTIFICATION_NO_LONGER_APPLICABLE');

  assert.equal(appointmentNotificationCancellationCode(confirmed, {
    templateKey: 'booking-cancelled',
    templateData: {},
  }), 'APPOINTMENT_NOTIFICATION_NO_LONGER_APPLICABLE');

  assert.equal(appointmentNotificationCancellationCode({ exists: true, status: 'CANCELLED', startTime: futureIso }, {
    templateKey: 'staff-operational-notification',
    idempotencyKey: 'business-booking-cancelled:appointment-1:owner-1',
    templateData: {},
  }), null);
});

test('retry, dead-letter and idempotency decisions remain bounded and deterministic', () => {
  assert.equal(validateEmailIdempotencyKey('booking-confirmed:appointment-1'), true);
  assert.equal(validateEmailIdempotencyKey(' booking-confirmed:appointment-1'), false);
  assert.equal(validateEmailIdempotencyKey(''), false);

  const retry = decideOutboxRetry({ attemptNumber: 1, isTerminalFailure: false, randomValue: 0.5 });
  assert.equal(retry.retry, true);
  assert.equal(retry.deadLetter, false);
  assert.equal(retry.delayMs, 5_000);

  const terminal = decideOutboxRetry({ attemptNumber: 1, isTerminalFailure: true, randomValue: 0.5 });
  assert.equal(terminal.retry, false);
  assert.equal(terminal.deadLetter, true);
  assert.equal(isPermanentEmailFailure('EMAIL_TEMPLATE_VALIDATION_FAILED:booking-confirmed:serviceName'), true);
  assert.equal(isPermanentEmailFailure('PROVIDER_REJECTED'), false);
});

test('submitted, cancelled and expired form reminders are cancelled before send', () => {
  const future = '2026-08-20T10:00:00.000Z';
  const now = Date.parse('2026-08-19T10:00:00.000Z');

  assert.equal(formReminderCancellationCode({
    exists: true,
    status: 'PENDING',
    expiresAt: future,
  }, 'form-reminder', now), null);

  for (const status of ['SUBMITTED', 'CANCELLED', 'EXPIRED']) {
    assert.equal(formReminderCancellationCode({
      exists: true,
      status,
      expiresAt: future,
    }, 'form-reminder', now), 'FORM_REMINDER_NO_LONGER_APPLICABLE');
  }

  assert.equal(formReminderCancellationCode({
    exists: true,
    status: 'PENDING',
    expiresAt: '2026-08-18T10:00:00.000Z',
  }, 'form-reminder', now), 'FORM_REMINDER_NO_LONGER_APPLICABLE');
  assert.equal(formReminderCancellationCode({
    exists: false,
  }, 'form-reminder', now), 'FORM_REMINDER_NO_LONGER_APPLICABLE');
});
