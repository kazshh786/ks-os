import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

export class HostnameValidationError extends Error {
  readonly code = 'PUBLIC_HOST_INVALID';

  constructor(message = 'The request hostname is invalid.') {
    super(message);
    this.name = 'HostnameValidationError';
  }
}

function splitPort(value: string): { hostname: string; port?: number } {
  if (value.startsWith('[')) {
    const closing = value.indexOf(']');
    if (closing < 0) throw new HostnameValidationError();
    const address = value.slice(1, closing);
    const suffix = value.slice(closing + 1);
    if (suffix && !/^:\d{1,5}$/.test(suffix)) throw new HostnameValidationError();
    const port = suffix ? Number(suffix.slice(1)) : undefined;
    return { hostname: address, port };
  }

  const colonCount = [...value].filter((character) => character === ':').length;
  if (colonCount > 1) throw new HostnameValidationError();
  if (colonCount === 0) return { hostname: value };
  const [hostname, rawPort] = value.split(':');
  if (!hostname || !rawPort || !/^\d{1,5}$/.test(rawPort)) {
    throw new HostnameValidationError();
  }
  return { hostname, port: Number(rawPort) };
}

export function normalizePublicHostname(rawHost: string): string {
  if (!rawHost || rawHost !== rawHost.trim() || rawHost.length > 320) {
    throw new HostnameValidationError();
  }
  if (/[\u0000-\u001f\u007f/@?#\\,\s]/.test(rawHost)) {
    throw new HostnameValidationError();
  }

  const { hostname: rawHostname, port } = splitPort(rawHost);
  if (port !== undefined && (port < 1 || port > 65_535)) {
    throw new HostnameValidationError();
  }
  if (isIP(rawHostname)) return rawHostname.toLowerCase();

  const hostname = domainToASCII(rawHostname.toLowerCase());
  if (!hostname || hostname.length > 253 || hostname.endsWith('.')) {
    throw new HostnameValidationError();
  }
  if (hostname === 'localhost') return hostname;

  const labels = hostname.split('.');
  if (
    labels.some((label) =>
      !label
      || label.length > 63
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    throw new HostnameValidationError();
  }
  return hostname;
}

export function resolvePublicRequestHostname(input: {
  host: string | null | undefined;
  forwardedHost?: string | null;
  trustedProxy: boolean;
}): string {
  const selected = input.trustedProxy && input.forwardedHost
    ? input.forwardedHost
    : input.host;
  if (!selected) throw new HostnameValidationError();
  return normalizePublicHostname(selected);
}

export function managedFallbackSubdomain(
  hostname: string,
  fallbackDomain: string,
): string | null {
  const normalizedHost = normalizePublicHostname(hostname);
  const normalizedBase = normalizePublicHostname(fallbackDomain);
  const suffix = `.${normalizedBase}`;
  if (!normalizedHost.endsWith(suffix)) return null;
  const subdomain = normalizedHost.slice(0, -suffix.length);
  if (!subdomain || subdomain.includes('.')) return null;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain)
    ? subdomain
    : null;
}

export function assertUniqueHostnameAssignments(
  assignments: ReadonlyArray<{ hostname: string; siteReference: string }>,
): void {
  const owners = new Map<string, string>();
  for (const assignment of assignments) {
    const hostname = normalizePublicHostname(assignment.hostname);
    const owner = owners.get(hostname);
    if (owner && owner !== assignment.siteReference) {
      throw new HostnameValidationError('A hostname may belong to only one site.');
    }
    owners.set(hostname, assignment.siteReference);
  }
}

export function normalizePublicPath(pathname: string): string {
  if (!pathname.startsWith('/') || /[\u0000-\u001f\u007f?#\\]/.test(pathname)) {
    throw new HostnameValidationError('The request path is invalid.');
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HostnameValidationError('The request path is invalid.');
  }
  if (decoded.includes('..') || decoded.includes('//')) {
    throw new HostnameValidationError('The request path is invalid.');
  }
  const canonical = decoded.length > 1 && decoded.endsWith('/')
    ? decoded.slice(0, -1)
    : decoded;
  if (canonical !== '/' && !/^\/[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(canonical)) {
    throw new HostnameValidationError('The request path is invalid.');
  }
  return canonical;
}
