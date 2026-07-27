import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicationReadinessResult } from '@ks-os/site-quality';
import {
  CreateSitePublicationPayloadSchema,
  DisabledCloudflareDnsProvider,
  DisabledVercelSiteDomainProvider,
  DnsRecordSchema,
  FakeCloudflareDnsProvider,
  FakeVercelSiteDomainProvider,
  PublicationReasonSchema,
  PublicationStatusSchema,
  SiteDomainStatusSchema,
  assertManagedDnsDeletion,
  assertPublicationReady,
  boundedHealthEvidence,
  cacheInvalidationKey,
  canTransitionDomain,
  canTransitionPublication,
  classifyDnsRecord,
  controlledHealthUrl,
  fallbackHostname,
  hostnameCacheKey,
  normalizeCustomHostname,
  normalizeFallbackLabel,
  publicationIdempotencyKey,
  validateHealthRedirect,
  websiteDnsRecord,
  type PublicationPin,
  type WarningAcknowledgement,
} from '../src/index.js';

const reference = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const digest = (character: string) => character.repeat(64);
const pin: PublicationPin = {
  siteReference: reference('1'),
  siteVersionReference: reference('2'),
  siteVersionDigestSha256: digest('a'),
  qualityRunReference: reference('3'),
  qualityPolicyVersion: '2026-07-27',
  knowledgePackReference: reference('4'),
  knowledgePackSemanticVersion: '1.0.0',
  knowledgePackDigestSha256: digest('b'),
  templateVersionReference: reference('5'),
  rendererVersion: 'sites-1',
  snapshotSchemaVersion: 1,
};

test('controlled publication enums reject unknown values', () => {
  assert.equal(PublicationReasonSchema.safeParse('UNKNOWN').success, false);
  assert.equal(PublicationStatusSchema.safeParse('UNKNOWN').success, false);
  assert.equal(SiteDomainStatusSchema.safeParse('UNKNOWN').success, false);
});

test('publication payload is strict and excludes server-owned fields', () => {
  const valid = {
    jobType: 'CREATE_SITE_PUBLICATION',
    siteReference: pin.siteReference,
    siteVersionReference: pin.siteVersionReference,
    qualityRunReference: pin.qualityRunReference,
    publicationRunReference: reference('6'),
    requestedByAgencyUserReference: reference('7'),
    reason: 'INITIAL_PUBLICATION',
    acknowledgeWarnings: false,
  };
  assert.equal(CreateSitePublicationPayloadSchema.safeParse(valid).success, true);
  assert.equal(CreateSitePublicationPayloadSchema.safeParse({
    ...valid,
    snapshotJson: {},
  }).success, false);
  assert.equal(CreateSitePublicationPayloadSchema.safeParse({
    ...valid,
    providerToken: 'secret',
  }).success, false);
});

test('custom hostnames normalize to safe ASCII', () => {
  assert.equal(normalizeCustomHostname('WWW.Example.COM'), 'www.example.com');
  assert.equal(normalizeCustomHostname('münich.example'), 'xn--mnich-kva.example');
});

for (const unsafe of [
  'https://example.com',
  'example.com/path',
  '*.example.com',
  '127.0.0.1',
  '::1',
  'localhost',
  'example.com:443',
]) {
  test(`unsafe custom hostname is rejected: ${unsafe}`, () => {
    assert.throws(() => normalizeCustomHostname(unsafe));
  });
}

test('fallback labels and hostnames are controlled', () => {
  assert.equal(normalizeFallbackLabel('My-Salon'), 'my-salon');
  assert.equal(fallbackHostname('my-salon', 'sites.kasimshah.com'), 'my-salon.sites.kasimshah.com');
  assert.throws(() => normalizeFallbackLabel('booking'));
  assert.throws(() => normalizeFallbackLabel('-unsafe'));
});

test('hostname cache keys are tenant scoped', () => {
  const left = hostnameCacheKey(reference('1'), 'a.example.com');
  const right = hostnameCacheKey(reference('2'), 'a.example.com');
  assert.notEqual(left, right);
});

test('publication lifecycle permits only controlled forward movement', () => {
  assert.equal(canTransitionPublication('REQUESTED', 'VALIDATING'), true);
  assert.equal(canTransitionPublication('REQUESTED', 'LIVE'), false);
  assert.equal(canTransitionPublication('LIVE', 'ROLLING_BACK'), true);
});

test('domain lifecycle prevents unverified activation', () => {
  assert.equal(canTransitionDomain('VERIFYING', 'ACTIVE'), false);
  assert.equal(canTransitionDomain('ACTIVATING', 'ACTIVE'), true);
  assert.equal(canTransitionDomain('REMOVED', 'ACTIVE'), false);
});

function readiness(
  status: PublicationReadinessResult['status'],
): PublicationReadinessResult {
  return {
    ready: status !== 'BLOCKED',
    status,
    qualityRunReference: pin.qualityRunReference,
    siteVersionDigest: pin.siteVersionDigestSha256,
    agencyApprovalStatus: 'CURRENT',
    clientApprovalStatus: 'CURRENT',
    approvalFreshness: 'CURRENT',
    qualityPolicyVersion: pin.qualityPolicyVersion,
    knowledgePackVersion: pin.knowledgePackSemanticVersion,
    openBlockingCount: 0,
    openWarningCount: status === 'READY_WITH_WARNINGS' ? 1 : 0,
    nonWaivableCount: 0,
    waivedCount: 0,
    staleWaiverCount: 0,
    unresolvedReviewCount: 0,
    unresolvedFactCount: 0,
    bookingIntegrityStatus: 'READY',
    accessibilityStatus: 'READY',
    seoStatus: 'READY',
    performanceStatus: 'READY',
    contentIntegrityStatus: 'READY',
    assetReadinessStatus: 'READY',
    blockingReasons: status === 'BLOCKED'
      ? [{ code: 'OPEN_BLOCKING_FINDING', message: 'blocked' }]
      : [],
    warnings: status === 'READY_WITH_WARNINGS' ? ['warning'] : [],
    evaluatedAt: new Date(),
  };
}

test('blocked readiness cannot publish', () => {
  assert.throws(() => assertPublicationReady({
    readiness: readiness('BLOCKED'),
    expectedDigestSha256: pin.siteVersionDigestSha256,
    expectedQualityRunReference: pin.qualityRunReference,
  }), /OPEN_BLOCKING_FINDING/);
});

test('exact ready result can publish', () => {
  assert.doesNotThrow(() => assertPublicationReady({
    readiness: readiness('READY'),
    expectedDigestSha256: pin.siteVersionDigestSha256,
    expectedQualityRunReference: pin.qualityRunReference,
  }));
});

test('digest and quality-run mismatches fail closed', () => {
  assert.throws(() => assertPublicationReady({
    readiness: readiness('READY'),
    expectedDigestSha256: digest('c'),
    expectedQualityRunReference: pin.qualityRunReference,
  }), /exact requested version/);
});

test('warnings require exact digest-bound acknowledgement', () => {
  const acknowledgement: WarningAcknowledgement = {
    siteVersionDigestSha256: pin.siteVersionDigestSha256,
    qualityRunReference: pin.qualityRunReference,
    acknowledgedByAgencyUserReference: reference('7'),
    acknowledgedAt: new Date().toISOString(),
    warningCodes: ['PERFORMANCE_WARNING'],
  };
  assert.throws(() => assertPublicationReady({
    readiness: readiness('READY_WITH_WARNINGS'),
    expectedDigestSha256: pin.siteVersionDigestSha256,
    expectedQualityRunReference: pin.qualityRunReference,
  }));
  assert.doesNotThrow(() => assertPublicationReady({
    readiness: readiness('READY_WITH_WARNINGS'),
    expectedDigestSha256: pin.siteVersionDigestSha256,
    expectedQualityRunReference: pin.qualityRunReference,
    acknowledgement,
  }));
  assert.throws(() => assertPublicationReady({
    readiness: readiness('READY_WITH_WARNINGS'),
    expectedDigestSha256: digest('c'),
    expectedQualityRunReference: pin.qualityRunReference,
    acknowledgement,
  }));
});

test('publication identity pins all governance inputs', () => {
  const first = publicationIdempotencyKey({
    tenantReference: reference('8'),
    pin,
    reason: 'INITIAL_PUBLICATION',
  });
  const repeated = publicationIdempotencyKey({
    tenantReference: reference('8'),
    pin,
    reason: 'INITIAL_PUBLICATION',
  });
  const changed = publicationIdempotencyKey({
    tenantReference: reference('8'),
    pin: { ...pin, siteVersionDigestSha256: digest('c') },
    reason: 'INITIAL_PUBLICATION',
  });
  assert.equal(first, repeated);
  assert.notEqual(first, changed);
});

test('cache invalidation identity is site, tenant, snapshot and pointer scoped', () => {
  const first = cacheInvalidationKey({
    tenantReference: reference('8'),
    siteReference: pin.siteReference,
    snapshotReference: reference('9'),
    pointerVersion: 1,
  });
  const repeated = cacheInvalidationKey({
    tenantReference: reference('8'),
    siteReference: pin.siteReference,
    snapshotReference: reference('9'),
    pointerVersion: 1,
  });
  assert.equal(first, repeated);
  assert.notEqual(first, cacheInvalidationKey({
    tenantReference: reference('8'),
    siteReference: pin.siteReference,
    snapshotReference: reference('9'),
    pointerVersion: 2,
  }));
});

test('DNS records are not accepted implicitly and sensitive records are protected', () => {
  const mx = DnsRecordSchema.parse({
    type: 'MX', name: 'example.com', content: 'mail.example.com', ttl: 300,
  });
  assert.deepEqual(classifyDnsRecord(mx, 'example.com'), {
    classification: 'EMAIL',
    protected: true,
  });
  for (const record of [
    { type: 'TXT', name: 'example.com', content: 'v=spf1 include:mail.example -all' },
    { type: 'TXT', name: '_dmarc.example.com', content: 'v=DMARC1; p=reject' },
    { type: 'TXT', name: 'selector._domainkey.example.com', content: 'v=DKIM1; p=abc' },
    { type: 'CAA', name: 'example.com', content: '0 issue letsencrypt.org' },
    { type: 'SRV', name: '_sip._tcp.example.com', content: '1 1 443 sip.example.com' },
  ] as const) {
    const parsed = DnsRecordSchema.parse({ ...record, ttl: 300 });
    assert.equal(classifyDnsRecord(parsed, 'example.com').protected, true);
  }
});

test('conflicting apex and www records require review', () => {
  for (const name of ['example.com', 'www.example.com']) {
    const record = DnsRecordSchema.parse({
      type: 'A', name, content: '203.0.113.10', ttl: 300,
    });
    assert.equal(
      classifyDnsRecord(record, 'example.com').classification,
      'CONFLICT_REVIEW_REQUIRED',
    );
  }
});

test('managed website records are DNS-only and only managed records can be deleted', () => {
  const managed = websiteDnsRecord({
    type: 'CNAME',
    name: 'www.example.com',
    content: 'project-specific.example.test',
    ttl: 300,
  });
  assert.equal(managed.proxied, false);
  assert.equal(managed.managedByKsOs, true);
  assert.doesNotThrow(() => assertManagedDnsDeletion(managed));
  assert.throws(() => assertManagedDnsDeletion({ ...managed, managedByKsOs: false }));
});

test('provider-disabled mode fails closed', async () => {
  await assert.rejects(
    new DisabledCloudflareDnsProvider().createOrReuseZone('example.com', 'key'),
    /disabled/,
  );
  await assert.rejects(
    new DisabledVercelSiteDomainProvider().attachToSharedSitesProject('example.com', 'key'),
    /disabled/,
  );
});

test('fake providers are deterministic and create no per-tenant project', async () => {
  const cloudflare = new FakeCloudflareDnsProvider();
  const firstZone = await cloudflare.createOrReuseZone('example.com', 'same');
  const secondZone = await cloudflare.createOrReuseZone('example.com', 'same');
  assert.deepEqual(firstZone, secondZone);
  const vercel = new FakeVercelSiteDomainProvider();
  const firstDomain = await vercel.attachToSharedSitesProject('example.com', 'same');
  const secondDomain = await vercel.attachToSharedSitesProject('example.com', 'same');
  assert.deepEqual(firstDomain, secondDomain);
  assert.equal('createProject' in vercel, false);
});

test('health checks accept only owned HTTPS hostnames and controlled paths', () => {
  assert.equal(controlledHealthUrl({
    hostname: 'www.example.com',
    path: '/book',
    ownedHostnames: ['www.example.com'],
  }).toString(), 'https://www.example.com/book');
  assert.throws(() => controlledHealthUrl({
    hostname: 'attacker.example',
    path: '/',
    ownedHostnames: ['www.example.com'],
  }));
});

test('health redirects reject off-site, downgrade, loops and excess redirects', () => {
  const base = {
    from: new URL('https://www.example.com/'),
    ownedHostnames: ['www.example.com', 'example.com'],
    redirectCount: 0,
    maximumRedirects: 3,
  };
  assert.doesNotThrow(() => validateHealthRedirect({
    ...base,
    to: new URL('https://example.com/'),
  }));
  assert.throws(() => validateHealthRedirect({
    ...base,
    to: new URL('https://attacker.example/'),
  }));
  assert.throws(() => validateHealthRedirect({
    ...base,
    to: new URL('http://example.com/'),
  }));
  assert.throws(() => validateHealthRedirect({
    ...base,
    to: base.from,
  }));
  assert.throws(() => validateHealthRedirect({
    ...base,
    to: new URL('https://example.com/'),
    redirectCount: 3,
  }));
});

test('health evidence is bounded', () => {
  assert.deepEqual(boundedHealthEvidence({
    status: 200,
    contentType: 'text/html',
    body: new Uint8Array(10),
    maximumBytes: 10,
  }), { status: 200, contentType: 'text/html', byteLength: 10 });
  assert.throws(() => boundedHealthEvidence({
    status: 200,
    contentType: 'text/html',
    body: new Uint8Array(11),
    maximumBytes: 10,
  }));
});
