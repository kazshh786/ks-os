import { createHash, createHmac } from 'node:crypto';

export const RESERVED_BOOKING_SLUGS = new Set([
  'admin', 'api', 'app', 'assets', 'auth', 'book', 'booking', 'calendar',
  'custom-domain', 'customer', 'help', 'login', 'manage', 'settings', 'staff',
  'status', 'support', 'www',
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
  const configuredDomain = process.env.PUBLIC_WORKSPACE_DOMAIN?.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  let workspaceDomain = configuredDomain || null;
  if (!workspaceDomain) {
    try {
      const hostname = new URL(origin).hostname.toLowerCase();
      if (hostname === 'kasimshah.com' || hostname.endsWith('.kasimshah.com')) workspaceDomain = 'kasimshah.com';
    } catch {
      workspaceDomain = null;
    }
  }
  if (workspaceDomain) {
    return `https://${encodeURIComponent(slug)}.${workspaceDomain}/book${preview ? '?preview=1' : ''}`;
  }
  const base = origin.replace(/\/$/, '');
  return `${base}/book/${encodeURIComponent(slug)}${preview ? '?preview=1' : ''}`;
}

export function verifiedBookingPublicUrl(domain: string, preview = false): string | null {
  try {
    const url = new URL(`https://${domain.trim().toLowerCase()}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!/^(?=.{4,255}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)) return null;
    return `${url.origin}/book${preview ? '?preview=1' : ''}`;
  } catch {
    return null;
  }
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
