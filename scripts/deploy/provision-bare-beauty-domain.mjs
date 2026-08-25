import process from 'node:process';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HOSTNAME = 'barebeautykeighley.kasimshah.com';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const token = process.env.CLOUDFLARE_API_TOKEN;
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const originHost = process.env.SITE_RENDERER_ORIGIN_HOST?.trim().toLowerCase();
const originIp = process.env.SITE_RENDERER_ORIGIN_IP?.trim();
if (!token || !zoneId) throw new Error('Cloudflare domain integration is not configured.');
if (!originHost && !(originIp && isIP(originIp) === 4)) {
  throw new Error('A renderer origin hostname or IPv4 address is required.');
}
const type = originHost ? 'CNAME' : 'A';
const content = originHost || originIp;

async function cloudflare(resource, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${resource}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const message = payload.errors?.[0]?.message || `Cloudflare request failed with HTTP ${response.status}.`;
    throw new Error(String(message).slice(0, 500));
  }
  return payload.result;
}

const query = new URLSearchParams({ name: HOSTNAME, per_page: '100' });
const existing = await cloudflare(`/zones/${encodeURIComponent(zoneId)}/dns_records?${query}`);
const exact = existing.find(record => record.type === type && String(record.name).toLowerCase() === HOSTNAME && String(record.content).toLowerCase() === String(content).toLowerCase());
const conflicts = existing.filter(record => record.id !== exact?.id && ['A', 'AAAA', 'CNAME'].includes(String(record.type).toUpperCase()));
if (conflicts.length) throw new Error(`DNS hostname ${HOSTNAME} already has a conflicting address record; refusing to modify it.`);

const body = JSON.stringify({
  type,
  name: HOSTNAME,
  content,
  ttl: 1,
  proxied: true,
  comment: 'Managed by KS OS for Bare Beauty Keighley public site',
});
let record = exact;
if (record?.id) {
  const ready = record.proxied === true && record.type === type && String(record.content).toLowerCase() === String(content).toLowerCase();
  if (!ready) {
    record = await cloudflare(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(record.id)}`, { method: 'PATCH', body });
  }
} else {
  record = await cloudflare(`/zones/${encodeURIComponent(zoneId)}/dns_records`, { method: 'POST', body });
}
if (!record?.id || record.proxied !== true) throw new Error('Cloudflare did not return a healthy proxied DNS record.');
console.log(`Bare Beauty DNS ready: ${HOSTNAME} (${type}, proxied)`);
