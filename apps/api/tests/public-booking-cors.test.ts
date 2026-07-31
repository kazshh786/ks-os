import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createCorsOriginPolicy, splitCorsConfiguration } from '../src/plugins/cors-origin-policy.js';

test('public booking origins inherit the private workspace domain safely', () => {
  const allowed = createCorsOriginPolicy({
    exactOrigins: ['https://app.kasimshah.com'],
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
    exactOrigins: ['https://ks-os-git-main-ksmarketing.vercel.app'],
  });

  assert.equal(allowed('https://ks-os-git-main-ksmarketing.vercel.app'), true);
  assert.equal(allowed('https://another-project.vercel.app'), false);
  assert.equal(allowed('https://vercel.app'), false);
});

test('explicit widget origins and workspace domains are normalised', () => {
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
  assert.equal(allowed('https://ks-agency.kasimshah.com'), true);
  assert.equal(allowed('https://untrusted.example'), false);
});

test('booking POST preflight succeeds for tenant hosts and rejected origins do not become 500 errors', async t => {
  const app = Fastify();
  const allowed = createCorsOriginPolicy({ exactOrigins: ['https://app.kasimshah.com'] });

  await app.register(cors, {
    origin: (origin, callback) => callback(null, allowed(origin)),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    strictPreflight: true,
    maxAge: 600,
  });
  app.post('/api/v1/public/ks-agency/holds', async (_request, reply) => reply.code(201).send({ hold: { id: 'test' } }));
  await app.ready();
  t.after(() => app.close());

  const origin = 'https://ks-agency.kasimshah.com';
  const preflight = await app.inject({
    method: 'OPTIONS',
    url: '/api/v1/public/ks-agency/holds',
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
    url: '/api/v1/public/ks-agency/holds',
    headers: { origin, 'content-type': 'application/json' },
    payload: {},
  });
  assert.equal(post.statusCode, 201);
  assert.equal(post.headers['access-control-allow-origin'], origin);

  const rejected = await app.inject({
    method: 'OPTIONS',
    url: '/api/v1/public/ks-agency/holds',
    headers: {
      origin: 'https://kasimshah.com.evil.example',
      'access-control-request-method': 'POST',
    },
  });
  assert.notEqual(rejected.statusCode, 500);
  assert.equal(rejected.headers['access-control-allow-origin'], undefined);
});
