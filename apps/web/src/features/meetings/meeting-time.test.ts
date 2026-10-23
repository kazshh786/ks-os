import { describe, expect, it } from 'vitest';
import { localMeetingTime, meetingTimeChoices } from './meeting-time';

describe('meeting wall-clock conversion', () => {
  it('preserves London winter and summer instants independently of browser time zone', () => {
    expect(meetingTimeChoices('2026-01-20T10:00', 'Europe/London')[0].value).toBe('2026-01-20T10:00:00.000Z');
    expect(meetingTimeChoices('2026-07-20T10:00', 'Europe/London')[0].value).toBe('2026-07-20T09:00:00.000Z');
    expect(localMeetingTime('2026-07-20T09:00:00Z', 'Europe/London')).toBe('2026-07-20T10:00');
  });
  it('rejects the spring skipped hour instead of silently moving the appointment', () => {
    expect(meetingTimeChoices('2026-03-29T01:30', 'Europe/London')).toEqual([]);
  });
  it('offers both autumn occurrences so a person chooses the actual instant', () => {
    expect(meetingTimeChoices('2026-10-25T01:30', 'Europe/London').map(item => item.value)).toEqual(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']);
  });
  it('supports quarter-hour offsets and rejects invalid dates and zones', () => {
    expect(meetingTimeChoices('2026-07-20T10:00', 'Asia/Kathmandu')[0].value).toBe('2026-07-20T04:15:00.000Z');
    expect(meetingTimeChoices('2026-02-30T10:00', 'Europe/London')).toEqual([]);
    expect(meetingTimeChoices('2026-07-20T10:00', 'not-a-zone')).toEqual([]);
  });
});
