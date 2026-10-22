import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMeetingSchedule } from '../src/modules/communications/communications.meeting-time.js';

const resolve = (localStart: string, timezone = 'Europe/London', durationMinutes = 30) => resolveMeetingSchedule({ localStart, timezone, durationMinutes });
const fails = (work: () => unknown, code: string) => assert.throws(work, error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code && 'statusCode' in error && error.statusCode === 400));

test('meeting scheduling stores UTC and preserves the selected IANA zone', () => {
  assert.deepEqual(resolve('2027-01-15T09:30'), { scheduledStartAt: '2027-01-15T09:30:00.000Z', scheduledEndAt: '2027-01-15T10:00:00.000Z', timezone: 'Europe/London' });
  assert.equal(resolve('2027-07-15T09:30').scheduledStartAt, '2027-07-15T08:30:00.000Z');
  assert.equal(resolve('2027-07-15T09:30', 'Asia/Kathmandu').scheduledStartAt, '2027-07-15T03:45:00.000Z');
});

test('UK spring gap is rejected and fall repetition needs explicit matching offset', () => {
  fails(() => resolve('2027-03-28T01:30'), 'MEETING_TIME_NONEXISTENT');
  fails(() => resolve('2027-10-31T01:30'), 'MEETING_TIME_AMBIGUOUS');
  assert.equal(resolve('2027-10-31T01:30+01:00').scheduledStartAt, '2027-10-31T00:30:00.000Z');
  assert.equal(resolve('2027-10-31T01:30+00:00').scheduledStartAt, '2027-10-31T01:30:00.000Z');
  fails(() => resolve('2027-03-28T01:30+00:00'), 'MEETING_TIME_OFFSET_INVALID');
  fails(() => resolve('2027-07-15T09:30Z'), 'MEETING_TIME_OFFSET_INVALID');
});

test('elapsed duration across DST is measured in UTC rather than wall-clock subtraction', () => {
  assert.deepEqual(resolve('2027-03-28T00:30', 'Europe/London', 120), { scheduledStartAt: '2027-03-28T00:30:00.000Z', scheduledEndAt: '2027-03-28T02:30:00.000Z', timezone: 'Europe/London' });
  assert.equal(resolve('2027-10-31T01:30+01:00', 'Europe/London', 120).scheduledEndAt, '2027-10-31T02:30:00.000Z');
});

test('non-hour transitions and a skipped civil day are not silently normalized', () => {
  fails(() => resolve('2027-10-03T02:15', 'Australia/Lord_Howe'), 'MEETING_TIME_NONEXISTENT');
  fails(() => resolve('2027-04-04T01:45', 'Australia/Lord_Howe'), 'MEETING_TIME_AMBIGUOUS');
  fails(() => resolve('2011-12-30T12:00', 'Pacific/Apia'), 'MEETING_TIME_NONEXISTENT');
});

test('invalid dates, timezone injection and durations fail with safe validation errors', () => {
  for (const date of ['2027-02-29T12:00', '2027-04-31T12:00', '2027-01-01T24:00', '2027-01-01T12:61', 'not a time', '2027-01-01']) fails(() => resolve(date), 'MEETING_TIME_INVALID');
  for (const zone of ['Not/A_Zone', '+01:00', '', 'Europe/London<script>']) fails(() => resolve('2027-01-01T12:00', zone), 'MEETING_TIMEZONE_INVALID');
  for (const duration of [0, -1, 1.5, NaN, Infinity, 1441]) fails(() => resolve('2027-01-01T12:00', 'UTC', duration), 'MEETING_DURATION_INVALID');
  assert.equal(resolve('2028-02-29T12:00:01.25', 'UTC').scheduledStartAt, '2028-02-29T12:00:01.250Z');
});
