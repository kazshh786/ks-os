import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canOfferSlotWithinSchedule,
  resolveEffectiveAvailabilityWindows,
} from '../src/modules/availability/availability-schedule.js';

const owner = { userId: 'owner-1', userName: 'Salon owner' };

test('an open date override makes a normally closed day bookable', () => {
  assert.deepEqual(resolveEffectiveAvailabilityWindows(
    [owner],
    [],
    [{ userId: owner.userId, enabled: true, startTime: '09:00', endTime: '17:00' }],
  ), [{ ...owner, startTime: '09:00', endTime: '17:00', source: 'override' }]);
});

test('a closed date override replaces the normal weekly schedule', () => {
  assert.deepEqual(resolveEffectiveAvailabilityWindows(
    [owner],
    [{ userId: owner.userId, startTime: '09:00', endTime: '17:00' }],
    [{ userId: owner.userId, enabled: false, startTime: '00:00', endTime: '00:00' }],
  ), []);
});

test('mobile overrides can use out-of-hours times independently', () => {
  assert.deepEqual(resolveEffectiveAvailabilityWindows(
    [owner],
    [{ userId: owner.userId, startTime: '10:00', endTime: '16:00' }],
    [{ userId: owner.userId, enabled: true, startTime: '18:30', endTime: '21:00' }],
  ), [{ ...owner, startTime: '18:30', endTime: '21:00', source: 'override' }]);
});

test('a long appointment remains blocked when it would finish after closing by default', () => {
  assert.equal(canOfferSlotWithinSchedule({
    startMinute: 18 * 60 + 30,
    totalDurationMinutes: 90,
    scheduleEndMinute: 19 * 60,
    allowAppointmentsPastClosingTime: false,
  }), false);
});

test('a long appointment can start before closing when the tenant setting is enabled', () => {
  assert.equal(canOfferSlotWithinSchedule({
    startMinute: 18 * 60 + 30,
    totalDurationMinutes: 90,
    scheduleEndMinute: 19 * 60,
    allowAppointmentsPastClosingTime: true,
  }), true);
});

test('the overrun setting never creates a slot that starts at or after closing', () => {
  assert.equal(canOfferSlotWithinSchedule({
    startMinute: 19 * 60,
    totalDurationMinutes: 90,
    scheduleEndMinute: 19 * 60,
    allowAppointmentsPastClosingTime: true,
  }), false);
});
