import { describe, expect, it } from 'vitest';
import {
  buildCalendarProviderUrl,
  inferCalendarProvider,
  parseCalendarDataUrl,
} from './calendar-actions.js';

const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTSTART:20260810T090000Z',
  'DTEND:20260810T100000Z',
  'SUMMARY:Haircut at KS Agency',
  'LOCATION:1 High Street\\, Blackburn',
  'DESCRIPTION:Booking reference KS-123',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const dataUrl = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;

describe('calendar provider actions', () => {
  it('infers common calendar providers from the customer email first', () => {
    expect(inferCalendarProvider('person@gmail.com', 'Windows', 'Win32')).toBe('google');
    expect(inferCalendarProvider('person@outlook.com', 'iPhone', 'iPhone')).toBe('outlook');
    expect(inferCalendarProvider('person@yahoo.co.uk')).toBe('yahoo');
    expect(inferCalendarProvider('person@icloud.com')).toBe('native');
  });

  it('does not guess the provider for a custom business email domain', () => {
    expect(inferCalendarProvider('person@clientbusiness.co.uk', 'Windows', 'Win32')).toBeNull();
  });

  it('uses the device only when an email provider is unavailable', () => {
    expect(inferCalendarProvider(null, 'Mozilla/5.0 (Linux; Android 16)', '')).toBe('google');
    expect(inferCalendarProvider(null, 'Mozilla/5.0', 'MacIntel')).toBe('native');
    expect(inferCalendarProvider(null, 'Mozilla/5.0 (Windows NT 10.0)', 'Win32')).toBe('microsoft365');
  });

  it('parses the existing booking event without exposing a file download', () => {
    const event = parseCalendarDataUrl(dataUrl);
    expect(event.title).toBe('Haircut at KS Agency');
    expect(event.startTime).toBe('2026-08-10T09:00:00.000Z');
    expect(event.endTime).toBe('2026-08-10T10:00:00.000Z');
    expect(event.location).toBe('1 High Street, Blackburn');
  });

  it('creates prefilled Google, Outlook, Microsoft 365 and Yahoo event links', () => {
    const event = parseCalendarDataUrl(dataUrl);
    const google = new URL(buildCalendarProviderUrl(event, 'google'));
    const outlook = new URL(buildCalendarProviderUrl(event, 'outlook'));
    const microsoft365 = new URL(buildCalendarProviderUrl(event, 'microsoft365'));
    const yahoo = new URL(buildCalendarProviderUrl(event, 'yahoo'));

    expect(google.hostname).toBe('calendar.google.com');
    expect(google.searchParams.get('text')).toBe(event.title);
    expect(google.searchParams.get('dates')).toBe('20260810T090000Z/20260810T100000Z');
    expect(outlook.hostname).toBe('outlook.live.com');
    expect(outlook.searchParams.get('subject')).toBe(event.title);
    expect(microsoft365.hostname).toBe('outlook.office.com');
    expect(yahoo.hostname).toBe('calendar.yahoo.com');
    expect(buildCalendarProviderUrl(event, 'native')).toBe(dataUrl);
  });
});
