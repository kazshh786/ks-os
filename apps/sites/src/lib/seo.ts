import {
  RESERVED_PUBLIC_SITE_PATHS,
  SiteStructuredDataSchema,
  type PublishedPageSnapshot,
  type PublishedSiteSnapshot,
  type SiteStructuredData,
} from '@ks-os/site-schema';

function canonicalOrigin(snapshot: PublishedSiteSnapshot) {
  return `https://${snapshot.canonicalHostname}`;
}

export function canonicalPageUrl(
  snapshot: PublishedSiteSnapshot,
  page: PublishedPageSnapshot,
): string {
  return new URL(page.path, canonicalOrigin(snapshot)).toString();
}

export function generateSiteStructuredData(
  snapshot: PublishedSiteSnapshot,
  page: PublishedPageSnapshot,
): SiteStructuredData {
  const url = canonicalPageUrl(snapshot, page);
  const origin = canonicalOrigin(snapshot);
  const entries: SiteStructuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: snapshot.business.name,
      url: `${origin}/`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: snapshot.business.name,
      url: `${origin}/`,
      ...(snapshot.business.publicTelephone
        ? { telephone: snapshot.business.publicTelephone }
        : {}),
      ...(snapshot.business.publicEmail ? { email: snapshot.business.publicEmail } : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: page.title,
      description: page.seo.description,
      url,
    },
  ];

  const location = snapshot.locations[0];
  if (location) {
    entries.push({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: snapshot.business.name,
      url: `${origin}/`,
      ...(location.publicTelephone ? { telephone: location.publicTelephone } : {}),
      address: {
        '@type': 'PostalAddress',
        streetAddress: location.addressLines.join(', '),
        addressLocality: location.locality,
        ...(location.region ? { addressRegion: location.region } : {}),
        postalCode: location.postalCode,
        addressCountry: location.countryCode,
      },
    });
  }

  const serviceDetails = page.sections.find((section) => section.type === 'SERVICE_DETAILS');
  if (serviceDetails?.type === 'SERVICE_DETAILS') {
    const service = snapshot.services.find(
      (candidate) => candidate.publicReference === serviceDetails.serviceReference,
    );
    if (service) {
      entries.push({
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: service.name,
        description: service.shortDescription,
        url,
      });
    }
  }

  const faq = page.sections.find((section) => section.type === 'FAQ');
  if (faq?.type === 'FAQ') {
    entries.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.items.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    });
  }

  const pathParts = page.path.split('/').filter(Boolean);
  entries.push({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: `${origin}/`,
      },
      ...pathParts.map((part, index) => ({
        '@type': 'ListItem' as const,
        position: index + 2,
        name: index === pathParts.length - 1
          ? page.title
          : part.replaceAll('-', ' '),
        item: new URL(`/${pathParts.slice(0, index + 1).join('/')}`, origin).toString(),
      })),
    ],
  });

  return SiteStructuredDataSchema.parse(entries);
}

export function serializeStructuredData(data: SiteStructuredData): string {
  return JSON.stringify(SiteStructuredDataSchema.parse(data))
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function xmlEscape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function isReserved(path: string) {
  return [...RESERVED_PUBLIC_SITE_PATHS].some(
    (reserved) => path === reserved || path.startsWith(`${reserved}/`),
  );
}

export function generateTenantSitemap(snapshot: PublishedSiteSnapshot): string {
  const urls = snapshot.visibility === 'PUBLISHED'
    ? snapshot.pages
    .filter((page) =>
      page.active
      && page.indexable
      && page.seo.index
      && page.canonical
      && page.pageType !== 'BOOKING'
      && !isReserved(page.path),
    )
    .map((page) => `<url><loc>${xmlEscape(canonicalPageUrl(snapshot, page))}</loc></url>`)
    .join('')
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

export function generateTenantRobots(input: {
  snapshot?: PublishedSiteSnapshot;
  allowIndexing: boolean;
}): string {
  const hasIndexableContent = Boolean(input.snapshot?.pages.some(page =>
    page.active && page.indexable && page.seo.index && page.pageType !== 'BOOKING'));
  if (!input.allowIndexing || !input.snapshot || !hasIndexableContent) {
    return 'User-agent: *\nDisallow: /\n';
  }
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api',
    'Disallow: /site-preview',
    'Disallow: /health',
    `Sitemap: https://${input.snapshot.canonicalHostname}/sitemap.xml`,
    '',
  ].join('\n');
}
