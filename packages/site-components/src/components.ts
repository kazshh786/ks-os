import type {
  PublishedSiteSnapshot,
  SiteSection,
} from '@ks-os/site-schema';
import {
  escapeHtml,
  findAsset,
  html,
  renderAction,
  renderImage,
  renderRichTextDocument,
  type ComponentRenderContext,
  type SafeHtml,
} from './html.js';
import { componentForSection } from './registry.js';

type SectionOf<Type extends SiteSection['type']> = Extract<SiteSection, { type: Type }>;

function sectionClass(section: SiteSection, component: string) {
  const registered = componentForSection(section);
  return `site-section ${component} component-${registered.componentKey}${section.variant ? ` variant-${section.variant}` : ''}`;
}

function pageHref(context: ComponentRenderContext, reference: string) {
  const path = context.pagePathByReference[reference];
  if (!path) throw new Error('Navigation may reference only the current site.');
  return path;
}

function flatNavigationItem(
  item: PublishedSiteSnapshot['navigation']['primary'][number],
  context: ComponentRenderContext,
): SafeHtml {
  return html`<li><a href="${escapeHtml(pageHref(context, item.pageReference))}">${escapeHtml(item.label)}</a></li>`;
}

function groupedNavigationItem(
  item: PublishedSiteSnapshot['navigation']['primary'][number],
  context: ComponentRenderContext,
  mobile = false,
): SafeHtml {
  if (!item.children.length) return flatNavigationItem(item, context);
  const children = [
    html`<li><a href="${escapeHtml(pageHref(context, item.pageReference))}">View ${escapeHtml(item.label)}</a></li>`,
    ...item.children.map(child => flatNavigationItem({ ...child, children: [] }, context)),
  ].join('');
  return html`<li class="navigation-group"><details><summary>${escapeHtml(item.label)}</summary><ul${mobile ? ' class="mobile-navigation-children"' : ''}>${children}</ul></details></li>`;
}

export function MobileNavigation(context: ComponentRenderContext): SafeHtml {
  const items = context.snapshot.navigation.primary
    .map((item) => groupedNavigationItem(item, context, true))
    .join('');
  return html`<details class="mobile-navigation"><summary aria-label="Open site navigation">Menu</summary><nav aria-label="Mobile navigation"><ul>${items}<li><a class="button primary mobile-booking" href="/book">Book now</a></li></ul></nav></details>`;
}

export function SiteHeader(
  section: SectionOf<'HEADER'>,
  context: ComponentRenderContext,
): SafeHtml {
  const logo = context.snapshot.business.logoAssetReference
    ? renderImage(findAsset(context.snapshot, context.snapshot.business.logoAssetReference), {
      eager: true,
      className: 'site-logo',
    })
    : escapeHtml(context.snapshot.business.name);
  const navigation = context.snapshot.navigation.primary
    .map((item) => groupedNavigationItem(item, context))
    .join('');
  return html`<header class="${sectionClass(section, 'site-header')}"><a class="brand" href="/" aria-label="${escapeHtml(context.snapshot.business.name)} home">${logo}</a><nav class="desktop-navigation" aria-label="Primary navigation"><ul>${navigation}</ul></nav>${MobileNavigation(context)}${renderAction(section.primaryAction, context, 'button primary header-booking')}</header>`;
}

export function AnnouncementBar(section: SectionOf<'ANNOUNCEMENT_BAR'>): SafeHtml {
  return html`<aside class="${sectionClass(section, 'announcement-bar')}" aria-label="Announcement">${escapeHtml(section.message)}</aside>`;
}

export function Hero(section: SectionOf<'HERO'>, context: ComponentRenderContext): SafeHtml {
  const image = section.imageAssetReference
    ? renderImage(findAsset(context.snapshot, section.imageAssetReference), {
      eager: true,
      className: 'hero-image',
    })
    : '';
  const secondary = section.secondaryAction
    ? renderAction(section.secondaryAction, context, 'button secondary')
    : '';
  return html`<section class="${sectionClass(section, 'hero')}"><div class="section-copy">${section.eyebrow ? `<p class="eyebrow">${escapeHtml(section.eyebrow)}</p>` : ''}<h1>${escapeHtml(section.heading)}</h1><p>${escapeHtml(section.body)}</p><div class="action-row">${renderAction(section.primaryAction, context, 'button primary hero-booking')}${secondary}</div></div>${image}</section>`;
}

export function Introduction(
  section: SectionOf<'INTRODUCTION'>,
  context: ComponentRenderContext,
): SafeHtml {
  const image = section.imageAssetReference
    ? renderImage(findAsset(context.snapshot, section.imageAssetReference))
    : '';
  const points = section.supportingPoints?.length
    ? `<ul class="introduction-points">${section.supportingPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>`
    : '';
  return html`<section class="${sectionClass(section, 'introduction')}"><div><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p>${points}</div>${image}</section>`;
}

function serviceCards(
  references: readonly string[],
  context: ComponentRenderContext,
): SafeHtml {
  return references.map((reference) => {
    const service = context.snapshot.services.find((entry) => entry.publicReference === reference);
    if (!service) throw new Error('A section referenced an unpublished service.');
    const image = service.imageAssetReference
      ? renderImage(findAsset(context.snapshot, service.imageAssetReference))
      : '';
    const action = {
      type: 'KS_OS_BOOKING' as const,
      label: `Book ${service.name}`,
      serviceReference: service.publicReference,
    };
    return html`<article class="service-card">${image}<h3>${escapeHtml(service.name)}</h3><p>${escapeHtml(service.shortDescription)}</p>${service.priceText ? `<p class="price">${escapeHtml(service.priceText)}</p>` : ''}${renderAction(action, context, 'text-link')}</article>`;
  }).join('') as SafeHtml;
}

export function FeaturedServices(
  section: SectionOf<'FEATURED_SERVICES'>,
  context: ComponentRenderContext,
): SafeHtml {
  return html`<section class="${sectionClass(section, 'featured-services')}"><h2>${escapeHtml(section.heading)}</h2><div class="card-grid">${serviceCards(section.serviceReferences, context)}</div></section>`;
}

export function ServiceGrid(
  section: SectionOf<'SERVICE_GRID'>,
  context: ComponentRenderContext,
): SafeHtml {
  return html`<section class="${sectionClass(section, 'service-grid')}"><h2>${escapeHtml(section.heading)}</h2><div class="card-grid">${serviceCards(section.serviceReferences, context)}</div></section>`;
}

export function ServiceDetails(
  section: SectionOf<'SERVICE_DETAILS'>,
  context: ComponentRenderContext,
): SafeHtml {
  const service = context.snapshot.services.find(
    (entry) => entry.publicReference === section.serviceReference,
  );
  if (!service) throw new Error('Service details referenced an unpublished service.');
  const image = section.imageAssetReference
    ? renderImage(findAsset(context.snapshot, section.imageAssetReference), {
      className: 'service-detail-image',
    })
    : '';
  return html`<section class="${sectionClass(section, 'service-details')}">${image}<div><p class="eyebrow">${escapeHtml(service.name)}</p><h1>${escapeHtml(section.heading)}</h1><p>${escapeHtml(section.body)}</p>${service.durationMinutes ? `<p>${String(service.durationMinutes)} minutes</p>` : ''}${service.priceText ? `<p class="price">${escapeHtml(service.priceText)}</p>` : ''}${renderAction(section.primaryAction, context, 'button primary service-booking')}</div></section>`;
}

export function Benefits(
  section: SectionOf<'BENEFITS'>,
  context: ComponentRenderContext,
): SafeHtml {
  const items = section.items
    .map((item) => html`<li><h3>${escapeHtml(item.heading)}</h3><p>${escapeHtml(item.body)}</p></li>`)
    .join('');
  const image = section.imageAssetReference
    ? renderImage(findAsset(context.snapshot, section.imageAssetReference))
    : '';
  return html`<section class="${sectionClass(section, 'benefits')}"><h2>${escapeHtml(section.heading)}</h2>${image}<ul class="feature-grid">${items}</ul></section>`;
}

export function Process(
  section: SectionOf<'PROCESS'>,
  context: ComponentRenderContext,
): SafeHtml {
  const steps = section.steps
    .map((step, index) => html`<li><span aria-hidden="true">${String(index + 1)}</span><h3>${escapeHtml(step.heading)}</h3><p>${escapeHtml(step.body)}</p></li>`)
    .join('');
  const image = section.imageAssetReference
    ? renderImage(findAsset(context.snapshot, section.imageAssetReference))
    : '';
  return html`<section class="${sectionClass(section, 'process')}"><h2>${escapeHtml(section.heading)}</h2>${image}<ol>${steps}</ol></section>`;
}

export function Pricing(section: SectionOf<'PRICING'>): SafeHtml {
  const items = section.items
    .map((item) => html`<li><div><h3>${escapeHtml(item.label)}</h3>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}</div><strong>${escapeHtml(item.priceText)}</strong></li>`)
    .join('');
  return html`<section class="${sectionClass(section, 'pricing')}"><h2>${escapeHtml(section.heading)}</h2><ul>${items}</ul></section>`;
}

export function TeamGrid(
  section: SectionOf<'TEAM'>,
  context: ComponentRenderContext,
): SafeHtml {
  const items = section.staffReferences.map((reference) => {
    const staff = context.snapshot.staff.find((entry) => entry.publicReference === reference);
    if (!staff) throw new Error('A section referenced an unpublished team member.');
    const image = staff.imageAssetReference
      ? renderImage(findAsset(context.snapshot, staff.imageAssetReference))
      : '';
    return html`<article>${image}<h3>${escapeHtml(staff.displayName)}</h3><p>${escapeHtml(staff.role)}</p></article>`;
  }).join('');
  return html`<section class="${sectionClass(section, 'team-grid')}"><h2>${escapeHtml(section.heading)}</h2><div class="card-grid">${items}</div></section>`;
}

export function StaffProfile(
  section: SectionOf<'STAFF_PROFILE'>,
  context: ComponentRenderContext,
): SafeHtml {
  const staff = context.snapshot.staff.find(
    (entry) => entry.publicReference === section.staffReference,
  );
  if (!staff) throw new Error('Staff profile referenced an unpublished team member.');
  const image = staff.imageAssetReference
    ? renderImage(findAsset(context.snapshot, staff.imageAssetReference))
    : '';
  const action = section.primaryAction
    ? renderAction(section.primaryAction, context, 'button primary')
    : '';
  const services = staff.serviceReferences.map((reference) => {
    const service = context.snapshot.services.find(candidate => candidate.publicReference === reference);
    if (!service) throw new Error('A staff profile referenced an unpublished service.');
    return `<li>${escapeHtml(service.name)}</li>`;
  }).join('');
  return html`<section class="${sectionClass(section, 'staff-profile')}">${image}<div><h1>${escapeHtml(staff.displayName)}</h1><p class="eyebrow">${escapeHtml(staff.role)}</p>${staff.biography ? `<p>${escapeHtml(staff.biography)}</p>` : ''}${services ? `<ul class="profile-services" aria-label="Services">${services}</ul>` : ''}${action}</div></section>`;
}

export function Gallery(section: SectionOf<'GALLERY'>, context: ComponentRenderContext): SafeHtml {
  const images = section.assetReferences
    .map((reference) => renderImage(findAsset(context.snapshot, reference)))
    .join('');
  return html`<section class="${sectionClass(section, 'gallery')}"><h2>${escapeHtml(section.heading)}</h2><div class="image-grid">${images}</div></section>`;
}

export function ResultsGallery(
  section: SectionOf<'RESULTS'>,
  context: ComponentRenderContext,
): SafeHtml {
  const figures = section.items.map((item) => {
    const before = item.beforeAssetReference
      ? renderImage(findAsset(context.snapshot, item.beforeAssetReference))
      : '';
    const after = renderImage(findAsset(context.snapshot, item.afterAssetReference));
    return html`<figure><div class="result-pair">${before}${after}</div>${item.caption ? `<figcaption>${escapeHtml(item.caption)}</figcaption>` : ''}</figure>`;
  }).join('');
  return html`<section class="${sectionClass(section, 'results-gallery')}"><h2>${escapeHtml(section.heading)}</h2><div class="image-grid">${figures}</div></section>`;
}

export function Testimonials(section: SectionOf<'TESTIMONIALS'>): SafeHtml {
  const items = section.items
    .map((item) => html`<figure><blockquote>${escapeHtml(item.quote)}</blockquote><figcaption>${escapeHtml(item.attribution)}</figcaption></figure>`)
    .join('');
  return html`<section class="${sectionClass(section, 'testimonials')}"><h2>${escapeHtml(section.heading)}</h2><div class="card-grid">${items}</div></section>`;
}

export function TrustIndicators(section: SectionOf<'TRUST_INDICATORS'>): SafeHtml {
  const items = section.items
    .map((item) => html`<li><strong>${escapeHtml(item.label)}</strong>${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ''}</li>`)
    .join('');
  return html`<section class="${sectionClass(section, 'trust-indicators')}">${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ''}<ul>${items}</ul></section>`;
}

export function FAQ(section: SectionOf<'FAQ'>): SafeHtml {
  const items = section.items
    .map((item) => html`<details><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`)
    .join('');
  return html`<section class="${sectionClass(section, 'faq')}"><h2>${escapeHtml(section.heading)}</h2>${items}</section>`;
}

function requireLocation(snapshot: PublishedSiteSnapshot, reference: string) {
  const location = snapshot.locations.find((entry) => entry.publicReference === reference);
  if (!location) throw new Error('A section referenced an unpublished location.');
  return location;
}

export function LocationDetails(
  section: SectionOf<'LOCATION'>,
  context: ComponentRenderContext,
): SafeHtml {
  const location = requireLocation(context.snapshot, section.locationReference);
  const address = [...location.addressLines, location.locality, location.region, location.postalCode]
    .filter(Boolean)
    .map((line) => escapeHtml(String(line)))
    .join('<br>');
  const image = section.imageAssetReference
    ? renderImage(findAsset(context.snapshot, section.imageAssetReference))
    : '';
  return html`<section class="${sectionClass(section, 'location-details')}"><div><h2>${escapeHtml(section.heading)}</h2><h3>${escapeHtml(location.name)}</h3><address>${address}</address></div>${image}</section>`;
}

export function OpeningHours(
  section: SectionOf<'OPENING_HOURS'>,
  context: ComponentRenderContext,
): SafeHtml {
  const location = requireLocation(context.snapshot, section.locationReference);
  const rows = location.openingHours.map((hours) => {
    const value = hours.opens && hours.closes ? `${hours.opens}–${hours.closes}` : 'Closed';
    return html`<tr><th scope="row">${escapeHtml(hours.day.toLowerCase())}</th><td>${escapeHtml(value)}</td></tr>`;
  }).join('');
  const image = section.imageAssetReference
    ? renderImage(findAsset(context.snapshot, section.imageAssetReference))
    : '';
  return html`<section class="${sectionClass(section, 'opening-hours')}"><div><h2>${escapeHtml(section.heading)}</h2><table><tbody>${rows}</tbody></table></div>${image}</section>`;
}

export function ContactDetails(
  section: SectionOf<'CONTACT'>,
  context: ComponentRenderContext,
): SafeHtml {
  const actions = section.secondaryActions
    .map((action) => renderAction(action, context, 'text-link secondary'))
    .join('');
  const image = section.imageAssetReference
    ? renderImage(findAsset(context.snapshot, section.imageAssetReference))
    : '';
  const location = section.locationReference
    ? requireLocation(context.snapshot, section.locationReference)
    : null;
  const locationDetails = location
    ? `<address class="contact-location"><strong>${escapeHtml(location.name)}</strong>${[...location.addressLines, location.locality, location.region, location.postalCode].filter(Boolean).map(line => `<span>${escapeHtml(String(line))}</span>`).join('')}${location.publicTelephone ? `<a href="tel:${escapeHtml(location.publicTelephone)}">${escapeHtml(location.publicTelephone)}</a>` : ''}</address>`
    : '';
  return html`<section class="${sectionClass(section, 'contact-details')}"><div><h2>${escapeHtml(section.heading)}</h2>${section.body ? `<p>${escapeHtml(section.body)}</p>` : ''}<div class="action-row">${actions}</div></div>${locationDetails}${image}</section>`;
}

export function BookingCallToAction(
  section: SectionOf<'BOOKING_CTA'> | SectionOf<'FINAL_CTA'>,
  context: ComponentRenderContext,
): SafeHtml {
  const image = section.imageAssetReference
    ? renderImage(findAsset(context.snapshot, section.imageAssetReference))
    : '';
  return html`<section class="${sectionClass(section, 'booking-call-to-action')}"><div><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p>${renderAction(section.primaryAction, context, 'button primary final-booking')}</div>${image}</section>`;
}

export function SiteFooter(
  section: SectionOf<'FOOTER'>,
  context: ComponentRenderContext,
): SafeHtml {
  const links = context.snapshot.navigation.footer
    .map((item) => flatNavigationItem(item, context))
    .join('');
  const utility = context.snapshot.navigation.utility
    .map((item) => flatNavigationItem(item, context))
    .join('');
  const legal = context.snapshot.navigation.legal
    .map((item) => flatNavigationItem(item, context))
    .join('');
  return html`<footer class="${sectionClass(section, 'site-footer')}"><div><strong>${escapeHtml(context.snapshot.business.name)}</strong>${section.legalText ? `<p>${escapeHtml(section.legalText)}</p>` : ''}</div><nav aria-label="Footer navigation"><ul>${links}</ul></nav>${utility ? `<nav aria-label="Utility navigation"><ul>${utility}</ul></nav>` : ''}${legal ? `<nav aria-label="Legal navigation"><ul>${legal}</ul></nav>` : ''}${renderAction(section.primaryAction, context, 'button primary footer-booking')}</footer>`;
}

export function RichText(
  section: SectionOf<'RICH_TEXT'>,
  context: ComponentRenderContext,
): SafeHtml {
  return html`<section class="${sectionClass(section, 'rich-text')}">${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ''}${renderRichTextDocument(section.document, context)}</section>`;
}

export function NotFound(siteName = 'This website'): SafeHtml {
  return html`<main class="system-state"><p class="eyebrow">404</p><h1>Page not found</h1><p>${escapeHtml(siteName)} does not have a page at this address.</p><a class="button primary" href="/">Return home</a></main>`;
}

export function SiteUnavailable(): SafeHtml {
  return html`<main class="system-state"><p class="eyebrow">Temporarily unavailable</p><h1>This website is unavailable</h1><p>Please try again later.</p></main>`;
}

function renderSectionContent(
  section: SiteSection,
  context: ComponentRenderContext,
): SafeHtml {
  switch (section.type) {
    case 'HEADER': return SiteHeader(section, context);
    case 'ANNOUNCEMENT_BAR': return AnnouncementBar(section);
    case 'HERO': return Hero(section, context);
    case 'INTRODUCTION': return Introduction(section, context);
    case 'FEATURED_SERVICES': return FeaturedServices(section, context);
    case 'SERVICE_GRID': return ServiceGrid(section, context);
    case 'SERVICE_DETAILS': return ServiceDetails(section, context);
    case 'BENEFITS': return Benefits(section, context);
    case 'PROCESS': return Process(section, context);
    case 'PRICING': return Pricing(section);
    case 'TEAM': return TeamGrid(section, context);
    case 'STAFF_PROFILE': return StaffProfile(section, context);
    case 'GALLERY': return Gallery(section, context);
    case 'RESULTS': return ResultsGallery(section, context);
    case 'TESTIMONIALS': return Testimonials(section);
    case 'TRUST_INDICATORS': return TrustIndicators(section);
    case 'FAQ': return FAQ(section);
    case 'LOCATION': return LocationDetails(section, context);
    case 'OPENING_HOURS': return OpeningHours(section, context);
    case 'CONTACT': return ContactDetails(section, context);
    case 'BOOKING_CTA':
    case 'FINAL_CTA': return BookingCallToAction(section, context);
    case 'FOOTER': return SiteFooter(section, context);
    case 'RICH_TEXT': return RichText(section, context);
  }
}

function hasApprovedMedia(section: SiteSection, context: ComponentRenderContext) {
  if ('imageAssetReference' in section && section.imageAssetReference) return true;
  if ('assetReferences' in section && section.assetReferences.length) return true;
  if (section.type === 'RESULTS' && section.items.length) return true;
  if (section.type === 'TEAM') {
    return section.staffReferences.some(reference =>
      Boolean(context.snapshot.staff.find(staff => staff.publicReference === reference)?.imageAssetReference));
  }
  if (section.type === 'STAFF_PROFILE') {
    return Boolean(context.snapshot.staff.find(staff =>
      staff.publicReference === section.staffReference)?.imageAssetReference);
  }
  if (section.type === 'FEATURED_SERVICES' || section.type === 'SERVICE_GRID') {
    return section.serviceReferences.some(reference =>
      Boolean(context.snapshot.services.find(service => service.publicReference === reference)?.imageAssetReference));
  }
  return false;
}

function placeholderCode(section: SiteSection) {
  if (section.type === 'STAFF_PROFILE' || section.type === 'TEAM') return 'STAFF_PORTRAIT_REQUIRED';
  if (section.type === 'LOCATION' || section.type === 'OPENING_HOURS' || section.type === 'CONTACT') return 'LOCATION_IMAGE_REQUIRED';
  if (section.type === 'GALLERY') return 'GALLERY_ASSET_REQUIRED';
  if (section.type === 'RESULTS') return 'RESULT_ASSET_REQUIRED';
  if (section.type === 'SERVICE_DETAILS' || section.type === 'FEATURED_SERVICES' || section.type === 'SERVICE_GRID') return 'SERVICE_IMAGE_REQUIRED';
  return 'BRAND_IMAGE_REQUIRED';
}

export function renderSection(
  section: SiteSection,
  context: ComponentRenderContext,
): SafeHtml {
  // Resolve first so unknown, disabled or page-incompatible AI choices never
  // reach executable markup. V1 sections without a componentKey use the
  // deterministic legacy type/variant mapping in the registry.
  const component = componentForSection(section, context.page);
  const rendered = renderSectionContent(section, context);
  if (!component.requiredAssetSlots.length || hasApprovedMedia(section, context)) return rendered;
  if (context.snapshot.visibility !== 'PREVIEW') {
    throw new Error(`Published component ${component.componentKey} is missing an approved required asset.`);
  }
  const code = placeholderCode(section);
  return html`${rendered}<aside class="preview-asset-placeholder" data-finding="${code}" aria-label="Preview asset required"><strong>Visual placeholder</strong><span>${code.replaceAll('_', ' ').toLowerCase()}</span></aside>`;
}
