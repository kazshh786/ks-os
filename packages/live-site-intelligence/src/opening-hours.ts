import type { PublicOpeningState } from './contracts.js';

export type OpeningHoursRow = {
  dayOfWeek: number;
  opensAt: unknown;
  closesAt: unknown;
};

export type ResolvedOpeningHoursSource =
  | 'CANONICAL_HOURS'
  | 'BOOKING_SCHEDULE_FALLBACK'
  | 'SYSTEM_DEFAULT';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const DEFAULT_OPENING_HOURS: readonly OpeningHoursRow[] = [
  { dayOfWeek: 1, opensAt: '09:00', closesAt: '17:00' },
  { dayOfWeek: 2, opensAt: '09:00', closesAt: '17:00' },
  { dayOfWeek: 3, opensAt: '09:00', closesAt: '17:00' },
  { dayOfWeek: 4, opensAt: '09:00', closesAt: '17:00' },
  { dayOfWeek: 5, opensAt: '09:00', closesAt: '17:00' },
];

function clock(value: unknown) {
  const match = typeof value === 'string' ? value.match(/^(\d{2}):(\d{2})/) : null;
  return match ? `${match[1]}:${match[2]}` : null;
}

function localClock(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const weekday = parts.find(part => part.type === 'weekday')?.value;
  const hour = parts.find(part => part.type === 'hour')?.value;
  const minute = parts.find(part => part.type === 'minute')?.value;
  return {
    day: Math.max(0, WEEKDAYS.indexOf(weekday as typeof WEEKDAYS[number])),
    time: `${hour ?? '00'}:${minute ?? '00'}`,
  };
}

export function resolveOpeningHoursSchedule(
  canonicalHours: readonly OpeningHoursRow[],
  bookingHours: readonly OpeningHoursRow[],
) {
  const source: ResolvedOpeningHoursSource = canonicalHours.length
    ? 'CANONICAL_HOURS'
    : bookingHours.length
      ? 'BOOKING_SCHEDULE_FALLBACK'
      : 'SYSTEM_DEFAULT';
  const sourceRows = canonicalHours.length
    ? canonicalHours
    : bookingHours.length
      ? bookingHours
      : DEFAULT_OPENING_HOURS;
  const seen = new Set<string>();
  const rows = sourceRows.flatMap(row => {
    const opens = clock(row.opensAt);
    const closes = clock(row.closesAt);
    if (!opens || !closes || row.dayOfWeek < 0 || row.dayOfWeek > 6 || opens >= closes) return [];
    const key = `${row.dayOfWeek}:${opens}:${closes}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ dayOfWeek: row.dayOfWeek, opens, closes }];
  }).sort((left, right) => left.dayOfWeek - right.dayOfWeek
    || left.opens.localeCompare(right.opens)
    || left.closes.localeCompare(right.closes));
  return { source, rows } as const;
}

export function resolveOpeningState(input: {
  now: Date;
  timezone: string;
  active: boolean;
  canonicalHours: readonly OpeningHoursRow[];
  bookingHours: readonly OpeningHoursRow[];
  closure?: { publicLabel: string };
}): PublicOpeningState {
  if (!input.active) return { state: 'CLOSED', label: 'Closed', source: 'CANONICAL_HOURS' };
  if (input.closure) {
    return {
      state: 'TEMPORARILY_CLOSED',
      label: input.closure.publicLabel,
      source: 'CANONICAL_HOURS',
    };
  }
  const schedule = resolveOpeningHoursSchedule(input.canonicalHours, input.bookingHours);
  const local = localClock(input.now, input.timezone);
  const current = schedule.rows.find(row =>
    row.dayOfWeek === local.day && row.opens <= local.time && row.closes > local.time);
  if (current) return {
    state: 'OPEN',
    label: `Open now · closes at ${current.closes}`,
    source: schedule.source,
  };
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = (local.day + offset) % 7;
    const next = schedule.rows
      .filter(row => row.dayOfWeek === day && (offset > 0 || row.opens > local.time))
      .sort((left, right) => left.opens.localeCompare(right.opens))[0];
    if (next) {
      const when = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : WEEKDAYS[day];
      return {
        state: 'CLOSED',
        label: `Closed · opens ${when} at ${next.opens}`,
        source: schedule.source,
      };
    }
  }
  return { state: 'CLOSED', label: 'Closed', source: schedule.source };
}
