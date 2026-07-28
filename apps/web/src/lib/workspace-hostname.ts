const DEFAULT_WORKSPACE_DOMAIN = 'kasimshah.com';

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

export function currentWorkspaceSlug(): string | null {
  if (typeof window === 'undefined') return null;
  return resolveWorkspaceSlugFromHostname(window.location.hostname);
}
