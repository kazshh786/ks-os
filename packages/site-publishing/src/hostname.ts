import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

export const RESERVED_FALLBACK_LABELS = Object.freeze(new Set([
  'admin', 'api', 'app', 'assets', 'auth', 'billing', 'booking', 'cdn',
  'dashboard', 'help', 'localhost', 'mail', 'preview', 'static', 'status',
  'support', 'www',
]));

export class PublicationHostnameError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PublicationHostnameError';
    this.code = code;
  }
}

export function normalizeCustomHostname(input: string): string {
  if (!input || input !== input.trim() || input.length > 320) {
    throw new PublicationHostnameError('DOMAIN_INVALID', 'The hostname is invalid.');
  }
  if (
    input.includes('://')
    || /[/?#@\\\s:*]/.test(input)
    || input.startsWith('.')
    || input.endsWith('.')
  ) {
    throw new PublicationHostnameError('DOMAIN_INVALID', 'Enter a hostname without a protocol, path, port or wildcard.');
  }
  const hostname = domainToASCII(input.toLowerCase());
  if (!hostname || hostname.length > 253 || hostname === 'localhost' || isIP(hostname)) {
    throw new PublicationHostnameError('DOMAIN_UNSAFE', 'IP addresses and local hostnames are not allowed.');
  }
  const labels = hostname.split('.');
  if (
    labels.length < 2
    || labels.some(label =>
      !label
      || label.length > 63
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  ) {
    throw new PublicationHostnameError('DOMAIN_INVALID', 'The hostname is invalid.');
  }
  return hostname;
}

export function normalizeFallbackLabel(input: string): string {
  const label = input.trim().toLowerCase();
  if (
    label.length < 2
    || label.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ) {
    throw new PublicationHostnameError('FALLBACK_LABEL_INVALID', 'The fallback label is invalid.');
  }
  if (RESERVED_FALLBACK_LABELS.has(label)) {
    throw new PublicationHostnameError('FALLBACK_LABEL_RESERVED', 'The fallback label is reserved.');
  }
  return label;
}

export function fallbackHostname(label: string, baseDomain: string): string {
  return `${normalizeFallbackLabel(label)}.${normalizeCustomHostname(baseDomain)}`;
}

export function hostnameCacheKey(tenantReference: string, hostname: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(tenantReference)) {
    throw new PublicationHostnameError('TENANT_REFERENCE_INVALID', 'A public tenant reference is required.');
  }
  return `site-host:${tenantReference.toLowerCase()}:${normalizeCustomHostname(hostname)}`;
}
