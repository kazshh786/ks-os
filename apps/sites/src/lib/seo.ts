import {
  RESERVED_PUBLIC_SITE_PATHS,
  SiteStructuredDataSchema,
  assertStructuredDataContentAgreement,
  validateEmittedStructuredDataEligibility,
  visiblePageAssetReferences,
  visiblePageLocationReferences,
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
  assertStructuredDataContentAgreement(snapshot, page);
  const eligible = (type: NonNullable<PublishedPageSnapshot['structuredDataEligibility']>[number]) =>
    !page.structuredDataEligibility || page.structuredDataEligibility.includes(type);
  const entries: SiteStructuredData = [];
  if (eligible('WEB_SITE')) entries.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: snapshot.business.name,
      url: `${origin}/`,
  });
  if (eligible('ORGANIZATION')) entries.push({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: snapshot.business.name,
      url: `${origin}/`,
      ...(snapshot.business.publicTelephone
        ? { telephone: snapshot.business.publicTelephone }
        : {}),
      ...(snapshot.business.publicEmail ? { email: snapshot.business.publicEmail } : {}),
  });
  if (eligible('WEB_PAGE')) entries.push({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: page.title,
      description: page.seo.description,
      url,
  });

  const visibleLocationReferences = visiblePageLocationReferences(page);
  if (eligible('LOCAL_BUSINESS')) for (const location of snapshot.locations) {
    if (page.structuredDataEligibility
      && !visibleLocationReferences.has(location.publicReference)) continue;
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

  if (eligible('PERSON') && page.authorship) {
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
      ...(!page.structuredDataEligibility && page.authorship.author.credentials.length ? {
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
        ...(!page.structuredDataEligibility && page.authorship.reviewer.credentials.length ? {
          hasCredential: page.authorship.reviewer.credentials.map(credentialCategory => ({
            '@type': 'EducationalOccupationalCredential' as const,
            credentialCategory,
          })),
        } : {}),
      });
    }
  }

  const staffSection = page.pageType === 'TEAM_DETAIL'
    ? page.sections.find(section => section.type === 'STAFF_PROFILE')
    : undefined;
  if (eligible('PERSON') && staffSection?.type === 'STAFF_PROFILE') {
    const staff = snapshot.staff.find(candidate => candidate.publicReference === staffSection.staffReference);
    if (staff) {
      const image = staff.imageAssetReference
        ? snapshot.assets.find(asset => asset.publicReference === staff.imageAssetReference)?.url
        : undefined;
      entries.push({
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: staff.displayName,
        url,
        jobTitle: staff.role,
        ...(staff.biography ? { description: staff.biography } : {}),
        ...(image ? { image } : {}),
        worksFor: {
          '@type': 'Organization',
          name: snapshot.business.name,
          url: `${origin}/`,
        },
      });
    }
  }

  if (page.authorship) {
    const articleType = page.pageType === 'BLOG_POST' && eligible('BLOG_POSTING')
      ? 'BlogPosting' as const
      : eligible('ARTICLE')
        && ['ARTICLE', 'GUIDE', 'HOW_TO', 'FAQ_RESOURCE', 'TUTORIAL', 'DEFINITION', 'TROUBLESHOOTING', 'COMPARISON', 'CASE_STUDY'].includes(page.pageType)
          ? 'Article' as const
          : null;
    if (articleType && page.lastModifiedAt) {
      const authorUrl = page.authorship.author.profilePath
        ? new URL(page.authorship.author.profilePath, origin).toString()
        : undefined;
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

  if (eligible('VIDEO_OBJECT') && page.video) {
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

  const usedAssetReferences = visiblePageAssetReferences(snapshot, page);
  if (eligible('IMAGE_OBJECT')) for (const asset of snapshot.assets) {
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
  if (eligible('SERVICE') && serviceDetails?.type === 'SERVICE_DETAILS') {
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
  if (eligible('FAQ_PAGE') && faq?.type === 'FAQ') {
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
  if (eligible('BREADCRUMB_LIST')) entries.push({
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

  const parsed = SiteStructuredDataSchema.parse(entries);
  const eligibilityFindings = validateEmittedStructuredDataEligibility(snapshot, page, parsed);
  if (eligibilityFindings.length) {
    throw new Error(eligibilityFindings.map(finding => `${finding.code}:${finding.schemaType}`).join(','));
  }
  return parsed;
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
  const sitemapPages = snapshot.visibility === 'PUBLISHED'
    ? snapshot.pages.filter((page) =>
      page.active
      && page.indexable
      && page.seo.index
      && page.canonical
      && page.pageType !== 'BOOKING'
      && !isReserved(page.path),
    )
    : [];
  // x-default remains intentionally unsupported until it is represented by a
  // real governed alternate rather than inferred by the renderer.
  const hasLanguageAlternates = sitemapPages.some(page =>
    (page.languageAlternates?.length ?? 0) > 0);
  const urls = sitemapPages.map((page) => {
    const alternates = page.languageAlternates?.length
      ? [
        { languageCode: page.languageCode ?? snapshot.language, path: page.path },
        ...page.languageAlternates,
      ].map(alternate => `<xhtml:link rel="alternate" hreflang="${xmlEscape(alternate.languageCode)}" href="${xmlEscape(new URL(alternate.path, canonicalOrigin(snapshot)).toString())}"/>`).join('')
      : '';
    const lastModified = page.lastModifiedAt ?? snapshot.publishedAt ?? snapshot.createdAt;
    return `<url><loc>${xmlEscape(canonicalPageUrl(snapshot, page))}</loc><lastmod>${xmlEscape(lastModified)}</lastmod>${alternates}</url>`;
  })
    .join('');
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
