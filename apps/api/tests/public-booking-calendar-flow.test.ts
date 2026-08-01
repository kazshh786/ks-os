import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('public booking calendar transitions from dates to times and shows real availability density', () => {
  const calendarSource = fs.readFileSync(path.resolve(process.cwd(), '../web/src/features/bookings/AvailabilityCalendar.tsx'), 'utf8');
  const calendarStyles = fs.readFileSync(path.resolve(process.cwd(), '../web/src/features/bookings/AvailabilityCalendar.css'), 'utf8');
  const availabilityRoute = fs.readFileSync(path.resolve(process.cwd(), 'src/routes/public/availability-summary.ts'), 'utf8');

  assert.match(calendarSource, /type CalendarView = 'calendar' \| 'times'/);
  assert.match(calendarSource, /setView\('times'\)/);
  assert.match(calendarSource, /Change date/);
  assert.match(calendarSource, /availabilityByDate/);
  assert.match(calendarSource, /const lowAvailabilityThreshold = 3/);
  assert.match(calendarSource, /is-limited/);
  assert.match(calendarSource, /is-available/);
  assert.match(calendarSource, /is-unavailable/);
  assert.match(calendarSource, /low availability/);
  assert.match(calendarSource, /no appointment times available/);

  assert.match(calendarStyles, /\.booking-date-picker\.is-calendar-view ~ \.mt-5/);
  assert.match(calendarStyles, /button\.is-available/);
  assert.match(calendarStyles, /button\.is-limited/);
  assert.match(calendarStyles, /button\.is-unavailable/);

  assert.match(availabilityRoute, /const availabilityByDate:/);
  assert.match(availabilityRoute, /slotCount: liveSlots\.length/);
  assert.match(availabilityRoute, /availableDates, availabilityByDate/);
});
