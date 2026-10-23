/** Display and collect wall-clock time in the meeting's IANA time zone, not the device's. */
export function meetingDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function localMeetingTime(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const part = (name: string) => parts.find(item => item.type === name)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** Reject skipped DST times and explicitly offer both occurrences of a repeated hour. */
export function meetingTimeChoices(local: string, timeZone: string): Array<{ value: string; label: string }> {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return [];
  const wall = Date.parse(local + ':00Z');
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== local) return [];
  try {
    const offsets = new Set<number>();
    // Nearby instants include both offsets at a transition, even for non-hour offsets.
    for (const hours of [-48, -24, -12, 0, 12, 24, 48]) {
      const instant = wall + hours * 3600000;
      offsets.add(Date.parse(localMeetingTime(new Date(instant).toISOString(), timeZone) + ':00Z') - instant);
    }
    const values = [...offsets].map(offset => new Date(wall - offset).toISOString()).filter(value => localMeetingTime(value, timeZone) === local).sort();
    return [...new Set(values)].map(value => ({ value, label: new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset' }).format(new Date(value)) }));
  } catch { return []; }
}

export const meetingTimeZones = ['Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney', 'Pacific/Auckland', 'UTC'];

export function offsetMeetingTime(local: string, instant: string) {
  const offset = Math.round((Date.parse(local + ':00Z') - Date.parse(instant)) / 60000);
  return `${local}:00${offset >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
}
