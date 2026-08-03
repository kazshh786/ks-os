import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UpdateCommunicationsSettingsSchema } from '@ks-os/contracts';
import {
  DEFAULT_AUTOMATED_EMAIL_TEMPLATES,
  interpolateEmailCopy,
  renderAutomatedEmailCopy,
} from '../src/modules/email/email-settings.service.js';

const source = (path: string) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');

test('editable copy is plain text, bounded and rejects subject header injection', () => {
  const valid = UpdateCommunicationsSettingsSchema.safeParse({
    templates: DEFAULT_AUTOMATED_EMAIL_TEMPLATES,
  });
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

test('business booking and payment notifications use dedicated branded templates', () => {
  const bookings = source('modules/bookings/booking.service.ts');
  const payments = source('modules/payments/payments.service.ts');
  assert.match(bookings, /templateKey: 'business-booking-confirmed'/);
  assert.match(payments, /templateKey: 'business-payment-received'/);
  assert.match(payments, /businessPaymentReceivedEnabled/);
});

test('worker cancels stale time-sensitive appointment emails before sending', () => {
  const email = source('modules/email/email.service.ts');
  assert.match(email, /TIME_SENSITIVE_APPOINTMENT_TEMPLATES/);
  assert.match(email, /appointment\.startTime\.getTime\(\) <= Date\.now\(\)/);
  assert.match(email, /appointment\.status === 'CANCELLED'/);
  assert.match(email, /APPOINTMENT_NOTIFICATION_NO_LONGER_APPLICABLE/);
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
