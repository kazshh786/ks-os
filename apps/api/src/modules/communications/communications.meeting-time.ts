export interface MeetingScheduleInput {
  localStart: string;
  timezone: string;
  durationMinutes: number;
}

const invalid = (code: string, message: string) => Object.assign(new Error(message), { statusCode: 400, code });
type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
const fields = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const;

function wallClock(parts: LocalParts, millisecond = 0) {
  const value = new Date(0);
  value.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  value.setUTCHours(parts.hour, parts.minute, parts.second, millisecond);
  return value.getTime();
}

/** Explicitly resolve wall time; never silently move a DST gap or choose a fold. */
export function resolveMeetingSchedule(input: MeetingScheduleInput): {
  scheduledStartAt: string; scheduledEndAt: string; timezone: string;
} {
  if (typeof input.timezone !== 'string' || input.timezone.length > 100 || !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(input.timezone)) {
    throw invalid('MEETING_TIMEZONE_INVALID', 'Choose a valid IANA timezone.');
  }
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-GB', { timeZone: input.timezone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { throw invalid('MEETING_TIMEZONE_INVALID', 'Choose a valid IANA timezone.'); }
  const match = typeof input.localStart === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(input.localStart);
  if (!match) throw invalid('MEETING_TIME_INVALID', 'Enter a valid local date and time.');
  const local: LocalParts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] || 0) };
  const millisecond = Number((match[7] || '').padEnd(3, '0'));
  const wall = wallClock(local, millisecond), checked = new Date(wall);
  if (local.year < 1 || local.year > 9998 || local.month < 1 || local.month > 12 || local.day < 1 || local.hour > 23 || local.minute > 59 || local.second > 59
    || checked.getUTCFullYear() !== local.year || checked.getUTCMonth() + 1 !== local.month || checked.getUTCDate() !== local.day) {
    throw invalid('MEETING_TIME_INVALID', 'Enter a valid local date and time.');
  }
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 1440) {
    throw invalid('MEETING_DURATION_INVALID', 'Meeting duration must be between 1 and 1440 whole minutes.');
  }
  const at = (instant: number): LocalParts => {
    const values = Object.fromEntries(format.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    return Object.fromEntries(fields.map(field => [field, Number(values[field])])) as unknown as LocalParts;
  };
  const matches = (instant: number) => { const actual = at(instant); return fields.every(field => actual[field] === local[field]); };
  let start: number;
  if (match[8]) {
    const offset = match[8];
    const hours = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
    const minutes = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
    if (hours > 23 || minutes > 59) throw invalid('MEETING_TIME_INVALID', 'Enter a valid UTC offset.');
    start = wall - (offset.startsWith('-') ? -1 : 1) * (hours * 60 + minutes) * 60000;
    if (!matches(start)) throw invalid('MEETING_TIME_OFFSET_INVALID', 'That UTC offset does not match the selected timezone at this time.');
  } else {
    // Sampling offsets around the date covers both sides of transitions, including
    // half-hour changes and the 24-hour skipped day, without using the host timezone.
    const offsets = new Set<number>();
    const secondWall = wall - millisecond;
    for (let hours = -48; hours <= 48; hours += 6) {
      const probe = secondWall + hours * 3600000;
      offsets.add(wallClock(at(probe)) - probe);
    }
    const candidates = [...new Set([...offsets].map(offset => wall - offset).filter(matches))];
    if (!candidates.length) throw invalid('MEETING_TIME_NONEXISTENT', 'That local time does not exist because the clocks change. Choose another time.');
    if (candidates.length > 1) throw invalid('MEETING_TIME_AMBIGUOUS', 'That local time occurs twice because the clocks change. Include the intended UTC offset.');
    start = candidates[0];
  }
  return { scheduledStartAt: new Date(start).toISOString(), scheduledEndAt: new Date(start + input.durationMinutes * 60000).toISOString(), timezone: format.resolvedOptions().timeZone };
}
