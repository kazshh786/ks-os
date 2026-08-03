import assert from 'node:assert/strict';
import test from 'node:test';
import { CloudflareSiteDomainProvider } from '../src/modules/sites/domain-providers/cloudflare-site-domain-provider.js';

const environment = {
  CLOUDFLARE_API_TOKEN: 'secret-provider-token',
  CLOUDFLARE_ZONE_ID: 'zone-reference',
  SITE_RENDERER_ORIGIN_HOST: 'origin.sites.kasimshah.com',
};

const envelope = (result: unknown, status = 200) => new Response(
  JSON.stringify({ success: status < 400, result }),
  { status, headers: { 'content-type': 'application/json' } },
);

test('Cloudflare prepares an exact proxied renderer record without exposing credentials', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const request = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (!init?.method) return envelope([]);
    return envelope({ id: 'dns-record-1', type: 'CNAME', name: 'playground.kasimshah.com', content: 'origin.sites.kasimshah.com', ttl: 1, proxied: true });
  };
  const prepared = await new CloudflareSiteDomainProvider(environment, request as typeof fetch)
    .prepare({ hostname: 'playground.kasimshah.com' });
  assert.equal(prepared.providerSafeReference, 'dns-record-1');
  assert.equal(prepared.dnsRecords[0]?.proxied, true);
  assert.equal(prepared.dnsRecords[0]?.managedByKsOs, true);
  const write = calls.find(call => call.init?.method === 'POST');
  assert.ok(write);
  assert.equal(JSON.parse(String(write.init?.body)).proxied, true);
  assert.doesNotMatch(JSON.stringify(prepared), /secret-provider-token/);
});

test('Cloudflare refuses conflicting address records and performs no write', async () => {
  const methods: string[] = [];
  const request = async (_url: string | URL | Request, init?: RequestInit) => {
    methods.push(init?.method || 'GET');
    return envelope([{ id: 'foreign', type: 'A', name: 'playground.kasimshah.com', content: '203.0.113.10', proxied: false }]);
  };
  const provider = new CloudflareSiteDomainProvider(environment, request as typeof fetch);
  await assert.rejects(
    provider.prepare({ hostname: 'playground.kasimshah.com' }),
    (error: { code?: string }) => error.code === 'CLOUDFLARE_HOSTNAME_CONFLICT',
  );
  assert.deepEqual(methods, ['GET']);
});

test('Cloudflare reuses an exact tracked record idempotently', async () => {
  const methods: string[] = [];
  const record = { id: 'tracked', type: 'CNAME', name: 'playground.kasimshah.com', content: 'origin.sites.kasimshah.com', ttl: 1, proxied: true };
  const request = async (_url: string | URL | Request, init?: RequestInit) => {
    methods.push(init?.method || 'GET');
    return envelope([record]);
  };
  const prepared = await new CloudflareSiteDomainProvider(environment, request as typeof fetch)
    .prepare({ hostname: 'playground.kasimshah.com', existingProviderSafeReference: 'tracked' });
  assert.equal(prepared.providerSafeReference, 'tracked');
  assert.deepEqual(methods, ['GET']);
});
