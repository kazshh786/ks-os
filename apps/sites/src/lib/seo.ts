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

  for (const location of snapshot.locations) {
    const locationPage = snapshot.pages.find(candidate => candidate.sections.some(section =>
      (section.type === 'LOCATION' || section.type === 'OPENING_HOURS')
      && section.locationReference === location.publicReference));
    entries.push({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: snapshot.business.name,
      url: locationPage ? canonicalPageUrl(snapshot, locationPage) : `${origin}/#location-${location.publicReference}`,
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

  if (page.authorship) {
    const authorUrl = page.authorship.author.profilePath
      ? new URL(page.authorship.author.profilePath, origin).toString()
      : undefined;
    entries.push({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: page.authorship.author.name,
      ...(authorUrl ? { url: authorUrl } : {}),
      ...(page.authorship.author.role ? { jobTitle: page.authorship.author.role } : {}),
      ...(page.authorship.author.bio ? { description: page.authorship.author.bio } : {}),
      ...(page.authorship.author.credentials.length ? {
        hasCredential: page.authorship.author.credentials.map(credentialCategory => ({
          '@type': 'EducationalOccupationalCredential' as const,
          credentialCategory,
        })),
      } : {}),
    });
    if (page.authorship.reviewer) {
      const reviewerUrl = page.authorship.reviewer.profilePath
        ? new URL(page.authorship.reviewer.profilePath, origin).toString()
        : undefined;
      entries.push({
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: page.authorship.reviewer.name,
        ...(reviewerUrl ? { url: reviewerUrl } : {}),
        ...(page.authorship.reviewer.role ? { jobTitle: page.authorship.reviewer.role } : {}),
        ...(page.authorship.reviewer.bio ? { description: page.authorship.reviewer.bio } : {}),
        ...(page.authorship.reviewer.credentials.length ? {
          hasCredential: page.authorship.reviewer.credentials.map(credentialCategory => ({
            '@type': 'EducationalOccupationalCredential' as const,
            credentialCategory,
          })),
        } : {}),
      });
    }
    const articleType = page.pageType === 'BLOG_POST'
      ? 'BlogPosting' as const
      : ['ARTICLE', 'GUIDE', 'HOW_TO', 'FAQ_RESOURCE', 'TUTORIAL', 'DEFINITION', 'TROUBLESHOOTING', 'COMPARISON', 'CASE_STUDY'].includes(page.pageType)
        ? 'Article' as const
        : null;
    if (articleType && page.lastModifiedAt) {
      entries.push({
        '@context': 'https://schema.org',
        '@type': articleType,
        headline: page.title,
        description: page.seo.description,
        url,
        ...(page.publishedAt ? { datePublished: page.publishedAt } : {}),
        dateModified: page.lastModifiedAt,
        ...(page.reviewedAt ? { lastReviewed: page.reviewedAt } : {}),
        author: {
          '@type': 'Person',
          name: page.authorship.author.name,
          ...(authorUrl ? { url: authorUrl } : {}),
        },
        ...(page.authorship.reviewer ? {
          reviewedBy: {
            '@type': 'Person' as const,
            name: page.authorship.reviewer.name,
            ...(page.authorship.reviewer.profilePath
              ? { url: new URL(page.authorship.reviewer.profilePath, origin).toString() }
              : {}),
          },
        } : {}),
      });
    }
  }

  if (page.video) {
    const thumbnail = snapshot.assets.find(asset => asset.publicReference === page.video!.thumbnailAssetReference);
    if (thumbnail) {
      entries.push({
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: page.video.name,
        description: page.video.description,
        thumbnailUrl: thumbnail.url,
        uploadDate: page.video.uploadDate,
        ...(page.video.contentUrl ? { contentUrl: page.video.contentUrl } : {}),
        ...(page.video.embedUrl ? { embedUrl: page.video.embedUrl } : {}),
        ...(page.video.transcript ? { transcript: page.video.transcript } : {}),
      });
    }
  }

  const usedAssetReferences = new Set<string>();
  if (page.seo.openGraphImageAssetReference) usedAssetReferences.add(page.seo.openGraphImageAssetReference);
  if (page.video?.thumbnailAssetReference) usedAssetReferences.add(page.video.thumbnailAssetReference);
  for (const section of page.sections) {
    if ('imageAssetReference' in section && section.imageAssetReference) usedAssetReferences.add(section.imageAssetReference);
    if (section.type === 'GALLERY') section.assetReferences.forEach(reference => usedAssetReferences.add(reference));
    if (section.type === 'RESULTS') section.items.forEach(item => {
      if (item.beforeAssetReference) usedAssetReferences.add(item.beforeAssetReference);
      usedAssetReferences.add(item.afterAssetReference);
    });
  }
  for (const asset of snapshot.assets) {
    if (!usedAssetReferences.has(asset.publicReference) || asset.purpose !== 'INFORMATIVE') continue;
    entries.push({
      '@context': 'https://schema.org',
      '@type': 'ImageObject',
      contentUrl: asset.url,
      width: asset.width,
      height: asset.height,
      ...(asset.caption ? { caption: asset.caption } : {}),
      ...(asset.creditText ? { creditText: asset.creditText } : {}),
      ...(asset.licenseUrl ? { license: asset.licenseUrl } : {}),
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
  const hasLanguageAlternates = snapshot.pages.some(page => (page.languageAlternates?.length ?? 0) > 0);
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
    .map((page) => {
      const alternates = [
        { languageCode: page.languageCode ?? snapshot.language, path: page.path },
        ...(page.languageAlternates ?? []),
      ].map(alternate => `<xhtml:link rel="alternate" hreflang="${xmlEscape(alternate.languageCode)}" href="${xmlEscape(new URL(alternate.path, canonicalOrigin(snapshot)).toString())}"/>`).join('');
      const lastModified = page.lastModifiedAt ?? snapshot.publishedAt ?? snapshot.createdAt;
      return `<url><loc>${xmlEscape(canonicalPageUrl(snapshot, page))}</loc><lastmod>${xmlEscape(lastModified)}</lastmod>${alternates}</url>`;
    })
    .join('')
    : '';
  const xhtml = hasLanguageAlternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : '';
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${xhtml}>${urls}</urlset>`;
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
