import type {
  PublishedPageSnapshot,
  PublishedSiteSnapshot,
  SiteStructuredData,
} from './contracts.js';

export interface StructuredDataContentFinding {
  code: 'STRUCTURED_DATA_CONTENT_MISMATCH' | 'SCHEMA_TYPE_INAPPROPRIATE';
  schemaType: NonNullable<PublishedPageSnapshot['structuredDataEligibility']>[number];
  message: string;
}

const ARTICLE_PAGE_TYPES = new Set([
  'ARTICLE',
  'GUIDE',
  'HOW_TO',
  'FAQ_RESOURCE',
  'TUTORIAL',
  'DEFINITION',
  'TROUBLESHOOTING',
  'COMPARISON',
  'CASE_STUDY',
]);

export function visiblePageAssetReferences(
  snapshot: PublishedSiteSnapshot,
  page: PublishedPageSnapshot,
): Set<string> {
  const references = new Set<string>();
  if (page.video?.thumbnailAssetReference) references.add(page.video.thumbnailAssetReference);
  for (const section of page.sections) {
    if ('imageAssetReference' in section && section.imageAssetReference) {
      references.add(section.imageAssetReference);
    }
    if (section.type === 'GALLERY') {
      section.assetReferences.forEach(reference => references.add(reference));
    }
    if (section.type === 'RESULTS') {
      section.items.forEach(item => {
        if (item.beforeAssetReference) references.add(item.beforeAssetReference);
        references.add(item.afterAssetReference);
      });
    }
    if (section.type === 'STAFF_PROFILE') {
      const staff = snapshot.staff.find(candidate => candidate.publicReference === section.staffReference);
      if (staff?.imageAssetReference) references.add(staff.imageAssetReference);
    }
    if (section.type === 'TEAM') {
      for (const staffReference of section.staffReferences) {
        const staff = snapshot.staff.find(candidate => candidate.publicReference === staffReference);
        if (staff?.imageAssetReference) references.add(staff.imageAssetReference);
      }
    }
    if (section.type === 'SERVICE_DETAILS') {
      const service = snapshot.services.find(candidate => candidate.publicReference === section.serviceReference);
      if (service?.imageAssetReference) references.add(service.imageAssetReference);
    }
  }
  return references;
}

export function visiblePageLocationReferences(page: PublishedPageSnapshot): Set<string> {
  return new Set(page.sections.flatMap(section => {
    if (section.type === 'LOCATION' || section.type === 'OPENING_HOURS') {
      return [section.locationReference];
    }
    if (section.type === 'CONTACT' && section.locationReference) {
      return [section.locationReference];
    }
    return [];
  }));
}

export function validateStructuredDataContentAgreement(
  snapshot: PublishedSiteSnapshot,
  page: PublishedPageSnapshot,
): StructuredDataContentFinding[] {
  const eligibility = page.structuredDataEligibility;
  if (!eligibility) return [];
  const findings: StructuredDataContentFinding[] = [];
  const mismatch = (
    schemaType: StructuredDataContentFinding['schemaType'],
    message: string,
  ) => findings.push({ code: 'STRUCTURED_DATA_CONTENT_MISMATCH', schemaType, message });
  const inappropriate = (
    schemaType: StructuredDataContentFinding['schemaType'],
    message: string,
  ) => findings.push({ code: 'SCHEMA_TYPE_INAPPROPRIATE', schemaType, message });

  for (const schemaType of eligibility) {
    if (schemaType === 'LOCAL_BUSINESS') {
      const references = visiblePageLocationReferences(page);
      if (![...references].some(reference => snapshot.locations.some(location => location.publicReference === reference))) {
        mismatch(schemaType, 'LocalBusiness requires a visible canonical location on this page.');
      }
    } else if (schemaType === 'SERVICE') {
      const section = page.sections.find(candidate => candidate.type === 'SERVICE_DETAILS');
      if (!section || section.type !== 'SERVICE_DETAILS'
        || !snapshot.services.some(service => service.publicReference === section.serviceReference)) {
        mismatch(schemaType, 'Service requires visible service details bound to a canonical service.');
      }
    } else if (schemaType === 'FAQ_PAGE') {
      if (!page.sections.some(section => section.type === 'FAQ')) {
        mismatch(schemaType, 'FAQPage requires visible FAQ questions and answers.');
      }
    } else if (schemaType === 'PERSON') {
      const staffSection = page.pageType === 'TEAM_DETAIL'
        ? page.sections.find(section => section.type === 'STAFF_PROFILE')
        : undefined;
      const staffProfileValid = staffSection?.type === 'STAFF_PROFILE'
        && snapshot.staff.some(staff => staff.publicReference === staffSection.staffReference);
      const authorshipPeople = [
        page.authorship?.author,
        page.authorship?.reviewer,
      ].filter((person): person is NonNullable<typeof person> => Boolean(person));
      const authorshipValid = authorshipPeople.length > 0
        && authorshipPeople.every(person => {
          const staff = snapshot.staff.find(candidate => candidate.publicReference === person.staffReference);
          return Boolean(staff
            && staff.displayName === person.name
            && (!person.role || staff.role === person.role)
            && (!person.bio || staff.biography === person.bio));
        });
      if (!staffProfileValid && !authorshipValid) {
        mismatch(schemaType, 'Person requires a visible staff profile or canonical visible authorship.');
      }
    } else if (schemaType === 'ARTICLE') {
      if (!ARTICLE_PAGE_TYPES.has(page.pageType) || !page.authorship || !page.lastModifiedAt) {
        inappropriate(schemaType, 'Article is limited to dated editorial pages with canonical authorship.');
      }
    } else if (schemaType === 'BLOG_POSTING') {
      if (page.pageType !== 'BLOG_POST' || !page.authorship || !page.lastModifiedAt) {
        inappropriate(schemaType, 'BlogPosting is limited to dated BLOG_POST pages with canonical authorship.');
      }
    } else if (schemaType === 'VIDEO_OBJECT') {
      if (!page.video
        || !snapshot.assets.some(asset => asset.publicReference === page.video?.thumbnailAssetReference)) {
        mismatch(schemaType, 'VideoObject requires visible video metadata and a canonical thumbnail asset.');
      }
    } else if (schemaType === 'IMAGE_OBJECT') {
      const visibleAssets = visiblePageAssetReferences(snapshot, page);
      if (!snapshot.assets.some(asset => visibleAssets.has(asset.publicReference) && asset.purpose === 'INFORMATIVE')) {
        mismatch(schemaType, 'ImageObject requires an informative asset visibly used by this page.');
      }
    }
  }
  return findings;
}

export function assertStructuredDataContentAgreement(
  snapshot: PublishedSiteSnapshot,
  page: PublishedPageSnapshot,
): void {
  const findings = validateStructuredDataContentAgreement(snapshot, page);
  if (findings.length) {
    throw new Error(findings.map(finding => `${finding.code}:${finding.schemaType}`).join(','));
  }
}

export function validateEmittedStructuredDataEligibility(
  snapshot: PublishedSiteSnapshot,
  page: PublishedPageSnapshot,
  data: SiteStructuredData,
): StructuredDataContentFinding[] {
  if (!page.structuredDataEligibility) return [];
  const allowed = new Set(page.structuredDataEligibility.map(type => type.replaceAll('_', '')));
  const visibleAssets = visiblePageAssetReferences(snapshot, page);
  const visibleLocations = visiblePageLocationReferences(page);
  const findings: StructuredDataContentFinding[] = [];
  const eligibilityType = (entry: SiteStructuredData[number]): StructuredDataContentFinding['schemaType'] =>
    entry['@type'] === 'BlogPosting' ? 'BLOG_POSTING'
      : entry['@type'] === 'FAQPage' ? 'FAQ_PAGE'
        : entry['@type'] === 'BreadcrumbList' ? 'BREADCRUMB_LIST'
          : entry['@type'] === 'LocalBusiness' ? 'LOCAL_BUSINESS'
            : entry['@type'] === 'VideoObject' ? 'VIDEO_OBJECT'
              : entry['@type'] === 'ImageObject' ? 'IMAGE_OBJECT'
                : entry['@type'] === 'WebSite' ? 'WEB_SITE'
                  : entry['@type'] === 'WebPage' ? 'WEB_PAGE'
                    : entry['@type'] as StructuredDataContentFinding['schemaType'];
  for (const entry of data) {
    const normalized = entry['@type'].toUpperCase();
    const schemaType = eligibilityType(entry);
    if (!allowed.has(normalized)) {
      findings.push({
        code: 'SCHEMA_TYPE_INAPPROPRIATE',
        schemaType,
        message: `${entry['@type']} was emitted outside the immutable page allowlist.`,
      });
      continue;
    }
    if (entry['@type'] === 'FAQPage') {
      const faq = page.sections.find(section => section.type === 'FAQ');
      const expected = faq?.type === 'FAQ'
        ? faq.items.map(item => ({ question: item.question, answer: item.answer }))
        : [];
      const actual = entry.mainEntity.map(item => ({
        question: item.name,
        answer: item.acceptedAnswer.text,
      }));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        findings.push({ code: 'STRUCTURED_DATA_CONTENT_MISMATCH', schemaType, message: 'FAQPage questions and answers must exactly match visible FAQ content.' });
      }
    } else if (entry['@type'] === 'Service') {
      const section = page.sections.find(candidate => candidate.type === 'SERVICE_DETAILS');
      const service = section?.type === 'SERVICE_DETAILS'
        ? snapshot.services.find(candidate => candidate.publicReference === section.serviceReference)
        : undefined;
      if (!service || entry.name !== service.name || entry.description !== service.shortDescription) {
        findings.push({ code: 'STRUCTURED_DATA_CONTENT_MISMATCH', schemaType, message: 'Service data must match the canonical service visibly represented by the page.' });
      }
    } else if (entry['@type'] === 'LocalBusiness') {
      const matches = snapshot.locations.some(location =>
        visibleLocations.has(location.publicReference)
        && entry.address.streetAddress === location.addressLines.join(', ')
        && entry.address.addressLocality === location.locality
        && entry.address.postalCode === location.postalCode
        && entry.address.addressCountry === location.countryCode);
      if (!matches) {
        findings.push({ code: 'STRUCTURED_DATA_CONTENT_MISMATCH', schemaType, message: 'LocalBusiness address must match a canonical location visibly represented by the page.' });
      }
    } else if (entry['@type'] === 'Person') {
      const staffSection = page.sections.find(section => section.type === 'STAFF_PROFILE');
      const visibleStaffNames = new Set([
        ...(staffSection?.type === 'STAFF_PROFILE'
          ? snapshot.staff.filter(staff => staff.publicReference === staffSection.staffReference).map(staff => staff.displayName)
          : []),
        ...(page.authorship ? [page.authorship.author.name] : []),
        ...(page.authorship?.reviewer ? [page.authorship.reviewer.name] : []),
      ]);
      if (!visibleStaffNames.has(entry.name)) {
        findings.push({ code: 'STRUCTURED_DATA_CONTENT_MISMATCH', schemaType, message: 'Person must identify staff or editorial provenance visibly represented by the page.' });
      }
    } else if (entry['@type'] === 'VideoObject') {
      const thumbnail = snapshot.assets.find(asset => asset.publicReference === page.video?.thumbnailAssetReference);
      if (!page.video || !thumbnail
        || entry.name !== page.video.name
        || entry.description !== page.video.description
        || entry.thumbnailUrl !== thumbnail.url) {
        findings.push({ code: 'STRUCTURED_DATA_CONTENT_MISMATCH', schemaType, message: 'VideoObject must match the governed video visibly associated with the page.' });
      }
    } else if (entry['@type'] === 'ImageObject') {
      if (!snapshot.assets.some(asset =>
        visibleAssets.has(asset.publicReference)
        && asset.purpose === 'INFORMATIVE'
        && asset.url === entry.contentUrl)) {
        findings.push({ code: 'STRUCTURED_DATA_CONTENT_MISMATCH', schemaType, message: 'ImageObject must match an informative image visibly used by the page.' });
      }
    } else if (entry['@type'] === 'Article' || entry['@type'] === 'BlogPosting') {
      const expectedType = page.pageType === 'BLOG_POST' ? 'BlogPosting' : 'Article';
      if (!page.authorship || entry['@type'] !== expectedType
        || entry.author.name !== page.authorship.author.name) {
        findings.push({ code: 'SCHEMA_TYPE_INAPPROPRIATE', schemaType, message: 'Editorial schema semantics and author must match the visible governed page.' });
      }
    }
  }
  return findings;
}
