import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { EMAIL_FROM_ENV } from '../src/modules/email/email.service.js';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('correct sender selected for every transactional template', () => {
  assert.equal(EMAIL_FROM_ENV['booking-confirmed'], 'EMAIL_BOOKINGS_FROM');
  assert.equal(EMAIL_FROM_ENV['booking-rescheduled'], 'EMAIL_BOOKINGS_FROM');
  assert.equal(EMAIL_FROM_ENV['booking-cancelled'], 'EMAIL_BOOKINGS_FROM');
  assert.equal(EMAIL_FROM_ENV['appointment-reminder'], 'EMAIL_BOOKINGS_FROM');
  assert.equal(EMAIL_FROM_ENV['payment-confirmed'], 'EMAIL_PAYMENTS_FROM');
  assert.equal(EMAIL_FROM_ENV['refund-updated'], 'EMAIL_PAYMENTS_FROM');
  assert.equal(EMAIL_FROM_ENV['form-assigned'], 'EMAIL_FORMS_FROM');
  assert.equal(EMAIL_FROM_ENV['form-reminder'], 'EMAIL_FORMS_FROM');
  assert.equal(EMAIL_FROM_ENV['customer-portal-claim'], 'EMAIL_AUTH_FROM');
  assert.equal(EMAIL_FROM_ENV['account-access-invitation'], 'EMAIL_AUTH_FROM');
  assert.equal(EMAIL_FROM_ENV['staff-operational-notification'], 'EMAIL_AUTH_FROM');
});

test('payment and refund lifecycle queues outbox emails idempotently', () => {
  const pos = read('modules/pos/pos.service.ts');
  const payments = read('modules/payments/payments.service.ts');
  const stripe = read('modules/webhooks/stripe/stripe-webhook.service.ts');

  assert.match(pos, /enqueuePaymentEmail\(tx, tenantId, transaction\.id, 'payment-confirmed', `payment-confirmed:\$\{transaction\.id\}`\)/);
  assert.match(stripe, /enqueuePaymentEmail\(tx, attempt\.tenantId, transaction\.id, 'payment-confirmed', `payment-confirmed:\$\{event\.id\}`\)/);
  assert.match(payments, /enqueuePaymentEmail\(tx, tenantId, transactionId, 'refund-updated', `refund-updated:\$\{newRefund\.id\}:SUCCEEDED`/);
  assert.match(stripe, /enqueuePaymentEmail\(tx, existingRefund\.tenantId, existingRefund\.checkoutTransactionId, 'refund-updated', `refund-updated:\$\{stripeRefundId\}:SUCCEEDED`/);
});

test('form assignment, form reminder and appointment reminder emails are wired through outbox', () => {
  const forms = read('modules/forms/forms.service.ts');
  const bookings = read('modules/bookings/booking.service.ts');

  assert.match(forms, /templateKey:\s*'form-assigned'/);
  assert.match(forms, /input\.deliveryMethod === 'EMAIL'/);
  assert.match(forms, /templateKey:\s*'form-reminder'/);
  assert.match(forms, /idempotencyKey:\s*`form-assigned-email:\$\{created\.id\}`/);
  assert.match(forms, /idempotencyKey:\s*`form-reminder-email:\$\{created\.id\}:\$\{settings\.formReminderTiming\}`/);
  assert.match(bookings, /templateKey: 'appointment-reminder'/);
  assert.match(bookings, /cancelAppointmentReminders\(auth\.tenantId,bookingId,tx\)/);
  const emailService = read('modules/email/email.service.ts');
  assert.match(emailService, /formReminderCancellationCode/);
  assert.match(emailService, /FORM_REMINDER_NO_LONGER_APPLICABLE|cancellationCode/);
});

test('direct Resend sends are now tracked through the email outbox', () => {
  const invitation = read('modules/authentication/account-invitation-email.service.ts');
  const claim = read('modules/customer-portal/customer-claim-email.service.ts');

  assert.doesNotMatch(invitation, /emails\.send/);
  assert.doesNotMatch(claim, /emails\.send/);
  assert.match(invitation, /templateKey: 'account-access-invitation'/);
  assert.match(claim, /templateKey: 'customer-portal-claim'/);
});

test('Resend webhook keeps raw-body verification, idempotency and suppressions', () => {
  const app = read('app.ts');
  const routes = read('modules/webhooks/resend/resend-webhook.routes.ts');
  const service = read('modules/webhooks/resend/resend-webhook.service.ts');

  assert.match(app, /routes: \['\/api\/v1\/webhooks\/resend'/);
  assert.match(routes, /request\.rawBody/);
  assert.match(service, /new Webhook\(secret\)\.verify\(payload/);
  assert.match(service, /onConflictDoNothing\(\{ target: emailWebhookEvents\.eventId \}\)/);
  assert.match(service, /if \(!inserted\.length\) return/);
  assert.match(service, /emailSuppressions/);
});

test('staff-created confirmed bookings enter the same transactional email pipeline', () => {
  const bookings = read('modules/bookings/booking.service.ts');
  const start = bookings.indexOf('async createManualBooking');
  const end = bookings.indexOf('async createBlockedTime', start);
  const manualBooking = bookings.slice(start, end);

  assert.match(manualBooking, /bookingStatus === 'CONFIRMED'/);
  assert.match(manualBooking, /options\.notifyCustomer !== false/);
  assert.match(manualBooking, /notifyPublicBookingConfirmed/);
  assert.match(manualBooking, /EMAIL_FAILED:BOOKING_CONFIRMATION/);
});

test('self-service reschedule reminders are independent of SMS and use email automation timing', () => {
  const management = read('modules/customer-portal/customer-booking-management.service.ts');
  const start = management.indexOf('private async enqueueRescheduledNotifications');
  const end = management.indexOf('private async enqueueCancellationNotifications', start);
  const notifications = management.slice(start, end);
  const emailReminderStart = notifications.indexOf('if (row.clientEmail)');
  const emailReminderBlock = notifications.slice(emailReminderStart);

  assert.match(emailReminderBlock, /emailSettings\.get/);
  assert.match(emailReminderBlock, /reminderThreeDaysEnabled \? \[72\]/);
  assert.match(emailReminderBlock, /reminderOneDayEnabled \? \[24\]/);
  assert.match(emailReminderBlock, /appointmentDateTime: newStart\.toISOString\(\)/);
  assert.doesNotMatch(emailReminderBlock, /smsReminderTiming/);
});

test('communications cycle runs report generation before draining the email outbox', () => {
  const worker = readFileSync(new URL('../../../scripts/workers/run-communications-cycle.mjs', import.meta.url), 'utf8');
  const reports = read('modules/reporting/report-schedules.service.ts');

  assert.match(worker, /internal\/report-worker\/schedules/);
  assert.match(worker, /internal\/report-worker\/exports/);
  assert.ok(worker.indexOf('report-worker/exports') < worker.indexOf('communications/worker/run'));
  assert.match(reports, /env\.PUBLIC_APP_ORIGIN\|\|env\.FRONTEND_ORIGIN/);
  assert.doesNotMatch(reports, /PUBLIC_APP_URL|WEB_APP_URL/);
  assert.match(reports, /REPORT_EMAIL_NOT_QUEUED/);
});
