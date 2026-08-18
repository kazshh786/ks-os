import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_OPENING_HOURS,
  resolveOpeningHoursSchedule,
  resolveOpeningState,
} from '../src/opening-hours.js';

test('canonical location hours remain authoritative when configured', () => {
  const result = resolveOpeningHoursSchedule(
    [{ dayOfWeek: 1, opensAt: '10:00:00', closesAt: '16:00:00' }],
    [{ dayOfWeek: 1, opensAt: '09:00:00', closesAt: '17:00:00' }],
  );
  assert.equal(result.source, 'CANONICAL_HOURS');
  assert.deepEqual(result.rows, [{ dayOfWeek: 1, opens: '10:00', closes: '16:00' }]);
});

test('booking schedules are the fallback and duplicate staff rows are collapsed', () => {
  const result = resolveOpeningHoursSchedule([], [
    { dayOfWeek: 1, opensAt: '09:30:00', closesAt: '18:00:00' },
    { dayOfWeek: 1, opensAt: '09:30:00', closesAt: '18:00:00' },
    { dayOfWeek: 6, opensAt: '09:00:00', closesAt: '16:00:00' },
  ]);
  assert.equal(result.source, 'BOOKING_SCHEDULE_FALLBACK');
  assert.deepEqual(result.rows, [
    { dayOfWeek: 1, opens: '09:30', closes: '18:00' },
    { dayOfWeek: 6, opens: '09:00', closes: '16:00' },
  ]);
});

test('businesses without configured hours receive the KS OS Monday-Friday 9-5 default', () => {
  const result = resolveOpeningHoursSchedule([], []);
  assert.equal(result.source, 'SYSTEM_DEFAULT');
  assert.equal(result.rows.length, DEFAULT_OPENING_HOURS.length);
  assert.deepEqual(result.rows, [
    { dayOfWeek: 1, opens: '09:00', closes: '17:00' },
    { dayOfWeek: 2, opens: '09:00', closes: '17:00' },
    { dayOfWeek: 3, opens: '09:00', closes: '17:00' },
    { dayOfWeek: 4, opens: '09:00', closes: '17:00' },
    { dayOfWeek: 5, opens: '09:00', closes: '17:00' },
  ]);
});

test('live opening state also uses the system default instead of becoming unavailable', () => {
  const state = resolveOpeningState({
    now: new Date('2026-08-17T11:00:00.000Z'),
    timezone: 'Europe/London',
    active: true,
    canonicalHours: [],
    bookingHours: [],
  });
  assert.equal(state.state, 'OPEN');
  assert.equal(state.source, 'SYSTEM_DEFAULT');
  assert.match(state.label, /closes at 17:00/);
});
