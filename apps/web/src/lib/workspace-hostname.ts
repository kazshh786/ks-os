const DEFAULT_WORKSPACE_DOMAIN = 'kasimshah.com';

export const CUSTOM_DOMAIN_BOOKING_IDENTIFIER = 'custom-domain';

const RESERVED_WORKSPACE_LABELS = new Set([
  'admin',
  'agency',
  'api',
  'app',
  'booking',
  'mail',
  'sites',
  'staging',
  'www',
]);

function normaliseHostname(value: string): string {
  return value.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

export function resolveWorkspaceSlugFromHostname(
  hostname: string,
  workspaceDomain = import.meta.env.VITE_PUBLIC_WORKSPACE_DOMAIN || DEFAULT_WORKSPACE_DOMAIN,
): string | null {
  const safeHostname = normaliseHostname(hostname);
  const safeDomain = normaliseHostname(workspaceDomain);
  const suffix = `.${safeDomain}`;
  if (!safeHostname.endsWith(suffix)) return null;

  const label = safeHostname.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return null;
  if (RESERVED_WORKSPACE_LABELS.has(label)) return null;
  return label;
}

export function resolvePublicBookingIdentifierFromHostname(
  hostname: string,
  workspaceDomain = import.meta.env.VITE_PUBLIC_WORKSPACE_DOMAIN || DEFAULT_WORKSPACE_DOMAIN,
): string | null {
  const workspaceSlug = resolveWorkspaceSlugFromHostname(hostname, workspaceDomain);
  if (workspaceSlug) return workspaceSlug;

  const safeHostname = normaliseHostname(hostname);
  const safeDomain = normaliseHostname(workspaceDomain);
  if (!safeHostname || safeHostname === 'localhost' || safeHostname === '127.0.0.1' || safeHostname === '::1') return null;
  if (safeHostname === safeDomain || safeHostname.endsWith(`.${safeDomain}`)) return null;
  if (!/^(?=.{4,255}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(safeHostname)) return null;
  return CUSTOM_DOMAIN_BOOKING_IDENTIFIER;
}

export function currentWorkspaceSlug(): string | null {
  if (typeof window === 'undefined') return null;
  return resolveWorkspaceSlugFromHostname(window.location.hostname);
}

export function currentPublicBookingIdentifier(): string | null {
  if (typeof window === 'undefined') return null;
  return resolvePublicBookingIdentifierFromHostname(window.location.hostname);
}
