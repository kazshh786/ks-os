import {
  CampaignReferenceSchema,
  PublicReferenceSchema,
  resolveKsOsBookingUrl,
} from '@ks-os/contracts';
import type { ComponentRenderContext } from '@ks-os/site-components';
import {
  liveSiteCacheControl,
  type PublicLiveSiteData,
} from '@ks-os/live-site-intelligence';
import {
  RESERVED_PUBLIC_SITE_PATHS,
  type PublishedSiteSnapshot,
} from '@ks-os/site-schema';
import { renderRegisteredSitePage, SiteRenderabilityError } from '@ks-os/site-templates';
import { z } from 'zod';
import type { SitesRuntimeConfig } from './config.js';
import {
  renderNotFoundDocument,
  renderPublishedPageDocument,
  renderUnavailableDocument,
} from './document.js';
import {
  HostnameValidationError,
  normalizePublicPath,
  resolvePublicRequestHostname,
} from './hostname.js';
import {
  PreviewTokenError,
  verifySitePreviewToken,
} from './preview-token.js';
import type {
  PublicSiteRepository,
  ResolvedPublicSite,
} from './repository.js';
import {
  generateSiteStructuredData,
  generateTenantRobots,
  generateTenantSitemap,
} from './seo.js';

const PUBLIC_PAGE_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
const SHORT_ERROR_CACHE = 'public, max-age=0, s-maxage=30';
const NO_STORE = 'private, no-store, max-age=0';

function securityHeaders(cacheControl: string, contentType: string) {
  return {
    'Cache-Control': cacheControl,
    'Content-Type': contentType,
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function htmlResponse(body: string, status: number, cacheControl: string) {
  return new Response(body, {
    status,
    headers: securityHeaders(cacheControl, 'text/html; charset=utf-8'),
  });
}

function notFound(siteName?: string) {
  return htmlResponse(renderNotFoundDocument(siteName), 404, SHORT_ERROR_CACHE);
}

function unavailable(status = 503) {
  return htmlResponse(renderUnavailableDocument(), status, NO_STORE);
}

function requestHostname(request: Request, config: SitesRuntimeConfig) {
  return resolvePublicRequestHostname({
    host: request.headers.get('host') ?? new URL(request.url).host,
    forwardedHost: request.headers.get('x-forwarded-host'),
    trustedProxy: config.trustedProxy,
  });
}

function isNoIndexHostname(request: Request, config: SitesRuntimeConfig) {
  try {
    return config.noIndexHostnames.includes(requestHostname(request, config));
  } catch {
    return false;
  }
}

function applyHostRobotsPolicy(
  response: Response,
  request: Request,
  config: SitesRuntimeConfig,
) {
  if (isNoIndexHostname(request, config)) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  return response;
}

type LiveSiteResult =
  | {
    kind: 'AVAILABLE';
    hostname: string;
    site: ResolvedPublicSite;
    snapshot: PublishedSiteSnapshot;
  }
  | { kind: 'NOT_FOUND' }
  | { kind: 'UNAVAILABLE'; status: 410 | 503 };

async function resolveLiveSite(input: {
  request: Request;
  repository: PublicSiteRepository;
  config: SitesRuntimeConfig;
}): Promise<LiveSiteResult> {
  let hostname: string;
  try {
    hostname = requestHostname(input.request, input.config);
  } catch (error) {
    if (error instanceof HostnameValidationError) return { kind: 'NOT_FOUND' };
    throw error;
  }

  const site = await input.repository.resolveHostname(
    hostname,
    input.config.fallbackDomain,
  );
  if (!site || site.domainStatus !== 'ACTIVE') return { kind: 'NOT_FOUND' };
  if (site.siteStatus === 'ARCHIVED') return { kind: 'UNAVAILABLE', status: 410 };
  if (site.siteStatus === 'SUSPENDED') return { kind: 'UNAVAILABLE', status: 503 };
  if (!['LIVE', 'PUBLISHING', 'PUBLISH_FAILED'].includes(site.siteStatus)) {
    return { kind: 'NOT_FOUND' };
  }
  const snapshot = await input.repository.loadPublishedSnapshot(site.siteReference);
  if (
    !snapshot
    || snapshot.siteReference !== site.siteReference
    || snapshot.visibility !== 'PUBLISHED'
    || snapshot.versionStatus !== 'PUBLISHED'
  ) {
    return { kind: 'UNAVAILABLE', status: 503 };
  }
  return { kind: 'AVAILABLE', hostname, site, snapshot };
}

function canonicalRedirect(
  request: Request,
  hostname: string,
  snapshot: PublishedSiteSnapshot,
): Response | null {
  if (hostname === snapshot.canonicalHostname) return null;
  const current = snapshot.domains.find(
    (domain) => domain.hostname === hostname && domain.status === 'ACTIVE',
  );
  const canonical = snapshot.domains.find(
    (domain) =>
      domain.hostname === snapshot.canonicalHostname
      && domain.status === 'ACTIVE'
      && domain.primary,
  );
  if (!current || !canonical) return null;
  const destination = new URL(request.url);
  destination.protocol = 'https:';
  destination.host = canonical.hostname;
  if (destination.hostname === hostname) return null;
  return new Response(null, {
    status: 302,
    headers: {
      ...securityHeaders('public, max-age=60, s-maxage=300', 'text/plain; charset=utf-8'),
      Location: destination.toString(),
    },
  });
}

function renderContext(
  snapshot: PublishedSiteSnapshot,
  page: PublishedSiteSnapshot['pages'][number],
  live?: PublicLiveSiteData,
  recommendations?: ComponentRenderContext['recommendations'],
): ComponentRenderContext {
  return {
    snapshot,
    page,
    ...(live ? { live } : {}),
    ...(recommendations ? { recommendations } : {}),
    pagePathByReference: Object.fromEntries(
      snapshot.pages
        .filter((candidate) => candidate.active)
        .map((candidate) => [candidate.publicReference, candidate.path]),
    ),
  };
}

function reservedMarketingPath(path: string) {
  return [...RESERVED_PUBLIC_SITE_PATHS].some(
    (reserved) => path === reserved || path.startsWith(`${reserved}/`),
  );
}

export async function handlePublicPageRequest(input: {
  request: Request;
  repository: PublicSiteRepository;
  config: SitesRuntimeConfig;
}): Promise<Response> {
  let path: string;
  try {
    path = normalizePublicPath(new URL(input.request.url).pathname);
  } catch {
    return notFound();
  }
  if (reservedMarketingPath(path)) return notFound();

  try {
    const resolved = await resolveLiveSite(input);
    if (resolved.kind === 'NOT_FOUND') return notFound();
    if (resolved.kind === 'UNAVAILABLE') return unavailable(resolved.status);
    const redirect = canonicalRedirect(
      input.request,
      resolved.hostname,
      resolved.snapshot,
    );
    if (redirect) return redirect;
    const page = resolved.snapshot.pages.find(
      (candidate) =>
        candidate.path === path
        && candidate.active
        && candidate.pageType !== 'BOOKING',
    );
    if (!page) {
      const pathRedirect = await input.repository.resolvePathRedirect?.({
        siteReference: resolved.snapshot.siteReference,
        sourcePath: path,
      });
      if (pathRedirect) {
        return new Response(null, {
          status: pathRedirect.statusCode,
          headers: {
            ...securityHeaders(
              'public, max-age=300, s-maxage=3600',
              'text/plain; charset=utf-8',
            ),
            location: pathRedirect.targetPath,
          },
        });
      }
      return notFound(resolved.snapshot.business.name);
    }
    const [live, recommendations] = await Promise.all([
      input.repository.resolveLiveSiteData
        ? input.repository.resolveLiveSiteData(resolved.snapshot).catch(() => undefined)
        : undefined,
      input.repository.resolvePublishedRecommendations
        ? input.repository.resolvePublishedRecommendations(resolved.snapshot).catch(() => undefined)
        : undefined,
    ]);
    const context = renderContext(resolved.snapshot, page, live, recommendations);
    const content = renderRegisteredSitePage(page, context);
    const structuredData = generateSiteStructuredData(resolved.snapshot, page);
    return applyHostRobotsPolicy(htmlResponse(
      renderPublishedPageDocument({
        snapshot: resolved.snapshot,
        page,
        content,
        structuredData,
      }),
      200,
      live ? liveSiteCacheControl('LIVE_FAST') : PUBLIC_PAGE_CACHE,
    ), input.request, input.config);
  } catch (error) {
    if (error instanceof SiteRenderabilityError) return unavailable();
    return unavailable();
  }
}

const PublicBookingSelectionSchema = z.object({
  service: PublicReferenceSchema.optional(),
  location: PublicReferenceSchema.optional(),
  staff: PublicReferenceSchema.optional(),
  campaign: CampaignReferenceSchema.optional(),
}).strict();

function parseBookingSelection(url: URL) {
  const allowed = new Set(['service', 'location', 'staff', 'campaign']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new Error('BOOKING_QUERY_INVALID');
    }
  }
  return PublicBookingSelectionSchema.parse({
    ...(url.searchParams.get('service')
      ? { service: url.searchParams.get('service') }
      : {}),
    ...(url.searchParams.get('location')
      ? { location: url.searchParams.get('location') }
      : {}),
    ...(url.searchParams.get('staff')
      ? { staff: url.searchParams.get('staff') }
      : {}),
    ...(url.searchParams.get('campaign')
      ? { campaign: url.searchParams.get('campaign') }
      : {}),
  });
}

export async function handleBookingRequest(input: {
  request: Request;
  repository: PublicSiteRepository;
  config: SitesRuntimeConfig;
}): Promise<Response> {
  try {
    const resolved = await resolveLiveSite(input);
    if (resolved.kind === 'NOT_FOUND') return notFound();
    if (resolved.kind === 'UNAVAILABLE') return unavailable(resolved.status);
    if (!input.config.publicBookingOrigin) return unavailable();
    const selection = parseBookingSelection(new URL(input.request.url));
    if (
      selection.service
      && !resolved.snapshot.services.some(
        (service) =>
          service.publicReference === selection.service && service.bookingEnabled,
      )
    ) {
      return notFound();
    }
    if (
      selection.location
      && !resolved.snapshot.locations.some(
        (location) => location.publicReference === selection.location,
      )
    ) {
      return notFound();
    }
    if (
      selection.staff
      && !resolved.snapshot.staff.some(
        (staff) =>
          staff.publicReference === selection.staff && staff.bookingEnabled,
      )
    ) {
      return notFound();
    }
    const destination = resolveKsOsBookingUrl({
      publicOrigin: input.config.publicBookingOrigin,
      tenantReference: resolved.snapshot.booking.tenantReference,
      tenantSubdomain: resolved.snapshot.booking.tenantSubdomain,
      routeMode: 'FALLBACK',
      serviceReference: selection.service,
      locationReference: selection.location,
      staffReference: selection.staff,
      campaignReference: selection.campaign
        ?? resolved.snapshot.booking.campaignReference,
    });
    return new Response(null, {
      status: 302,
      headers: {
        ...securityHeaders(NO_STORE, 'text/plain; charset=utf-8'),
        Location: destination,
      },
    });
  } catch {
    return notFound();
  }
}

export async function handlePreviewRequest(input: {
  request: Request;
  repository: PublicSiteRepository;
  config: SitesRuntimeConfig;
  siteReference: string;
  versionReference: string;
  now?: Date;
}): Promise<Response> {
  if (!input.config.previewTokenSecret) return unavailable();
  try {
    if (
      input.config.previewHostname
      && requestHostname(input.request, input.config) !== input.config.previewHostname
    ) {
      return notFound();
    }
    const url = new URL(input.request.url);
    const path = normalizePublicPath(url.searchParams.get('path') ?? '/');
    const authorization = input.request.headers.get('authorization');
    const bearer = authorization?.match(/^Bearer ([A-Za-z0-9._~-]{20,2000})$/)?.[1];
    const queryTokens = url.searchParams.getAll('token');
    if (bearer && queryTokens.length > 0) throw new PreviewTokenError();
    if (!bearer && queryTokens.length !== 1) throw new PreviewTokenError();
    const payload = verifySitePreviewToken({
      token: bearer ?? queryTokens[0] ?? '',
      siteReference: input.siteReference,
      versionReference: input.versionReference,
      secret: input.config.previewTokenSecret,
      now: input.now,
    });
    if (await input.repository.isPreviewTokenRevoked({
      jti: payload.jti,
      siteReference: payload.siteReference,
      versionReference: payload.versionReference,
    })) {
      throw new PreviewTokenError();
    }
    if (
      payload.reviewCycleReference
      && (
        !input.repository.isReviewPreviewSessionActive
        || !await input.repository.isReviewPreviewSessionActive({
          jti: payload.jti,
          reviewCycleReference: payload.reviewCycleReference,
          siteReference: payload.siteReference,
          versionReference: payload.versionReference,
          requestedPath: path,
        })
      )
    ) {
      throw new PreviewTokenError();
    }
    if (
      payload.purpose === 'QUALITY_AUDIT'
      && (
        !bearer
        || !payload.qualityRunReference
        || !input.repository.isQualityAuditSessionActive
        || !await input.repository.isQualityAuditSessionActive({
          jti: payload.jti,
          qualityRunReference: payload.qualityRunReference,
          siteReference: payload.siteReference,
          versionReference: payload.versionReference,
          requestedPath: path,
        })
      )
    ) {
      throw new PreviewTokenError();
    }
    if (payload.purpose !== 'QUALITY_AUDIT' && bearer) {
      throw new PreviewTokenError();
    }
    const snapshot = await input.repository.loadPreviewSnapshot(
      input.siteReference,
      input.versionReference,
    );
    if (
      !snapshot
      || snapshot.siteReference !== payload.siteReference
      || snapshot.versionReference !== payload.versionReference
    ) {
      return notFound();
    }
    const page = snapshot.pages.find(
      (candidate) => candidate.path === path && candidate.pageType !== 'BOOKING',
    );
    if (!page) return notFound();
    const [live, recommendations] = await Promise.all([
      input.repository.resolveLiveSiteData
        ? input.repository.resolveLiveSiteData(snapshot).catch(() => undefined)
        : undefined,
      input.repository.resolvePublishedRecommendations
        ? input.repository.resolvePublishedRecommendations(snapshot).catch(() => undefined)
        : undefined,
    ]);
    const context = renderContext(snapshot, page, live, recommendations);
    const content = renderRegisteredSitePage(page, context);
    const structuredData = generateSiteStructuredData(snapshot, page);
    const response = htmlResponse(
      renderPublishedPageDocument({
        snapshot,
        page,
        content,
        structuredData,
        preview: true,
      }),
      200,
      NO_STORE,
    );
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    return response;
  } catch {
    return notFound();
  }
}

export async function handleSitemapRequest(input: {
  request: Request;
  repository: PublicSiteRepository;
  config: SitesRuntimeConfig;
}): Promise<Response> {
  try {
    const resolved = await resolveLiveSite(input);
    if (resolved.kind !== 'AVAILABLE') {
      return new Response('', {
        status: resolved.kind === 'UNAVAILABLE' ? resolved.status : 404,
        headers: securityHeaders(NO_STORE, 'application/xml; charset=utf-8'),
      });
    }
    const redirect = canonicalRedirect(input.request, resolved.hostname, resolved.snapshot);
    if (redirect) return redirect;
    return new Response(generateTenantSitemap(resolved.snapshot), {
      status: 200,
      headers: securityHeaders(PUBLIC_PAGE_CACHE, 'application/xml; charset=utf-8'),
    });
  } catch {
    return new Response('', {
      status: 404,
      headers: securityHeaders(NO_STORE, 'application/xml; charset=utf-8'),
    });
  }
}

export async function handleRobotsRequest(input: {
  request: Request;
  repository: PublicSiteRepository;
  config: SitesRuntimeConfig;
}): Promise<Response> {
  if (isNoIndexHostname(input.request, input.config)) {
    const response = new Response(generateTenantRobots({ allowIndexing: false }), {
      status: 200,
      headers: securityHeaders(NO_STORE, 'text/plain; charset=utf-8'),
    });
    return applyHostRobotsPolicy(response, input.request, input.config);
  }
  try {
    const resolved = await resolveLiveSite(input);
    if (resolved.kind !== 'AVAILABLE') {
      return new Response(generateTenantRobots({ allowIndexing: false }), {
        status: resolved.kind === 'NOT_FOUND' ? 404 : 200,
        headers: securityHeaders(NO_STORE, 'text/plain; charset=utf-8'),
      });
    }
    const redirect = canonicalRedirect(input.request, resolved.hostname, resolved.snapshot);
    if (redirect) return redirect;
    return new Response(generateTenantRobots({
      snapshot: resolved.snapshot,
      allowIndexing: true,
    }), {
      status: 200,
      headers: securityHeaders(PUBLIC_PAGE_CACHE, 'text/plain; charset=utf-8'),
    });
  } catch {
    return new Response(generateTenantRobots({ allowIndexing: false }), {
      status: 404,
      headers: securityHeaders(NO_STORE, 'text/plain; charset=utf-8'),
    });
  }
}

export async function handleHealthRequest(input: {
  request: Request;
  repository: PublicSiteRepository;
  config: SitesRuntimeConfig;
}): Promise<Response> {
  let site: ResolvedPublicSite | null = null;
  try {
    site = await input.repository.resolveHostname(
      requestHostname(input.request, input.config),
      input.config.fallbackDomain,
    );
  } catch {
    site = null;
  }
  const response = new Response(JSON.stringify({
    status: 'available',
    service: 'sites',
    release: input.config.releaseVersion,
    schemaVersion: 1,
    // Health identity is safe verification evidence for a mapped hostname even
    // before activation. Public page rendering still requires ACTIVE above.
    siteReference: site?.siteReference ?? null,
    domainStatus: site?.domainStatus ?? 'UNMAPPED',
  }), {
    status: 200,
    headers: securityHeaders(NO_STORE, 'application/json; charset=utf-8'),
  });
  return applyHostRobotsPolicy(response, input.request, input.config);
}
