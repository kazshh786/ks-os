import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  createCorsOriginAuthorizer,
  createCorsOriginPolicy,
  normaliseForwardedHostname,
  splitCorsConfiguration,
} from '../src/plugins/cors-origin-policy.js';

test('public booking origins inherit the private workspace domain safely', () => {
  const allowed = createCorsOriginPolicy({
    workspaceOrigins: ['https://app.kasimshah.com'],
  });

  assert.equal(allowed('https://app.kasimshah.com'), true);
  assert.equal(allowed('https://booking.kasimshah.com'), true);
  assert.equal(allowed('https://ks-agency.kasimshah.com'), true);
  assert.equal(allowed('https://barebeautykeighley.kasimshah.com'), true);

  assert.equal(allowed('http://ks-agency.kasimshah.com'), false);
  assert.equal(allowed('https://kasimshah.com.evil.example'), false);
  assert.equal(allowed('https://evilkasimshah.com'), false);
  assert.equal(allowed('javascript:alert(1)'), false);
});

test('shared deployment hosts are exact-only and never become wildcard domains', () => {
  const allowed = createCorsOriginPolicy({
    workspaceOrigins: ['https://ks-os-git-main-ksmarketing.vercel.app'],
  });

  assert.equal(allowed('https://ks-os-git-main-ksmarketing.vercel.app'), true);
  assert.equal(allowed('https://another-project.vercel.app'), false);
  assert.equal(allowed('https://vercel.app'), false);
});

test('explicit widget origins remain exact while workspace domains are normalised', () => {
  assert.deepEqual(splitCorsConfiguration(' https://one.example ,https://two.example, '), [
    'https://one.example',
    'https://two.example',
  ]);

  const allowed = createCorsOriginPolicy({
    exactOrigins: splitCorsConfiguration('https://partner.example'),
    workspaceDomains: ['kasimshah.com'],
    inferWorkspaceDomains: false,
  });

  assert.equal(allowed('https://partner.example'), true);
  assert.equal(allowed('https://child.partner.example'), false);
  assert.equal(allowed('https://ks-agency.kasimshah.com'), true);
  assert.equal(allowed('https://untrusted.example'), false);
});

test('verified client domains are authorised dynamically and cached by hostname', async () => {
  let lookups = 0;
  const allowed = createCorsOriginAuthorizer({
    workspaceOrigins: ['https://app.kasimshah.com'],
    cacheTtlMs: 60_000,
    verifyCustomDomain: async hostname => {
      lookups += 1;
      return hostname === 'book.clientbusiness.co.uk';
    },
  });

  assert.equal(await allowed('https://book.clientbusiness.co.uk'), true);
  assert.equal(await allowed('https://book.clientbusiness.co.uk'), true);
  assert.equal(lookups, 1);
  assert.equal(await allowed('https://unverified-client.co.uk'), false);
  assert.equal(await allowed('http://book.clientbusiness.co.uk'), false);
  assert.equal(await allowed('https://book.clientbusiness.co.uk.evil.example'), false);
});

test('forwarded booking hosts are normalised without accepting malformed values', () => {
  assert.equal(normaliseForwardedHostname('book.clientbusiness.co.uk:443'), 'book.clientbusiness.co.uk');
  assert.equal(normaliseForwardedHostname('book.clientbusiness.co.uk, api.internal.example'), 'book.clientbusiness.co.uk');
  assert.equal(normaliseForwardedHostname(['https://book.clientbusiness.co.uk']), 'book.clientbusiness.co.uk');
  assert.equal(normaliseForwardedHostname('javascript:alert(1)'), null);
});

test('booking POST preflight succeeds for verified custom domains and rejected origins do not become 500 errors', async t => {
  const app = Fastify();
  const allowed = createCorsOriginAuthorizer({
    workspaceOrigins: ['https://app.kasimshah.com'],
    verifyCustomDomain: async hostname => hostname === 'book.clientbusiness.co.uk',
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      void allowed(origin).then(result => callback(null, result)).catch(() => callback(null, false));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    strictPreflight: true,
    maxAge: 600,
  });
  app.post('/api/v1/public/custom-domain/holds', async (_request, reply) => reply.code(201).send({ hold: { id: 'test' } }));
  await app.ready();
  t.after(() => app.close());

  const origin = 'https://book.clientbusiness.co.uk';
  const preflight = await app.inject({
    method: 'OPTIONS',
    url: '/api/v1/public/custom-domain/holds',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], origin);

  const post = await app.inject({
    method: 'POST',
    url: '/api/v1/public/custom-domain/holds',
    headers: { origin, 'content-type': 'application/json' },
    payload: {},
  });
  assert.equal(post.statusCode, 201);
  assert.equal(post.headers['access-control-allow-origin'], origin);

  const rejected = await app.inject({
    method: 'OPTIONS',
    url: '/api/v1/public/custom-domain/holds',
    headers: {
      origin: 'https://book.clientbusiness.co.uk.evil.example',
      'access-control-request-method': 'POST',
    },
  });
  assert.notEqual(rejected.statusCode, 500);
  assert.equal(rejected.headers['access-control-allow-origin'], undefined);
});
