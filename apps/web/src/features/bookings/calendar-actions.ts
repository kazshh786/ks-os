export type CalendarProvider = 'google' | 'outlook' | 'microsoft365' | 'yahoo' | 'native';

export type CalendarEventDetails = {
  title: string;
  startTime: string;
  endTime: string;
  description: string;
  location: string;
  icsDataUrl: string;
};

const GOOGLE_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
const OUTLOOK_DOMAINS = new Set(['outlook.com', 'hotmail.com', 'live.com', 'msn.com']);
const YAHOO_DOMAINS = new Set(['yahoo.com', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com', 'aol.com']);
const APPLE_DOMAINS = new Set(['icloud.com', 'me.com', 'mac.com']);

function emailDomain(email?: string | null) {
  const value = email?.trim().toLowerCase();
  const at = value?.lastIndexOf('@') ?? -1;
  return at > 0 ? value!.slice(at + 1) : null;
}

export function inferCalendarProvider(
  email?: string | null,
  userAgent = '',
  platform = '',
): CalendarProvider | null {
  const domain = emailDomain(email);
  if (domain && GOOGLE_DOMAINS.has(domain)) return 'google';
  if (domain && OUTLOOK_DOMAINS.has(domain)) return 'outlook';
  if (domain && YAHOO_DOMAINS.has(domain)) return 'yahoo';
  if (domain && APPLE_DOMAINS.has(domain)) return 'native';

  const device = `${userAgent} ${platform}`.toLowerCase();
  if (/android|cros/.test(device)) return 'google';
  if (/windows|win32|win64/.test(device)) return 'microsoft365';
  if (/iphone|ipad|ipod|macintosh|macintel/.test(device)) return 'native';
  return null;
}

function unfoldCalendarLines(value: string) {
  return value.replace(/\r?\n[ \t]/g, '');
}

function unescapeCalendarText(value: string) {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function readCalendarField(lines: string[], field: string) {
  const prefix = `${field}:`;
  const parameterPrefix = `${field};`;
  const line = lines.find(item => item.startsWith(prefix) || item.startsWith(parameterPrefix));
  if (!line) return '';
  const separator = line.indexOf(':');
  return separator >= 0 ? line.slice(separator + 1) : '';
}

function parseCalendarDate(value: string) {
  const utc = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (utc) {
    const [, year, month, day, hour, minute, second] = utc;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
  }

  const local = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (local) {
    const [, year, month, day, hour, minute, second] = local;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`).toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Calendar event time is invalid.');
  return parsed.toISOString();
}

export function parseCalendarDataUrl(dataUrl: string): CalendarEventDetails {
  if (!dataUrl.startsWith('data:text/calendar')) throw new Error('Calendar event is unavailable.');
  const separator = dataUrl.indexOf(',');
  if (separator < 0) throw new Error('Calendar event is unavailable.');

  const raw = decodeURIComponent(dataUrl.slice(separator + 1));
  const lines = unfoldCalendarLines(raw).split(/\r?\n/);
  const title = unescapeCalendarText(readCalendarField(lines, 'SUMMARY'));
  const start = readCalendarField(lines, 'DTSTART');
  const end = readCalendarField(lines, 'DTEND');

  if (!title || !start || !end) throw new Error('Calendar event is incomplete.');

  return {
    title,
    startTime: parseCalendarDate(start),
    endTime: parseCalendarDate(end),
    description: unescapeCalendarText(readCalendarField(lines, 'DESCRIPTION')),
    location: unescapeCalendarText(readCalendarField(lines, 'LOCATION')),
    icsDataUrl: dataUrl,
  };
}

function compactUtc(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function addEventParameters(event: CalendarEventDetails) {
  return {
    subject: event.title,
    startdt: new Date(event.startTime).toISOString(),
    enddt: new Date(event.endTime).toISOString(),
    body: event.description,
    location: event.location,
  };
}

export function buildCalendarProviderUrl(event: CalendarEventDetails, provider: CalendarProvider) {
  if (provider === 'native') return event.icsDataUrl;

  if (provider === 'google') {
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.title,
      dates: `${compactUtc(event.startTime)}/${compactUtc(event.endTime)}`,
      details: event.description,
      location: event.location,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  if (provider === 'yahoo') {
    const params = new URLSearchParams({
      v: '60',
      title: event.title,
      st: compactUtc(event.startTime),
      et: compactUtc(event.endTime),
      desc: event.description,
      in_loc: event.location,
    });
    return `https://calendar.yahoo.com/?${params.toString()}`;
  }

  const base = provider === 'outlook'
    ? 'https://outlook.live.com/calendar/0/deeplink/compose'
    : 'https://outlook.office.com/calendar/0/deeplink/compose';
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    ...addEventParameters(event),
  });
  return `${base}?${params.toString()}`;
}

export function calendarProviderLabel(provider: CalendarProvider) {
  if (provider === 'google') return 'Google Calendar';
  if (provider === 'outlook') return 'Outlook Calendar';
  if (provider === 'microsoft365') return 'Microsoft 365 Calendar';
  if (provider === 'yahoo') return 'Yahoo Calendar';
  return 'device calendar';
}
