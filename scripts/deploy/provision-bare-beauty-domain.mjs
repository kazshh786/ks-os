import process from 'node:process';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PRIMARY_ZONE_NAME = 'barebeautykeighley.co.uk';
const PRIMARY_HOSTNAME = PRIMARY_ZONE_NAME;
const WWW_HOSTNAME = `www.${PRIMARY_ZONE_NAME}`;
const LEGACY_HOSTNAME = 'barebeautykeighley.kasimshah.com';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const token = process.env.CLOUDFLARE_API_TOKEN;
const legacyZoneId = process.env.CLOUDFLARE_ZONE_ID?.trim();
const primaryZoneIdOverride = process.env.CLOUDFLARE_BARE_BEAUTY_ZONE_ID?.trim();
const originHost = process.env.SITE_RENDERER_ORIGIN_HOST?.trim().toLowerCase();
const originIp = process.env.SITE_RENDERER_ORIGIN_IP?.trim();

if (!token) throw new Error('Cloudflare domain integration is not configured.');
if (!originHost && !(originIp && isIP(originIp) === 4)) {
  throw new Error('A renderer origin hostname or IPv4 address is required.');
}

const recordType = originHost ? 'CNAME' : 'A';
const recordContent = originHost || originIp;

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

async function resolvePrimaryZoneId() {
  if (primaryZoneIdOverride) return primaryZoneIdOverride;
  const query = new URLSearchParams({ name: PRIMARY_ZONE_NAME, status: 'active', per_page: '50' });
  const zones = await cloudflare(`/zones?${query}`);
  const zone = zones.find(candidate => String(candidate.name).toLowerCase() === PRIMARY_ZONE_NAME);
  if (!zone?.id) {
    throw new Error(
      `Cloudflare zone ${PRIMARY_ZONE_NAME} is not visible to CLOUDFLARE_API_TOKEN. `
      + 'Add the zone to this Cloudflare account/token or set CLOUDFLARE_BARE_BEAUTY_ZONE_ID.',
    );
  }
  return zone.id;
}

async function upsertWebsiteRecord(zoneId, hostname) {
  const query = new URLSearchParams({ name: hostname, per_page: '100' });
  const existing = await cloudflare(`/zones/${encodeURIComponent(zoneId)}/dns_records?${query}`);
  const addressRecords = existing.filter(record => ['A', 'AAAA', 'CNAME'].includes(String(record.type).toUpperCase()));
  const exact = addressRecords.find(record =>
    record.type === recordType
    && String(record.name).toLowerCase() === hostname
    && String(record.content).toLowerCase() === String(recordContent).toLowerCase());

  for (const conflict of addressRecords) {
    if (conflict.id === exact?.id) continue;
    await cloudflare(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(conflict.id)}`, {
      method: 'DELETE',
    });
  }

  const body = JSON.stringify({
    type: recordType,
    name: hostname,
    content: recordContent,
    ttl: 1,
    proxied: true,
    comment: 'Managed by KS OS for Bare Beauty Keighley public site',
  });

  let record = exact;
  if (record?.id) {
    const ready = record.proxied === true
      && record.type === recordType
      && String(record.content).toLowerCase() === String(recordContent).toLowerCase();
    if (!ready) {
      record = await cloudflare(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(record.id)}`, {
        method: 'PATCH',
        body,
      });
    }
  } else {
    record = await cloudflare(`/zones/${encodeURIComponent(zoneId)}/dns_records`, {
      method: 'POST',
      body,
    });
  }

  if (!record?.id || record.proxied !== true) {
    throw new Error(`Cloudflare did not return a healthy proxied DNS record for ${hostname}.`);
  }
  console.log(`Bare Beauty DNS ready: ${hostname} (${recordType}, proxied)`);
}

const primaryZoneId = await resolvePrimaryZoneId();
await upsertWebsiteRecord(primaryZoneId, PRIMARY_HOSTNAME);
await upsertWebsiteRecord(primaryZoneId, WWW_HOSTNAME);

// Keep the original KS OS hostname available while links and caches migrate.
if (legacyZoneId) {
  await upsertWebsiteRecord(legacyZoneId, LEGACY_HOSTNAME);
}
