import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSecureFormUrl,
  formReminderScheduledFor,
  shouldQueueFormAssignmentEmail,
  shouldQueueFormReminder,
} from '../src/modules/forms/form-delivery.js';

const base = {
  recipientEmail: 'client@business.co.uk',
  formDeliveryEnabled: true,
  secureUrl: 'https://app.kasimshah.com/forms/complete/secure-token',
};

test('EMAIL assignment queues email and preserves the secure completion URL', () => {
  assert.equal(shouldQueueFormAssignmentEmail({ ...base, deliveryMethod: 'EMAIL' }), true);
  assert.equal(
    buildSecureFormUrl('https://app.kasimshah.com/', 'secure-token'),
    'https://app.kasimshah.com/forms/complete/secure-token',
  );
});

test('SMS assignment does not queue form email or email reminders', () => {
  assert.equal(shouldQueueFormAssignmentEmail({ ...base, deliveryMethod: 'SMS' }), false);
  assert.equal(shouldQueueFormReminder({
    ...base,
    deliveryMethod: 'SMS',
    formRemindersEnabled: true,
    scheduledFor: new Date('2026-08-20T10:00:00.000Z'),
    expiresAt: new Date('2026-08-21T10:00:00.000Z'),
    now: new Date('2026-08-19T10:00:00.000Z'),
  }), false);
});

test('COPY_LINK assignment does not queue form email or email reminders', () => {
  assert.equal(shouldQueueFormAssignmentEmail({ ...base, deliveryMethod: 'COPY_LINK' }), false);
  assert.equal(shouldQueueFormReminder({
    ...base,
    deliveryMethod: 'COPY_LINK',
    formRemindersEnabled: true,
    scheduledFor: new Date('2026-08-20T10:00:00.000Z'),
    expiresAt: new Date('2026-08-21T10:00:00.000Z'),
    now: new Date('2026-08-19T10:00:00.000Z'),
  }), false);
});

test('EMAIL reminders follow configured timing and expiry bounds', () => {
  const assignedAt = new Date('2026-08-18T10:00:00.000Z');
  const appointmentStart = new Date('2026-08-21T10:00:00.000Z');
  assert.equal(
    formReminderScheduledFor('24_hours_after_assignment', assignedAt)?.toISOString(),
    '2026-08-19T10:00:00.000Z',
  );
  assert.equal(
    formReminderScheduledFor('48_hours_before_appointment', assignedAt, appointmentStart)?.toISOString(),
    '2026-08-19T10:00:00.000Z',
  );
  assert.equal(formReminderScheduledFor('no_reminder', assignedAt, appointmentStart), null);
  assert.equal(shouldQueueFormReminder({
    ...base,
    deliveryMethod: 'EMAIL',
    formRemindersEnabled: true,
    scheduledFor: new Date('2026-08-19T10:00:00.000Z'),
    expiresAt: new Date('2026-08-22T10:00:00.000Z'),
    now: new Date('2026-08-18T10:00:00.000Z'),
  }), true);
});
