import { createHash, createHmac } from 'node:crypto';

export const RESERVED_BOOKING_SLUGS = new Set([
  'admin', 'api', 'app', 'assets', 'auth', 'book', 'booking', 'calendar',
  'customer', 'help', 'login', 'manage', 'settings', 'staff', 'status',
  'support', 'www',
]);

export function normaliseBookingSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  const safe = slug.length >= 2 ? slug : 'business';
  return RESERVED_BOOKING_SLUGS.has(safe) ? `book-${safe}`.slice(0, 63) : safe;
}
export function bookingPublicUrl(origin: string, slug: string, preview = false): string {
  const base = origin.replace(/\/$/, '');
  return `${base}/book/${encodeURIComponent(slug)}${preview ? '?preview=1' : ''}`;
}

export function deterministicPublicToken(scope: string, id: string, secret: string): string {
  return createHmac('sha256', secret).update(`${scope}:${id}`).digest('base64url');
}

export function hashPublicToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export function hashAnalyticsSession(sessionId: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${sessionId}`).digest('hex');
}

export function safeReferrerHost(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return /^[a-z0-9.-]{1,255}$/.test(host) ? host : null;
  } catch {
    return null;
  }
}
