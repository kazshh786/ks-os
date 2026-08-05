import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UpdateCommunicationsSettingsSchema } from '@ks-os/contracts';
import {
  applyEmailRuntimeSettings,
  DEFAULT_AUTOMATED_EMAIL_TEMPLATES,
  interpolateEmailCopy,
  renderAutomatedEmailCopy,
} from '../src/modules/email/email-settings.service.js';

const source = (path: string) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');

const branding = {
  businessName: 'Glow Studio',
  businessEmail: 'hello@glow.example',
  businessPhone: '020 0000 0000',
  businessAddress: '10 High Street',
  websiteUrl: 'https://glow.example',
  logoUrl: null,
  instagramUrl: 'https://instagram.com/glow',
  facebookUrl: null,
  tiktokUrl: null,
};

test('editable copy is plain text, bounded and rejects subject header injection', () => {
  const valid = UpdateCommunicationsSettingsSchema.safeParse({ templates: DEFAULT_AUTOMATED_EMAIL_TEMPLATES });
  assert.equal(valid.success, true);

  const injected = UpdateCommunicationsSettingsSchema.safeParse({
    templates: {
      ...DEFAULT_AUTOMATED_EMAIL_TEMPLATES,
      customerBookingConfirmation: {
        ...DEFAULT_AUTOMATED_EMAIL_TEMPLATES.customerBookingConfirmation,
        subject: 'Confirmed\r\nBcc: attacker@example.com',
      },
    },
  });
  assert.equal(injected.success, false);
});

test('phase 3 exposes complete editable customer lifecycle templates', () => {
  for (const key of [
    'customerBookingCancellation',
    'customerBookingReschedule',
    'customerPaymentConfirmation',
    'customerRefundUpdate',
    'formAssignment',
    'formReminder',
    'customerPortalAccess',
  ] as const) {
    assert.ok(DEFAULT_AUTOMATED_EMAIL_TEMPLATES[key].subject);
    assert.ok(DEFAULT_AUTOMATED_EMAIL_TEMPLATES[key].heading);
    assert.ok(DEFAULT_AUTOMATED_EMAIL_TEMPLATES[key].body);
  }
});

test('template tokens interpolate known values and preserve unknown placeholders', () => {
  assert.equal(
    interpolateEmailCopy('Hi {{customerName}} from {{businessName}} {{unknown}}', {
      customerName: 'Amelia',
      businessName: 'Glow Studio',
    }),
    'Hi Amelia from Glow Studio {{unknown}}',
  );
  const rendered = renderAutomatedEmailCopy(DEFAULT_AUTOMATED_EMAIL_TEMPLATES.reminderThreeDays, {
    customerName: 'Amelia',
    businessName: 'Glow Studio',
    serviceName: 'Facial',
  });
  assert.match(rendered.emailSubject, /Glow Studio/);
  assert.match(rendered.emailBody, /Facial/);
});

test('runtime settings apply editable copy and social branding centrally', () => {
  const result = applyEmailRuntimeSettings('booking-cancelled', {
    customerName: 'Amelia',
    serviceName: 'Facial',
  }, {
    replyToEmail: null,
    senderDisplayName: null,
    bookingConfirmationEnabled: true,
    bookingCancellationEnabled: true,
    bookingRescheduleEnabled: true,
    appointmentRemindersEnabled: true,
    formDeliveryEnabled: true,
    formRemindersEnabled: true,
    paymentConfirmationEnabled: true,
    formReminderTiming: '24_hours_before_appointment',
    mainBookingFormId: null,
    branding,
    automations: {
      businessBookingConfirmationEnabled: true,
      reminderThreeDaysEnabled: true,
      reminderOneDayEnabled: true,
      customerThankYouEnabled: true,
      businessPaymentReceivedEnabled: true,
    },
    templates: DEFAULT_AUTOMATED_EMAIL_TEMPLATES,
  });
  assert.match(String(result.emailSubject), /Glow Studio/);
  assert.match(String(result.emailBody), /Amelia/);
  assert.equal(result.instagramUrl, 'https://instagram.com/glow');
});

test('booking lifecycle schedules independent 72-hour and 24-hour email reminders', () => {
  const bookings = source('modules/bookings/booking.service.ts');
  assert.match(bookings, /reminderThreeDaysEnabled \? \[72\]/);
  assert.match(bookings, /reminderOneDayEnabled \? \[24\]/);
  const reminderStart = bookings.indexOf('private async enqueueEmailReminders');
  const reminderEnd = bookings.indexOf('async getBookingsByDateRange', reminderStart);
  const reminderBlock = bookings.slice(reminderStart, reminderEnd);
  assert.doesNotMatch(reminderBlock, /smsReminderTiming/);
  assert.match(reminderBlock, /renderAutomatedEmailCopy/);
});

test('main booking form is gated by the booking-confirmation outbox insert', () => {
  const email = source('modules/email/email.service.ts');
  const mainForm = source('modules/email/main-booking-form.service.ts');
  assert.match(email, /inserted\s*&&\s*params\.templateKey === 'booking-confirmed'/);
  assert.match(email, /runtimeSettings\?\.mainBookingFormId/);
  assert.match(email, /main-form-reminder:\$\{form\.assignmentId\}/);
  assert.match(mainForm, /randomBytes\(32\)/);
  assert.match(mainForm, /publicTokenHash: hashToken\(token\)/);
  assert.match(mainForm, /deliveryContext: 'MAIN_BOOKING_EMAIL'/);
  assert.match(mainForm, /inArray\(formAssignments\.status, \['PENDING', 'OPENED'\]\)/);
});

test('business booking and payment notifications use dedicated branded templates', () => {
  const bookings = source('modules/bookings/booking.service.ts');
  const payments = source('modules/payments/payments.service.ts');
  assert.match(bookings, /templateKey: 'business-booking-confirmed'/);
  assert.match(payments, /templateKey: 'business-payment-received'/);
  assert.match(payments, /businessPaymentReceivedEnabled/);
});

test('worker cancels stale or superseded appointment emails before sending', () => {
  const email = source('modules/email/email.service.ts');
  const safety = source('modules/email/email-safety.ts');
  assert.match(email, /appointmentNotificationCancellationCode/);
  assert.match(email, /appointments\.startTime/);
  assert.match(email, /appointments\.status/);
  assert.match(email, /status: 'CANCELLED'/);
  assert.match(safety, /APPOINTMENT_NOTIFICATION_NO_LONGER_APPLICABLE/);
  assert.match(safety, /APPOINTMENT_NOTIFICATION_SUPERSEDED/);
  assert.match(safety, /currentStart <= now/);
  assert.match(safety, /Math\.abs\(currentStart - intendedStart\)/);
});

test('email review routing uses Google first and Trustpilot for returning customers', () => {
  const invitations = source('modules/reputation/review-invitation.service.ts');
  assert.match(invitations, /previousCompletedVisits/);
  assert.match(invitations, /> 0 \? 'TRUSTPILOT' : 'GOOGLE'/);
  assert.match(invitations, /customerThankYouTrustpilot/);
  assert.match(invitations, /customerThankYouGoogle/);
});

test('automated-email settings remain backend-only and tenant-scoped', () => {
  const migration = readFileSync(new URL('../../../packages/database/migrations/20260803120000_tenant_automated_email_settings.sql', import.meta.url), 'utf8');
  assert.match(migration, /tenant_id uuid PRIMARY KEY REFERENCES public\.tenants/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.tenant_email_automation_settings FROM anon, authenticated/);
  assert.match(migration, /jsonb_typeof\(settings_json\) = 'object'/);
});
