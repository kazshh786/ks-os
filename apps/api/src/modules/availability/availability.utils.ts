import { fromZonedTime } from 'date-fns-tz';

export function zonedDateTimeToUtc(dateStr: string, timeStr: string, timezone: string): Date {
  return parseLocalTimeToUtc(dateStr, timeStr, timezone);
}

export function parseLocalTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const localString = `${dateStr}T${timeStr}:00`;
  return fromZonedTime(localString, timeZone);
}
