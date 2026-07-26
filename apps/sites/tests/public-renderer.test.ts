import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { SiteStatus } from '@ks-os/contracts';
import {
  SiteActionSchema,
  SiteAssetReferenceSchema,
  PublishedPageSnapshotSchema,
  PublishedSiteSnapshotSchema,
  validatePublishedSnapshot,
  type PublishedSiteSnapshot,
} from '@ks-os/site-schema';
import {
  createOriginalInternalSiteFixture,
  getSiteLayoutRenderer,
  hasSiteLayoutRenderer,
  listRegisteredSiteRenderers,
  ORIGINAL_INTERNAL_TEMPLATE_DEFINITION,
} from '@ks-os/site-templates';
import {
  assertUniqueHostnameAssignments,
  HostnameValidationError,
  normalizePublicHostname,
  resolvePublicRequestHostname,
} from '../src/lib/hostname.js';
import type { SitesRuntimeConfig } from '../src/lib/config.js';
import {
  signSitePreviewToken,
  verifySitePreviewToken,
} from '../src/lib/preview-token.js';
import type {
  PublicSiteRepository,
  ResolvedPublicSite,
} from '../src/lib/repository.js';
import {
  handleBookingRequest,
  handleHealthRequest,
  handlePreviewRequest,
  handlePublicPageRequest,
  handleRobotsRequest,
  handleSitemapRequest,
} from '../src/lib/runtime.js';
import {
  generateSiteStructuredData,
  generateTenantRobots,
  generateTenantSitemap,
  serializeStructuredData,
} from '../src/lib/seo.js';

const fallbackHostname = 'northlight.sites.kasimshah.com';
const baseSnapshot = createOriginalInternalSiteFixture();
const previewSecret = 'phase-15-5-test-preview-secret-value-0001';
const config: SitesRuntimeConfig = {
  nodeEnv: 'test',
  fallbackDomain: 'sites.kasimshah.com',
  publicBookingOrigin: 'https://book.kasimshah.com',
  previewTokenSecret: previewSecret,
  trustedProxy: false,
  releaseVersion: 'test-release',
};

function request(hostname: string, path = '/') {
  return new Request(`https://${hostname}${path}`, {
    headers: { host: hostname },
  });
}

function mutateSnapshot(
  source: PublishedSiteSnapshot,
  mutate: (draft: PublishedSiteSnapshot) => void,
) {
  const draft = structuredClone(source);
  mutate(draft);
  return validatePublishedSnapshot(draft);
}

function previewSnapshot() {
  return mutateSnapshot(baseSnapshot, (draft) => {
    draft.visibility = 'PREVIEW';
    draft.siteStatus = 'DRAFT';
    draft.versionStatus = 'DRAFT';
    draft.publishedAt = null;
  });
}

class MemoryPublicSiteRepository implements PublicSiteRepository {
  readonly hosts = new Map<string, ResolvedPublicSite>();
  readonly published = new Map<string, PublishedSiteSnapshot>();
  readonly previews = new Map<string, PublishedSiteSnapshot>();
  readonly revoked = new Set<string>();
  reviewSessionValidator?: (
    input: Parameters<NonNullable<PublicSiteRepository['isReviewPreviewSessionActive']>>[0],
  ) => boolean | Promise<boolean>;

  constructor(snapshot?: PublishedSiteSnapshot, status: SiteStatus = 'LIVE') {
    if (!snapshot) return;
    this.published.set(snapshot.siteReference, snapshot);
    for (const domain of snapshot.domains) {
      this.hosts.set(domain.hostname, {
        siteReference: snapshot.siteReference,
        siteStatus: status,
        matchedHostname: domain.hostname,
        matchKind: domain.kind === 'CUSTOM' ? 'CUSTOM' : 'FALLBACK',
        domainStatus: domain.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
      });
    }
  }

  addHost(hostname: string, input: Partial<ResolvedPublicSite> = {}) {
    this.hosts.set(hostname, {
      siteReference: input.siteReference ?? baseSnapshot.siteReference,
      siteStatus: input.siteStatus ?? 'LIVE',
      matchedHostname: hostname,
      matchKind: input.matchKind ?? 'CUSTOM',
      domainStatus: input.domainStatus ?? 'ACTIVE',
    });
  }

  addPreview(snapshot: PublishedSiteSnapshot) {
    this.previews.set(
      `${snapshot.siteReference}:${snapshot.versionReference}`,
      snapshot,
    );
  }

  async resolveHostname(hostname: string) {
    return this.hosts.get(hostname) ?? null;
  }

  async loadPublishedSnapshot(siteReference: string) {
    return this.published.get(siteReference) ?? null;
  }

  async loadPreviewSnapshot(siteReference: string, versionReference: string) {
    return this.previews.get(`${siteReference}:${versionReference}`) ?? null;
  }

  async isPreviewTokenRevoked(input: { jti: string }) {
    return this.revoked.has(input.jti);
  }

  async isReviewPreviewSessionActive(
    input: Parameters<NonNullable<PublicSiteRepository['isReviewPreviewSessionActive']>>[0],
  ) {
    return this.reviewSessionValidator?.(input) ?? false;
  }
}

function repoFor(
  snapshot: PublishedSiteSnapshot = baseSnapshot,
  status: SiteStatus = 'LIVE',
) {
  return new MemoryPublicSiteRepository(snapshot, status);
}

function customDomainSnapshot() {
  return mutateSnapshot(baseSnapshot, (draft) => {
    draft.domains[0]!.primary = false;
    draft.domains.push({
      hostname: 'www.northlight.example',
      kind: 'CUSTOM',
      status: 'ACTIVE',
      primary: true,
    });
    draft.canonicalHostname = 'www.northlight.example';
  });
}

function differentTenantSnapshot() {
  const fixture = createOriginalInternalSiteFixture({
    hostname: 'riverstone.sites.kasimshah.com',
    siteReference: '20000000-0000-4000-8000-000000000002',
    versionReference: '20000000-0000-4000-8000-000000000003',
    tenantSubdomain: 'riverstone',
    businessName: 'Riverstone Studio',
  });
  return validatePublishedSnapshot(
    JSON.parse(
      JSON.stringify(fixture)
        .replaceAll('Northlight Studio', 'Riverstone Studio')
        .replaceAll('northlight', 'riverstone'),
    ),
  );
}

async function publicPage(
  repository: PublicSiteRepository = repoFor(),
  hostname = fallbackHostname,
  path = '/',
  runtimeConfig: SitesRuntimeConfig = config,
) {
  return handlePublicPageRequest({
    request: request(hostname, path),
    repository,
    config: runtimeConfig,
  });
}

// 1
test('apps/sites defines the Astro SSR build command', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { scripts: { build: string }; dependencies: Record<string, string> };
  assert.equal(packageJson.scripts.build, 'astro build');
  assert.ok(packageJson.dependencies.astro);
  assert.ok(packageJson.dependencies['@astrojs/node']);
});

// 2
test('a managed fallback subdomain resolves the correct site', async () => {
  assert.equal((await publicPage()).status, 200);
});

// 3
test('an active custom hostname resolves the correct site', async () => {
  const snapshot = customDomainSnapshot();
  assert.equal(
    (await publicPage(repoFor(snapshot), 'www.northlight.example')).status,
    200,
  );
});

// 4
test('an unknown hostname does not resolve a tenant', async () => {
  assert.equal(
    (await publicPage(repoFor(), 'unknown.sites.kasimshah.com')).status,
    404,
  );
});

// 5
test('hostname matching is case-insensitive', async () => {
  assert.equal(normalizePublicHostname('NORTHLIGHT.SITES.KASIMSHAH.COM'), fallbackHostname);
});

// 6
test('a hostname with a valid port is normalised', () => {
  assert.equal(
    normalizePublicHostname('northlight.sites.kasimshah.com:4321'),
    fallbackHostname,
  );
});

// 7
test('invalid hostname syntax is rejected', () => {
  assert.throws(() => normalizePublicHostname('bad..example.com'), HostnameValidationError);
});

// 8
test('control characters in a hostname are rejected', () => {
  assert.throws(
    () => normalizePublicHostname('good.example.com\u0000.evil.example'),
    HostnameValidationError,
  );
});

// 9
test('an untrusted forwarded hostname is ignored', () => {
  assert.equal(resolvePublicRequestHostname({
    host: fallbackHostname,
    forwardedHost: 'evil.example',
    trustedProxy: false,
  }), fallbackHostname);
});

// 10
test('a trusted forwarded hostname is normalised and used', () => {
  assert.equal(resolvePublicRequestHostname({
    host: 'internal.local',
    forwardedHost: 'WWW.NORTHLIGHT.EXAMPLE:443',
    trustedProxy: true,
  }), 'www.northlight.example');
});

// 11
test('Tenant A hostname cannot render Tenant B content', async () => {
  const repository = repoFor();
  repository.published.set(baseSnapshot.siteReference, differentTenantSnapshot());
  const response = await publicPage(repository);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /Riverstone Studio/);
});

// 12
test('duplicate hostname assignment to different sites is rejected', () => {
  assert.throws(() => assertUniqueHostnameAssignments([
    { hostname: 'www.example.com', siteReference: baseSnapshot.siteReference },
    { hostname: 'WWW.EXAMPLE.COM', siteReference: differentTenantSnapshot().siteReference },
  ]), HostnameValidationError);
});

// 13
test('only ACTIVE domains render normally', async () => {
  assert.equal((await publicPage()).status, 200);
});

// 14
test('FAILED domains do not render as live', async () => {
  const repository = repoFor();
  repository.addHost('failed.example', { domainStatus: 'INACTIVE' });
  assert.equal((await publicPage(repository, 'failed.example')).status, 404);
});

// 15
test('REMOVED domains do not render as live', async () => {
  const repository = repoFor();
  repository.addHost('removed.example', { domainStatus: 'INACTIVE' });
  assert.equal((await publicPage(repository, 'removed.example')).status, 404);
});

// 16
test('a LIVE site renders its immutable published snapshot', async () => {
  const response = await publicPage(repoFor(baseSnapshot, 'LIVE'));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Northlight Studio/);
});

// 17
test('a DRAFT site is not publicly available', async () => {
  assert.equal((await publicPage(repoFor(baseSnapshot, 'DRAFT'))).status, 404);
});

// 18
test('a CLIENT_REVIEW version is not publicly available', async () => {
  const repository = repoFor();
  repository.published.clear();
  assert.equal((await publicPage(repository)).status, 503);
});

// 19
test('PUBLISHING continues serving the prior published snapshot', async () => {
  assert.equal((await publicPage(repoFor(baseSnapshot, 'PUBLISHING'))).status, 200);
});

// 20
test('PUBLISH_FAILED continues serving the prior published snapshot', async () => {
  assert.equal((await publicPage(repoFor(baseSnapshot, 'PUBLISH_FAILED'))).status, 200);
});

// 21
test('SUSPENDED returns controlled unavailable output', async () => {
  const response = await publicPage(repoFor(baseSnapshot, 'SUSPENDED'));
  assert.equal(response.status, 503);
  assert.match(await response.text(), /website is unavailable/i);
});

// 22
test('ARCHIVED does not expose previous content', async () => {
  const response = await publicPage(repoFor(baseSnapshot, 'ARCHIVED'));
  assert.equal(response.status, 410);
  assert.doesNotMatch(await response.text(), /Thoughtful treatments/);
});

// 23
test('public response does not include internal database IDs', async () => {
  const body = await (await publicPage()).text();
  assert.doesNotMatch(body, /internal-database-id/);
});

// 24
test('public response does not include tenant secrets', async () => {
  const body = await (await publicPage()).text();
  assert.doesNotMatch(body, /tenant-secret-sentinel/);
});

// 25
test('public response does not include agency notes', async () => {
  const body = await (await publicPage()).text();
  assert.doesNotMatch(body, /agency-note-sentinel/);
});

// 26
test('an unknown renderer key fails safely', async () => {
  const snapshot = mutateSnapshot(baseSnapshot, (draft) => {
    draft.pages[0]!.rendererKey = 'unknown-renderer-v1';
  });
  assert.equal((await publicPage(repoFor(snapshot))).status, 503);
});

// 27
test('a disabled renderer mapping fails safely', async () => {
  const snapshot = mutateSnapshot(baseSnapshot, (draft) => {
    draft.pages[0]!.rendererStatus = 'DISABLED';
  });
  assert.equal((await publicPage(repoFor(snapshot))).status, 503);
});

// 28
test('an unapproved template version cannot render publicly', async () => {
  const snapshot = mutateSnapshot(baseSnapshot, (draft) => {
    draft.pages[0]!.templateVersionStatus = 'DISABLED';
  });
  assert.equal((await publicPage(repoFor(snapshot))).status, 503);
});

// 29
test('an incompatible layout and page-type assignment cannot render', async () => {
  const snapshot = mutateSnapshot(baseSnapshot, (draft) => {
    draft.pages[0]!.compatiblePageTypes = ['ABOUT'];
  });
  assert.equal((await publicPage(repoFor(snapshot))).status, 503);
});

// 30
test('the registered internal HOME layout renders', async () => {
  assert.ok(hasSiteLayoutRenderer('home-editorial-v1'));
  assert.match(await (await publicPage()).text(), /home-editorial-v1/);
});

// 31
test('the registered SERVICE_DETAIL layout renders', async () => {
  const response = await publicPage(
    repoFor(),
    fallbackHostname,
    '/services/clarity-session',
  );
  assert.equal(response.status, 200);
  assert.match(await response.text(), /service-detail-editorial-v1/);
});

// 32
test('raw imported template JavaScript is never executed', () => {
  const registered = listRegisteredSiteRenderers();
  assert.ok(registered.length >= 13);
  assert.equal(registered.some((entry) => entry.key.includes('.js')), false);
});

// 33
test('stored script-like text is escaped rather than rendered as HTML', async () => {
  const snapshot = mutateSnapshot(baseSnapshot, (draft) => {
    const hero = draft.pages[0]!.sections.find((section) => section.type === 'HERO');
    if (hero?.type === 'HERO') hero.heading = '<script>alert(1)</script>';
  });
  const body = await (await publicPage(repoFor(snapshot))).text();
  assert.doesNotMatch(body, /<h1><script>/);
  assert.match(body, /&lt;script&gt;/);
});

// 34
test('javascript links are rejected by the action contract', () => {
  assert.equal(SiteActionSchema.safeParse({
    type: 'JAVASCRIPT',
    label: 'Run',
    url: 'javascript:alert(1)',
  }).success, false);
});

// 35
test('arbitrary external primary calls to action are rejected', () => {
  assert.equal(SiteActionSchema.safeParse({
    type: 'EXTERNAL_URL',
    label: 'Book',
    url: 'https://external-booking.example',
  }).success, false);
});

// 36
test('KS OS booking actions render as local /book links', async () => {
  const body = await (await publicPage()).text();
  assert.match(body, /href="\/book(?:\?|")/);
  assert.doesNotMatch(body, /external-booking/);
});

// 37
test('/book resolves the tenant from the hostname', async () => {
  const response = await handleBookingRequest({
    request: request(fallbackHostname, '/book'),
    repository: repoFor(),
    config,
  });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location') ?? '', /\/book\/northlight/);
});

// 38
test('/book redirects only to native KS OS booking', async () => {
  const response = await handleBookingRequest({
    request: request(fallbackHostname, '/book'),
    repository: repoFor(),
    config,
  });
  assert.match(response.headers.get('location') ?? '', /^https:\/\/book\.kasimshah\.com\//);
});

// 39
test('valid service preselection is preserved', async () => {
  const service = baseSnapshot.services[0]!;
  const response = await handleBookingRequest({
    request: request(fallbackHostname, `/book?service=${service.publicReference}`),
    repository: repoFor(),
    config,
  });
  assert.match(response.headers.get('location') ?? '', new RegExp(`service=${service.publicReference}`));
});

// 40
test('cross-tenant service preselection is rejected', async () => {
  const response = await handleBookingRequest({
    request: request(
      fallbackHostname,
      '/book?service=30000000-0000-4000-8000-000000000040',
    ),
    repository: repoFor(),
    config,
  });
  assert.equal(response.status, 404);
});

// 41
test('cross-tenant location preselection is rejected', async () => {
  const response = await handleBookingRequest({
    request: request(
      fallbackHostname,
      '/book?location=30000000-0000-4000-8000-000000000041',
    ),
    repository: repoFor(),
    config,
  });
  assert.equal(response.status, 404);
});

// 42
test('cross-tenant staff preselection is rejected', async () => {
  const response = await handleBookingRequest({
    request: request(
      fallbackHostname,
      '/book?staff=30000000-0000-4000-8000-000000000042',
    ),
    repository: repoFor(),
    config,
  });
  assert.equal(response.status, 404);
});

// 43
test('internal tenant IDs do not appear in booking URLs', async () => {
  const response = await handleBookingRequest({
    request: request(fallbackHostname, '/book'),
    repository: repoFor(),
    config,
  });
  const location = response.headers.get('location') ?? '';
  assert.doesNotMatch(location, /tenant(Id|_id)=/i);
});

// 44
test('arbitrary booking redirect targets are rejected', async () => {
  const response = await handleBookingRequest({
    request: request(fallbackHostname, '/book?redirect=https%3A%2F%2Fevil.example'),
    repository: repoFor(),
    config,
  });
  assert.equal(response.status, 404);
});

function previewSetup(now = new Date('2026-07-24T18:00:00.000Z')) {
  const snapshot = previewSnapshot();
  const repository = repoFor();
  repository.addPreview(snapshot);
  const token = signSitePreviewToken({
    siteReference: snapshot.siteReference,
    versionReference: snapshot.versionReference,
    purpose: 'AGENCY_REVIEW',
    secret: previewSecret,
    now,
  });
  return { snapshot, repository, token, now };
}

// 45
test('preview requires a signed token', async () => {
  const setup = previewSetup();
  const response = await handlePreviewRequest({
    request: request(fallbackHostname, '/site-preview/a/b'),
    repository: setup.repository,
    config,
    siteReference: setup.snapshot.siteReference,
    versionReference: setup.snapshot.versionReference,
    now: setup.now,
  });
  assert.equal(response.status, 404);
});

// 46
test('an expired preview token is rejected', async () => {
  const setup = previewSetup();
  const response = await handlePreviewRequest({
    request: request(fallbackHostname, `/site-preview/a/b?token=${setup.token}`),
    repository: setup.repository,
    config,
    siteReference: setup.snapshot.siteReference,
    versionReference: setup.snapshot.versionReference,
    now: new Date(setup.now.getTime() + 3_700_000),
  });
  assert.equal(response.status, 404);
});

// 47
test('a Site A preview token cannot preview Site B', async () => {
  const setup = previewSetup();
  const other = differentTenantSnapshot();
  const response = await handlePreviewRequest({
    request: request(fallbackHostname, `/site-preview/a/b?token=${setup.token}`),
    repository: setup.repository,
    config,
    siteReference: other.siteReference,
    versionReference: setup.snapshot.versionReference,
    now: setup.now,
  });
  assert.equal(response.status, 404);
});

// 48
test('a Version A preview token cannot preview Version B', async () => {
  const setup = previewSetup();
  const response = await handlePreviewRequest({
    request: request(fallbackHostname, `/site-preview/a/b?token=${setup.token}`),
    repository: setup.repository,
    config,
    siteReference: setup.snapshot.siteReference,
    versionReference: differentTenantSnapshot().versionReference,
    now: setup.now,
  });
  assert.equal(response.status, 404);
});

test('a review-cycle preview token requires a positively validated review session', async () => {
  const setup = previewSetup();
  const reviewCycleReference = '20000000-0000-4000-8000-000000000099';
  const token = signSitePreviewToken({
    siteReference: setup.snapshot.siteReference,
    versionReference: setup.snapshot.versionReference,
    reviewCycleReference,
    purpose: 'CLIENT_REVIEW',
    secret: previewSecret,
    now: setup.now,
  });
  const response = await handlePreviewRequest({
    request: request(fallbackHostname, `/site-preview/a/b?token=${token}`),
    repository: setup.repository,
    config,
    siteReference: setup.snapshot.siteReference,
    versionReference: setup.snapshot.versionReference,
    now: setup.now,
  });
  assert.equal(response.status, 404);
});

test('review preview validation receives the exact cycle, site, version and requested path', async () => {
  const setup = previewSetup();
  const reviewCycleReference = '20000000-0000-4000-8000-000000000099';
  let validated:
    | Parameters<NonNullable<PublicSiteRepository['isReviewPreviewSessionActive']>>[0]
    | undefined;
  setup.repository.reviewSessionValidator = (input) => {
    validated = input;
    return true;
  };
  const token = signSitePreviewToken({
    siteReference: setup.snapshot.siteReference,
    versionReference: setup.snapshot.versionReference,
    reviewCycleReference,
    purpose: 'CLIENT_REVIEW',
    secret: previewSecret,
    now: setup.now,
  });
  const response = await handlePreviewRequest({
    request: request(fallbackHostname, `/site-preview/a/b?token=${token}&path=%2F`),
    repository: setup.repository,
    config,
    siteReference: setup.snapshot.siteReference,
    versionReference: setup.snapshot.versionReference,
    now: setup.now,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(validated, {
    jti: verifySitePreviewToken({
      token,
      siteReference: setup.snapshot.siteReference,
      versionReference: setup.snapshot.versionReference,
      secret: previewSecret,
      now: setup.now,
    }).jti,
    reviewCycleReference,
    siteReference: setup.snapshot.siteReference,
    versionReference: setup.snapshot.versionReference,
    requestedPath: '/',
  });
});

test('review preview denies a page outside the session scope', async () => {
  const setup = previewSetup();
  const reviewCycleReference = '20000000-0000-4000-8000-000000000099';
  setup.repository.reviewSessionValidator = (input) => input.requestedPath === '/';
  const token = signSitePreviewToken({
    siteReference: setup.snapshot.siteReference,
    versionReference: setup.snapshot.versionReference,
    reviewCycleReference,
    purpose: 'CLIENT_REVIEW',
    secret: previewSecret,
    now: setup.now,
  });
  const response = await handlePreviewRequest({
    request: request(
      fallbackHostname,
      `/site-preview/a/b?token=${token}&path=%2Fservices`,
    ),
    repository: setup.repository,
    config,
    siteReference: setup.snapshot.siteReference,
    versionReference: setup.snapshot.versionReference,
    now: setup.now,
  });
  assert.equal(response.status, 404);
});

async function validPreviewResponse() {
  const setup = previewSetup();
  return handlePreviewRequest({
    request: request(fallbackHostname, `/site-preview/a/b?token=${setup.token}`),
    repository: setup.repository,
    config,
    siteReference: setup.snapshot.siteReference,
    versionReference: setup.snapshot.versionReference,
    now: setup.now,
  });
}

// 49
test('preview responses contain noindex', async () => {
  assert.match(await (await validPreviewResponse()).text(), /noindex, nofollow/);
});

// 50
test('preview responses use no-store', async () => {
  assert.match((await validPreviewResponse()).headers.get('cache-control') ?? '', /no-store/);
});

// 51
test('preview banner and safe version reference are rendered', async () => {
  const body = await (await validPreviewResponse()).text();
  assert.match(body, /preview-banner/);
  assert.match(body, new RegExp(baseSnapshot.versionReference));
});

// 52
test('published pages contain the correct canonical URL', async () => {
  const body = await (await publicPage()).text();
  assert.match(body, new RegExp(`https://${fallbackHostname}/`));
});

// 53
test('a valid non-primary hostname redirects to the primary hostname', async () => {
  const snapshot = customDomainSnapshot();
  const response = await publicPage(repoFor(snapshot), fallbackHostname);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://www.northlight.example/');
});

// 54
test('canonical redirects cannot loop', async () => {
  const snapshot = customDomainSnapshot();
  const response = await publicPage(repoFor(snapshot), 'www.northlight.example');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
});

// 55
test('page titles are safely escaped', async () => {
  const snapshot = mutateSnapshot(baseSnapshot, (draft) => {
    draft.pages[0]!.seo.title = 'Home <img src=x onerror=alert(1)>';
  });
  const body = await (await publicPage(repoFor(snapshot))).text();
  assert.match(body, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(body, /<title>Home <img/);
});

// 56
test('meta descriptions are safely escaped', async () => {
  const snapshot = mutateSnapshot(baseSnapshot, (draft) => {
    draft.pages[0]!.seo.description = 'Safe "><script>alert(1)</script>';
  });
  const body = await (await publicPage(repoFor(snapshot))).text();
  assert.doesNotMatch(body, /content="Safe "><script>/);
  assert.match(body, /&quot;&gt;&lt;script&gt;/);
});

// 57
test('Open Graph metadata uses the current tenant', async () => {
  const snapshot = differentTenantSnapshot();
  const body = await (await publicPage(
    repoFor(snapshot),
    'riverstone.sites.kasimshah.com',
  )).text();
  assert.match(body, /Riverstone Studio/);
  assert.doesNotMatch(body, /Northlight Studio/);
});

// 58
test('structured data contains only the current tenant', () => {
  const page = baseSnapshot.pages[0]!;
  const json = serializeStructuredData(generateSiteStructuredData(baseSnapshot, page));
  assert.match(json, /Northlight Studio/);
  assert.doesNotMatch(json, /Riverstone Studio/);
});

// 59
test('structured data does not fabricate ratings or reviews', () => {
  const data = generateSiteStructuredData(baseSnapshot, baseSnapshot.pages[0]!);
  const json = JSON.stringify(data);
  assert.doesNotMatch(json, /aggregateRating|ratingValue|reviewCount/);
});

// 60
test('structured-data serialisation prevents script breakout', () => {
  const snapshot = mutateSnapshot(baseSnapshot, (draft) => {
    draft.business.name = '</script><script>alert(1)</script>';
  });
  const json = serializeStructuredData(
    generateSiteStructuredData(snapshot, snapshot.pages[0]!),
  );
  assert.doesNotMatch(json, /<\/script>/);
  assert.match(json, /\\u003c/);
});

// 61
test('sitemap contains only published indexable active pages', () => {
  const snapshot = mutateSnapshot(baseSnapshot, (draft) => {
    draft.pages.find((page) => page.path === '/results')!.indexable = false;
  });
  const xml = generateTenantSitemap(snapshot);
  assert.match(xml, /<loc>/);
  assert.doesNotMatch(xml, /\/results/);
});

// 62
test('sitemap contains only the current tenant domain', () => {
  const xml = generateTenantSitemap(baseSnapshot);
  assert.match(xml, new RegExp(fallbackHostname));
  assert.doesNotMatch(xml, /riverstone/);
});

// 63
test('sitemap excludes preview snapshots', () => {
  assert.doesNotMatch(generateTenantSitemap(previewSnapshot()), /<url>/);
});

// 64
test('sitemap excludes internal and booking routes', () => {
  const xml = generateTenantSitemap(baseSnapshot);
  assert.doesNotMatch(xml, /\/book/);
  assert.doesNotMatch(xml, /\/api|\/site-preview|\/health/);
});

// 65
test('robots references the current tenant sitemap', () => {
  const robots = generateTenantRobots({
    snapshot: baseSnapshot,
    allowIndexing: true,
  });
  assert.match(robots, new RegExp(`https://${fallbackHostname}/sitemap.xml`));
});

// 66
test('preview robots policy disallows crawling', () => {
  assert.equal(
    generateTenantRobots({ snapshot: previewSnapshot(), allowIndexing: false }),
    'User-agent: *\nDisallow: /\n',
  );
});

// 67
test('suspended-site robots response disallows crawling', async () => {
  const response = await handleRobotsRequest({
    request: request(fallbackHostname, '/robots.txt'),
    repository: repoFor(baseSnapshot, 'SUSPENDED'),
    config,
  });
  assert.match(await response.text(), /Disallow: \//);
});

// 68
test('a missing page returns 404', async () => {
  assert.equal(
    (await publicPage(repoFor(), fallbackHostname, '/does-not-exist')).status,
    404,
  );
});

// 69
test('an unknown site returns a safe 404', async () => {
  const response = await publicPage(repoFor(), 'unknown.example');
  assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /SQL|stack|tenant_id/i);
});

// 70
test('rich text does not execute or emit stored scripts', async () => {
  const snapshot = mutateSnapshot(baseSnapshot, (draft) => {
    const guide = draft.pages.find((page) => page.path === '/new-client-guide')!;
    const richText = guide.sections.find((section) => section.type === 'RICH_TEXT');
    if (richText?.type === 'RICH_TEXT') {
      richText.document.blocks = [{
        type: 'PARAGRAPH',
        children: [{ type: 'TEXT', text: '<script>alert(1)</script>' }],
      }];
    }
  });
  const body = await (await publicPage(
    repoFor(snapshot),
    fallbackHostname,
    '/new-client-guide',
  )).text();
  assert.doesNotMatch(body, /<p><script>/);
  assert.match(body, /&lt;script&gt;/);
});

// 71
test('mobile navigation uses keyboard-accessible native disclosure semantics', async () => {
  const body = await (await publicPage()).text();
  assert.match(body, /<details class="mobile-navigation">/);
  assert.match(body, /<summary aria-label="Open site navigation">/);
});

// 72
test('header includes a native Book now action', async () => {
  const body = await (await publicPage()).text();
  assert.match(body, /header-booking[^>]*href="\/book/);
});

// 73
test('hero includes a native Book now action', async () => {
  const body = await (await publicPage()).text();
  assert.match(body, /hero-booking[^>]*href="\/book/);
});

// 74
test('service-detail page includes a service-aware booking action', async () => {
  const service = baseSnapshot.services[0]!;
  const body = await (await publicPage(
    repoFor(),
    fallbackHostname,
    '/services/clarity-session',
  )).text();
  assert.match(body, new RegExp(`service=${service.publicReference}`));
});

// 75
test('final CTA includes native booking', async () => {
  assert.match(await (await publicPage()).text(), /final-booking[^>]*href="\/book/);
});

// 76
test('footer includes native booking', async () => {
  assert.match(await (await publicPage()).text(), /footer-booking[^>]*href="\/book/);
});

// 77
test('decorative images render with empty alt text', async () => {
  const body = await (await publicPage(
    repoFor(),
    fallbackHostname,
    '/results',
  )).text();
  assert.match(body, /alt=""/);
});

// 78
test('informative images require non-empty alt text', () => {
  assert.equal(SiteAssetReferenceSchema.safeParse({
    publicReference: '30000000-0000-4000-8000-000000000001',
    type: 'IMAGE',
    publicationStatus: 'PUBLISHED',
    mimeType: 'image/webp',
    url: 'https://assets.example/image.webp',
    width: 100,
    height: 100,
    purpose: 'INFORMATIVE',
    alt: '',
    variants: [],
  }).success, false);
});

// 79
test('images render intrinsic width and height', async () => {
  const body = await (await publicPage()).text();
  assert.match(body, /width="1600" height="1067"/);
});

// 80
test('reserved routes cannot be shadowed by a marketing page', () => {
  const page = structuredClone(baseSnapshot.pages[0]!);
  page.path = '/api';
  page.seo.canonicalPath = '/api';
  assert.equal(PublishedPageSnapshotSchema.safeParse(page).success, false);
});

// 81
test('/book cannot be replaced by a marketing page', async () => {
  assert.equal((await publicPage(repoFor(), fallbackHostname, '/book')).status, 404);
});

// 82
test('one renderer serves two distinct tenant snapshots without leakage', async () => {
  const first = await (await publicPage()).text();
  const secondSnapshot = differentTenantSnapshot();
  const second = await (await publicPage(
    repoFor(secondSnapshot),
    'riverstone.sites.kasimshah.com',
  )).text();
  assert.match(first, /Northlight Studio/);
  assert.match(second, /Riverstone Studio/);
  assert.doesNotMatch(second, /Northlight Studio/);
});

// 83
test('snapshot validation rejects malformed section data', () => {
  const draft = structuredClone(baseSnapshot) as unknown as {
    pages: Array<{ sections: Array<Record<string, unknown>> }>;
  };
  delete draft.pages[0]!.sections[1]!.heading;
  assert.equal(PublishedSiteSnapshotSchema.safeParse(draft).success, false);
});

// 84
test('unknown section types are rejected', () => {
  const draft = structuredClone(baseSnapshot) as unknown as {
    pages: Array<{ sections: Array<Record<string, unknown>> }>;
  };
  draft.pages[0]!.sections[1]!.type = 'EXECUTABLE_WIDGET';
  assert.equal(PublishedSiteSnapshotSchema.safeParse(draft).success, false);
});

// 85
test('unknown action types are rejected', () => {
  assert.equal(SiteActionSchema.safeParse({
    type: 'ARBITRARY_ACTION',
    label: 'Unsafe',
  }).success, false);
});

// 86
test('published snapshots are deeply immutable in memory', () => {
  assert.ok(Object.isFrozen(baseSnapshot));
  assert.ok(Object.isFrozen(baseSnapshot.pages));
  assert.ok(Object.isFrozen(baseSnapshot.pages[0]));
});

// 87
test('published pages receive controlled public cache headers', async () => {
  assert.match((await publicPage()).headers.get('cache-control') ?? '', /s-maxage=300/);
});

// 88
test('preview pages are never publicly cached', async () => {
  const cache = (await validPreviewResponse()).headers.get('cache-control') ?? '';
  assert.match(cache, /private/);
  assert.match(cache, /no-store/);
  assert.doesNotMatch(cache, /s-maxage/);
});

// 89
test('health endpoint does not expose environment secrets', async () => {
  const response = handleHealthRequest(config);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.doesNotMatch(body, /preview-secret|DATABASE_URL|SUPABASE/i);
  assert.deepEqual(Object.keys(JSON.parse(body)).sort(), [
    'release',
    'schemaVersion',
    'service',
    'status',
  ]);
});

// 90
test('the internal template fixture is original and contains no Envato files', () => {
  assert.equal(ORIGINAL_INTERNAL_TEMPLATE_DEFINITION.sourceType, 'INTERNAL');
  assert.match(ORIGINAL_INTERNAL_TEMPLATE_DEFINITION.purpose, /not a production-ready design/);
  assert.equal(baseSnapshot.pages.length, 11);
  assert.ok(baseSnapshot.pages.every((page) => page.templateVersionStatus === 'APPROVED'));
  assert.ok(getSiteLayoutRenderer('home-editorial-v1'));
  assert.doesNotMatch(JSON.stringify(baseSnapshot), /themeforest|envato|stitch/i);
});

// Additional defense-in-depth cases.
test('revoked preview tokens are rejected', async () => {
  const setup = previewSetup();
  const payload = verifySitePreviewToken({
    token: setup.token,
    siteReference: setup.snapshot.siteReference,
    versionReference: setup.snapshot.versionReference,
    secret: previewSecret,
    now: setup.now,
  });
  setup.repository.revoked.add(payload.jti);
  const response = await handlePreviewRequest({
    request: request(fallbackHostname, `/site-preview/a/b?token=${setup.token}`),
    repository: setup.repository,
    config,
    siteReference: setup.snapshot.siteReference,
    versionReference: setup.snapshot.versionReference,
    now: setup.now,
  });
  assert.equal(response.status, 404);
});

test('a configured preview hostname is enforced', async () => {
  const setup = previewSetup();
  const response = await handlePreviewRequest({
    request: request(fallbackHostname, `/site-preview/a/b?token=${setup.token}`),
    repository: setup.repository,
    config: { ...config, previewHostname: 'preview.sites.kasimshah.com' },
    siteReference: setup.snapshot.siteReference,
    versionReference: setup.snapshot.versionReference,
    now: setup.now,
  });
  assert.equal(response.status, 404);
});

test('HTTP and data asset URLs are rejected', () => {
  const asset = structuredClone(baseSnapshot.assets[0]!);
  asset.url = 'http://assets.example/image.webp';
  assert.equal(SiteAssetReferenceSchema.safeParse(asset).success, false);
  asset.url = 'data:image/svg+xml,<svg onload=alert(1)>';
  assert.equal(SiteAssetReferenceSchema.safeParse(asset).success, false);
});

test('sitemap endpoint returns XML and the correct content type', async () => {
  const response = await handleSitemapRequest({
    request: request(fallbackHostname, '/sitemap.xml'),
    repository: repoFor(),
    config,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/xml/);
  assert.match(await response.text(), /<urlset/);
});
