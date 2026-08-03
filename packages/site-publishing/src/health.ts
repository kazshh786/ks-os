import { isIP } from 'node:net';
import { promises as dns } from 'node:dns';
import { normalizeCustomHostname } from './hostname.js';

function privateIp(address: string): boolean {
  if (address === '::1' || address === '0:0:0:0:0:0:0:1') return true;
  if (address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) return true;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

export function controlledHealthUrl(input: {
  hostname: string;
  path: '/' | '/book';
  ownedHostnames: readonly string[];
}): URL {
  const hostname = normalizeCustomHostname(input.hostname);
  if (!input.ownedHostnames.map(normalizeCustomHostname).includes(hostname)) {
    throw new Error('HEALTH_HOST_NOT_OWNED');
  }
  return new URL(`https://${hostname}${input.path}`);
}

export async function assertPublicHealthTarget(
  hostname: string,
  lookup: typeof dns.lookup = dns.lookup,
): Promise<void> {
  const normalized = normalizeCustomHostname(hostname);
  if (isIP(normalized)) throw new Error('HEALTH_IP_FORBIDDEN');
  const addresses = await lookup(normalized, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(result => privateIp(result.address))) {
    throw new Error('HEALTH_PRIVATE_ADDRESS_FORBIDDEN');
  }
}

export function validateHealthRedirect(input: {
  from: URL;
  to: URL;
  ownedHostnames: readonly string[];
  redirectCount: number;
  maximumRedirects: number;
}): void {
  if (input.redirectCount >= input.maximumRedirects) throw new Error('HEALTH_REDIRECT_LIMIT');
  if (input.to.protocol !== 'https:') throw new Error('HEALTH_REDIRECT_PROTOCOL');
  const target = normalizeCustomHostname(input.to.hostname);
  if (!input.ownedHostnames.map(normalizeCustomHostname).includes(target)) {
    throw new Error('HEALTH_REDIRECT_NOT_OWNED');
  }
  if (input.from.toString() === input.to.toString()) throw new Error('HEALTH_REDIRECT_LOOP');
}

export function boundedHealthEvidence(input: {
  status: number;
  contentType: string | null;
  body: Uint8Array;
  maximumBytes: number;
}) {
  if (input.body.byteLength > input.maximumBytes) throw new Error('HEALTH_RESPONSE_TOO_LARGE');
  return {
    status: input.status,
    contentType: input.contentType?.slice(0, 120) ?? null,
    byteLength: input.body.byteLength,
  };
}
