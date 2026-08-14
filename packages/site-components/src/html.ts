import type {
  PublishedPageSnapshot,
  PublishedSiteSnapshot,
  RichTextDocument,
  RichTextInline,
  SiteAction,
  SiteAssetReference,
} from '@ks-os/site-schema';
import type { KsOsWaitlistAction } from '@ks-os/contracts';
import type {
  GovernedRecommendation,
  PublicLiveSiteData,
} from '@ks-os/live-site-intelligence';

declare const safeHtmlBrand: unique symbol;
export type SafeHtml = string & { readonly [safeHtmlBrand]: true };

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function html(strings: TemplateStringsArray, ...values: ReadonlyArray<string | SafeHtml>): SafeHtml {
  return strings.reduce(
    (output, part, index) => `${output}${part}${values[index] ?? ''}`,
    '',
  ) as SafeHtml;
}

export interface ComponentRenderContext {
  snapshot: PublishedSiteSnapshot;
  page: PublishedPageSnapshot;
  pagePathByReference: Readonly<Record<string, string>>;
  /** Server-resolved, anonymous-safe operational facts. Never contains PERSONAL data. */
  live?: PublicLiveSiteData;
  /** Exact internal-link recommendations pinned to this site version. */
  recommendations?: readonly GovernedRecommendation[];
}

function queryValue(value: string) {
  return encodeURIComponent(value);
}

function contextualBookingAction(
  action: Extract<SiteAction, { type: 'KS_OS_BOOKING' }>,
  context: ComponentRenderContext,
) {
  const service = context.page.sections.find(section => section.type === 'SERVICE_DETAILS');
  const staff = context.page.sections.find(section => section.type === 'STAFF_PROFILE');
  const location = context.page.sections.find(section =>
    section.type === 'LOCATION' || section.type === 'OPENING_HOURS');
  return {
    ...action,
    serviceReference: action.serviceReference
      ?? (service?.type === 'SERVICE_DETAILS' ? service.serviceReference : undefined),
    staffReference: action.staffReference
      ?? (staff?.type === 'STAFF_PROFILE' ? staff.staffReference : undefined),
    locationReference: action.locationReference
      ?? (location && (location.type === 'LOCATION' || location.type === 'OPENING_HOURS')
        ? location.locationReference : undefined),
  };
}

export function actionHref(
  action: SiteAction | KsOsWaitlistAction,
  context: ComponentRenderContext,
): string {
  switch (action.type) {
    case 'KS_OS_BOOKING': {
      const resolved = contextualBookingAction(action, context);
      const query: string[] = [];
      if (resolved.serviceReference) query.push(`service=${queryValue(resolved.serviceReference)}`);
      if (resolved.locationReference) query.push(`location=${queryValue(resolved.locationReference)}`);
      if (resolved.staffReference) query.push(`staff=${queryValue(resolved.staffReference)}`);
      if (resolved.campaignReference) query.push(`campaign=${queryValue(resolved.campaignReference)}`);
      return `/book${query.length ? `?${query.join('&')}` : ''}`;
    }
    case 'KS_OS_WAITLIST': {
      const query = [`service=${queryValue(action.serviceReference)}`];
      if (action.locationReference) query.push(`location=${queryValue(action.locationReference)}`);
      if (action.staffReference) query.push(`staff=${queryValue(action.staffReference)}`);
      if (action.campaignReference) query.push(`campaign=${queryValue(action.campaignReference)}`);
      return `/waitlist?${query.join('&')}`;
    }
    case 'INTERNAL_PAGE': {
      const path = context.pagePathByReference[action.pageReference];
      if (!path) throw new Error('Internal actions may reference only the current site.');
      return path;
    }
    case 'PHONE':
      return `tel:${action.phoneNumber.replace(/[ ()-]/g, '')}`;
    case 'EMAIL':
      return `mailto:${action.emailAddress}`;
  }
}

export function renderAction(
  action: SiteAction,
  context: ComponentRenderContext,
  className = 'site-action',
): SafeHtml {
  if (action.type === 'KS_OS_BOOKING') {
    const resolved = contextualBookingAction(action, context);
    const liveAvailable = context.live && !context.live.telemetry.fallbackActivated;
    const liveService = resolved.serviceReference && liveAvailable
      ? context.live?.services.find(candidate => candidate.publicReference === resolved.serviceReference)
      : undefined;
    const serviceEligible = resolved.serviceReference
      ? liveAvailable
        ? liveService?.bookingEligible
        : context.snapshot.services.find(candidate => candidate.publicReference === resolved.serviceReference)?.bookingEnabled
      : true;
    const staffEligible = resolved.staffReference && liveAvailable
      ? context.live?.staff.find(candidate => candidate.publicReference === resolved.staffReference)?.bookingEligible
      : true;
    const locationEligible = resolved.locationReference && liveAvailable
      ? context.live?.locations.find(candidate => candidate.publicReference === resolved.locationReference)?.bookingEligible
      : true;
    if (serviceEligible === false || staffEligible === false || locationEligible === false) {
      if (serviceEligible === false && liveService?.waitlistEligible) {
        const waitlistAction: KsOsWaitlistAction = {
          type: 'KS_OS_WAITLIST',
          label: 'Join waitlist',
          serviceReference: resolved.serviceReference!,
          ...(resolved.locationReference ? { locationReference: resolved.locationReference } : {}),
          ...(resolved.staffReference ? { staffReference: resolved.staffReference } : {}),
          ...(resolved.campaignReference ? { campaignReference: resolved.campaignReference } : {}),
        };
        return html`<a class="${escapeHtml(className)} waitlist" href="${escapeHtml(actionHref(waitlistAction, context))}">${escapeHtml(waitlistAction.label)}</a>`;
      }
      return html`<span class="${escapeHtml(className)} unavailable" aria-disabled="true">Currently unavailable</span>`;
    }
  }
  const href = escapeHtml(actionHref(action, context));
  return html`<a class="${escapeHtml(className)}" href="${href}">${escapeHtml(action.label)}</a>`;
}

export function findAsset(
  snapshot: PublishedSiteSnapshot,
  reference: string,
): SiteAssetReference {
  const asset = snapshot.assets.find((candidate) => candidate.publicReference === reference);
  if (!asset) throw new Error('A section referenced an unpublished asset.');
  return asset;
}

export function renderImage(
  asset: SiteAssetReference,
  options: { eager?: boolean; className?: string } = {},
): SafeHtml {
  const srcset = asset.variants.length
    ? ` srcset="${escapeHtml(
      asset.variants
        .map((variant) => `${variant.url} ${variant.width}w`)
        .join(', '),
    )}"`
    : '';
  const loading = options.eager ? 'eager' : 'lazy';
  return html`<img${srcset} src="${escapeHtml(asset.url)}" width="${String(asset.width)}" height="${String(asset.height)}" alt="${escapeHtml(asset.alt)}" loading="${loading}" decoding="async" class="${escapeHtml(options.className ?? 'site-image')}">`;
}

function renderRichTextInline(
  node: RichTextInline,
  context: ComponentRenderContext,
): SafeHtml {
  switch (node.type) {
    case 'TEXT':
      return escapeHtml(node.text) as SafeHtml;
    case 'STRONG':
      return html`<strong>${node.children.map((child) => renderRichTextInline(child, context)).join('')}</strong>`;
    case 'EMPHASIS':
      return html`<em>${node.children.map((child) => renderRichTextInline(child, context)).join('')}</em>`;
    case 'INTERNAL_LINK': {
      const path = context.pagePathByReference[node.pageReference];
      if (!path) throw new Error('Rich text may link only to the current site.');
      return html`<a href="${escapeHtml(path)}">${node.children.map((child) => renderRichTextInline(child, context)).join('')}</a>`;
    }
    case 'LINE_BREAK':
      return '<br>' as SafeHtml;
  }
}

export function renderRichTextDocument(
  document: RichTextDocument,
  context: ComponentRenderContext,
): SafeHtml {
  return document.blocks.map((block) => {
    if (block.type === 'PARAGRAPH') {
      return html`<p>${block.children.map((node) => renderRichTextInline(node, context)).join('')}</p>`;
    }
    if (block.type === 'HEADING') {
      const tag = block.level.toLowerCase();
      return `<${tag}>${block.children.map((node) => renderRichTextInline(node, context)).join('')}</${tag}>` as SafeHtml;
    }
    const tag = block.type === 'ORDERED_LIST' ? 'ol' : 'ul';
    const items = block.items
      .map((item) => `<li>${item.children.map((node) => renderRichTextInline(node, context)).join('')}</li>`)
      .join('');
    return `<${tag}>${items}</${tag}>` as SafeHtml;
  }).join('') as SafeHtml;
}
