# Phase 15.5 — Public multi-tenant website renderer

## Scope

Phase 15.5 adds one server-rendered public application for every KS OS-managed
website. It does not publish websites, generate content, provision domains,
configure providers, call DNS APIs, or deploy infrastructure.

The intended lifecycle remains:

```text
approved blueprint
  → structured draft version
  → Phase 15.6 AI generation
  → agency preview
  → quality gates
  → publication
  → immutable render snapshot
  → public renderer
```

The included `Northlight` internal template is original test material. It
exists to verify the rendering contract and is not a production-ready design.

## Application architecture

`apps/sites` is an Astro application using server output and the provider-neutral
Node adapter. It is not a client-side SPA. The routes are rendered on demand:

- `GET /` and `GET /{nested-page-path}`
- `GET /book`
- `GET /sitemap.xml`
- `GET /robots.txt`
- `GET /site-preview/{siteReference}/{versionReference}`
- `GET /health`

The application performs direct, server-only reads through `packages/database`.
No database key or service-role credential is sent to browser JavaScript. A
request loads one immutable render snapshot rather than querying operational
records once per section.

## Hostname resolution and tenant isolation

The request hostname is the tenant selector. Browser-submitted tenant IDs are
never accepted.

Resolution:

1. Select `Host`, or `X-Forwarded-Host` only when `TRUST_PROXY=true`.
2. Reject whitespace, control characters, paths, fragments, credentials,
   malformed labels, invalid ports, and oversized input.
3. Lowercase and convert international hostnames to ASCII.
4. Resolve an exact custom-domain row.
5. Otherwise resolve `{tenant-subdomain}.${PUBLIC_SITES_FALLBACK_DOMAIN}`.
6. Require custom domains to be `ACTIVE`.
7. Load a snapshot by the resolved site's public reference and verify that its
   relational site/version/template references and SHA-256 digest agree.

`site_domains.hostname` remains globally unique. The fallback resolver uses the
existing unique tenant subdomain. A result for Site A cannot load a snapshot
whose `siteReference` belongs to Site B.

Local development uses an explicit development fallback such as
`sites.localhost`; production requires `PUBLIC_SITES_FALLBACK_DOMAIN`.

## Renderability contract

`template_layout_renderers` maps an approved Phase 15.3 layout to a controlled
renderer key. Imported layouts default to `UNMAPPED`; the migration does not
automatically approve Envato or Stitch output.

A page renders only when:

- the template version is `APPROVED`;
- the layout is approved and not disabled;
- the mapping status is `READY`;
- its numeric renderer version matches;
- its page type is in both the database compatibility assignment and the
  compile-time registry; and
- the renderer key exists in `packages/site-templates`.

Stored module paths, dynamic imports, `eval`, generated React, imported HTML,
and imported JavaScript are not part of the contract. The registry maps fixed
keys such as `home-editorial-v1` and `service-detail-editorial-v1` to
repository-owned deterministic render functions.

## Structured schema and component library

`packages/site-schema` contains strict Zod contracts for:

- immutable site and page snapshots;
- theme tokens and navigation;
- public business, location, service, and staff profiles;
- published assets;
- metadata and render context;
- structured actions; and
- the complete Phase 15.5 discriminated section union.

Rich text is an AST of paragraphs, H2–H4 headings, lists, text, strong,
emphasis, internal links, and line breaks. It has no raw-HTML node. Unknown
section, rich-text, or action types fail validation.

`packages/site-components` implements the controlled semantic component set.
All tenant text and attributes are escaped. HTML is assembled only by
compile-time functions returning branded `SafeHtml`; snapshots cannot supply
markup, CSS classes, scripts, component names, or module paths. Mobile
navigation uses native `details`/`summary`, all links are keyboard reachable,
focus is visible, and images carry validated dimensions and alt behaviour.

## Immutable read model

`site_render_snapshots` stores validated JSONB plus ownership-critical
relational columns:

- tenant, site, site version, and template version;
- `PREVIEW` or `PUBLISHED` kind;
- schema and hostname-configuration versions;
- immutable revision;
- SHA-256 content digest; and
- creation/publication timestamps.

`prepareSiteRenderSnapshotForStorage` validates the Zod schema and computes the
digest for controlled internal/test flows. The database insert trigger verifies
site/version ownership, approved template status, and published-version status.
Update and delete triggers make every stored snapshot immutable.

Ordinary public traffic reads only the `PUBLISHED` snapshot referenced by
`sites.published_version_id`. Preview reads use an exact site/version reference
after token verification and may load an immutable `PREVIEW` snapshot. Mutable
`site_sections.content_json` is never rendered directly.

The new tables have RLS enabled. `anon` and `authenticated` receive no grants;
`service_role` receives only the operations required by controlled server
flows. Snapshot and token-revocation records cannot be updated or deleted.

## Canonical domains

The active primary domain inside the validated snapshot supplies the canonical
origin. A secondary active hostname redirects with `302` only when both the
current and destination domains are present and active. Equality checks prevent
loops. Inactive or unsafe domain state never becomes a redirect target.

This phase does not provision a domain, modify DNS, request TLS, or mark a
domain active.

## Native booking

Every primary booking action renders as a local `/book` URL. The route:

1. resolves the site from the hostname;
2. parses only `service`, `location`, `staff`, and `campaign`;
3. validates public references against the current tenant's published snapshot;
4. rejects duplicate/unknown parameters and arbitrary redirect targets; and
5. uses the existing `resolveKsOsBookingUrl` contract with
   `PUBLIC_BOOKING_ORIGIN`.

The response is a no-store `302` to the native KS OS booking application.
Operational tenant IDs and arbitrary external booking URLs are never included.

## Preview security

Preview tokens use a dedicated HMAC-SHA-256 secret and a versioned domain
separator. Payloads are strict and contain:

- issuer and audience;
- random token ID;
- site and version public references;
- agency/client review purpose;
- issued-at and expiration times.

Verification uses a timing-safe signature comparison, a maximum 24-hour
lifetime, exact site/version binding, and the append-only
`site_preview_token_revocations` table. Preview output has a clear banner,
`noindex, nofollow`, and `Cache-Control: private, no-store`. Tokens are not
logged. `PUBLIC_SITES_PREVIEW_HOST` can constrain previews to a dedicated host.

No public token-generation route exists. Agency token creation and its mutation
audit remain part of a controlled authenticated workflow, not the public
renderer.

## Metadata and structured data

Every page renders title, description, canonical URL, robots directives, Open
Graph fields, Twitter card, language, viewport, and theme colour. Values are
escaped.

JSON-LD is generated from visible, validated tenant data. Initial output covers
`WebSite`, `Organization`, `LocalBusiness`, `WebPage`, `Service`,
`BreadcrumbList`, and visible `FAQPage` content. Stored arbitrary JSON-LD is
never rendered. Serialization escapes `<`, `>`, `&`, and script-breaking Unicode
characters. Ratings, reviews, prices, qualifications, and addresses are never
fabricated.

## Sitemap, robots, status, and caching

`/sitemap.xml` includes only active, canonical, indexable pages from a published
snapshot on its primary hostname. Booking, preview, health, API, framework, and
other reserved routes are excluded.

`/robots.txt` references that tenant's sitemap for a live site. Unknown,
suspended, unavailable, and preview contexts disallow all crawling.

Status behaviour:

- `LIVE` serves the immutable published snapshot.
- `PUBLISHING` and `PUBLISH_FAILED` keep serving the previous published pointer.
- `SUSPENDED` returns a generic `503` unavailable page.
- `ARCHIVED` returns a generic `410`.
- draft/review states are public `404`s and require signed preview.

Published pages use short public/shared caching with stale-while-revalidate.
Preview and booking responses are no-store. Errors use no-store or a very short
shared lifetime. Provider-specific cache invalidation is deferred.

## Asset and content safety

Snapshots accept only published image assets using credential-free HTTPS URLs
and an allowlisted image MIME type. Width and height are mandatory. Informative
images require alt text; decorative images require empty alt text. Optional
responsive variants remain structured. Local paths, data URLs, JavaScript URLs,
private storage credentials, Envato archives, and licence evidence are not
renderable.

Only explicitly public contact fields are in the snapshot. Customer records,
medical/form data, internal staff contact details, agency notes, secrets, and
provider credentials are absent from the schema.

## Environment placeholders

```text
PUBLIC_SITES_FALLBACK_DOMAIN=
PUBLIC_SITES_PREVIEW_HOST=
PUBLIC_BOOKING_ORIGIN=
SITE_PREVIEW_TOKEN_SECRET=
```

All are server-side. No real credentials are stored in the repository.

## Deferred work

Phase 15.6 and later work remains deferred: AI copy/images, the site worker,
image optimisation, Site Studio and client editing, publication controls,
provider deployment adapters/APIs, DNS and TLS automation, analytics providers,
Search Console, recurring SEO generation, and external booking systems.
