import {
  html,
  renderSection,
  type ComponentRenderContext,
  type SafeHtml,
} from '@ks-os/site-components';
import type {
  PublishedPageSnapshot,
  SitePageType,
} from '@ks-os/site-schema';

export interface RegisteredSiteRenderer {
  key: string;
  version: number;
  pageTypes: readonly SitePageType[];
  render: (
    page: PublishedPageSnapshot,
    context: ComponentRenderContext,
  ) => SafeHtml;
}

export class SiteRenderabilityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SiteRenderabilityError';
  }
}

function renderEditorial(
  page: PublishedPageSnapshot,
  context: ComponentRenderContext,
): SafeHtml {
  const sections = page.sections.map((section) => renderSection(section, context)).join('');
  return html`<div class="site-layout editorial-layout" data-renderer="${page.rendererKey}">${sections}</div>`;
}

function renderGrid(
  page: PublishedPageSnapshot,
  context: ComponentRenderContext,
): SafeHtml {
  const sections = page.sections.map((section) => renderSection(section, context)).join('');
  return html`<div class="site-layout grid-layout" data-renderer="${page.rendererKey}">${sections}</div>`;
}

function renderDocument(
  page: PublishedPageSnapshot,
  context: ComponentRenderContext,
): SafeHtml {
  const sections = page.sections.map((section) => renderSection(section, context)).join('');
  return html`<div class="site-layout document-layout" data-renderer="${page.rendererKey}">${sections}</div>`;
}

const renderers = {
  'home-editorial-v1': {
    key: 'home-editorial-v1',
    version: 1,
    pageTypes: ['HOME'],
    render: renderEditorial,
  },
  'service-hub-grid-v1': {
    key: 'service-hub-grid-v1',
    version: 1,
    pageTypes: ['SERVICE_HUB'],
    render: renderGrid,
  },
  'service-detail-editorial-v1': {
    key: 'service-detail-editorial-v1',
    version: 1,
    pageTypes: ['SERVICE_DETAIL'],
    render: renderEditorial,
  },
  'about-editorial-v1': {
    key: 'about-editorial-v1',
    version: 1,
    pageTypes: ['ABOUT'],
    render: renderEditorial,
  },
  'team-grid-v1': {
    key: 'team-grid-v1',
    version: 1,
    pageTypes: ['TEAM_HUB'],
    render: renderGrid,
  },
  'team-detail-v1': {
    key: 'team-detail-v1',
    version: 1,
    pageTypes: ['TEAM_DETAIL'],
    render: renderEditorial,
  },
  'location-detail-v1': {
    key: 'location-detail-v1',
    version: 1,
    pageTypes: ['LOCATION_HUB', 'LOCATION_DETAIL', 'CONTACT'],
    render: renderEditorial,
  },
  'contact-v1': {
    key: 'contact-v1',
    version: 1,
    pageTypes: ['CONTACT'],
    render: renderEditorial,
  },
  'faq-v1': {
    key: 'faq-v1',
    version: 1,
    pageTypes: ['FAQ'],
    render: renderDocument,
  },
  'results-grid-v1': {
    key: 'results-grid-v1',
    version: 1,
    pageTypes: ['RESULTS'],
    render: renderGrid,
  },
  'guide-editorial-v1': {
    key: 'guide-editorial-v1',
    version: 1,
    pageTypes: [
      'NEW_CLIENT_GUIDE', 'AFTERCARE_GUIDE', 'CONSULTATION_GUIDE', 'GUIDE',
      'HOW_TO', 'ARTICLE', 'BLOG_POST', 'FAQ_RESOURCE', 'TUTORIAL', 'DEFINITION',
      'TROUBLESHOOTING', 'COMPARISON', 'CASE_STUDY',
    ],
    render: renderDocument,
  },
  'policies-v1': {
    key: 'policies-v1',
    version: 1,
    pageTypes: ['POLICIES'],
    render: renderDocument,
  },
  'booking-v1': {
    key: 'booking-v1',
    version: 1,
    pageTypes: ['BOOKING'],
    render: renderEditorial,
  },
} as const satisfies Record<string, RegisteredSiteRenderer>;

export type RegisteredSiteRendererKey = keyof typeof renderers;

export function getSiteLayoutRenderer(
  rendererKey: string,
): RegisteredSiteRenderer | null {
  return Object.prototype.hasOwnProperty.call(renderers, rendererKey)
    ? renderers[rendererKey as RegisteredSiteRendererKey]
    : null;
}

export function hasSiteLayoutRenderer(rendererKey: string): boolean {
  return getSiteLayoutRenderer(rendererKey) !== null;
}

export function listRegisteredSiteRenderers(): ReadonlyArray<{
  key: string;
  version: number;
  pageTypes: readonly SitePageType[];
}> {
  return Object.values(renderers).map(({ key, version, pageTypes }) => ({
    key,
    version,
    pageTypes,
  }));
}

export function assertRendererCompatible(input: {
  page: PublishedPageSnapshot;
}): RegisteredSiteRenderer {
  const { page } = input;
  const renderer = getSiteLayoutRenderer(page.rendererKey);
  if (!renderer) {
    throw new SiteRenderabilityError(
      'SITE_RENDERER_UNKNOWN',
      'The page renderer is not registered.',
    );
  }
  if (page.rendererStatus !== 'READY' || page.layoutStatus === 'DISABLED') {
    throw new SiteRenderabilityError(
      'SITE_RENDERER_DISABLED',
      'The page renderer is not enabled.',
    );
  }
  if (page.templateVersionStatus !== 'APPROVED') {
    throw new SiteRenderabilityError(
      'SITE_TEMPLATE_VERSION_NOT_APPROVED',
      'The template version is not approved.',
    );
  }
  if (
    renderer.version !== page.rendererVersion
    || !renderer.pageTypes.includes(page.pageType)
    || !page.compatiblePageTypes.includes(page.pageType)
  ) {
    throw new SiteRenderabilityError(
      'SITE_RENDERER_PAGE_TYPE_INCOMPATIBLE',
      'The renderer is not compatible with this page type.',
    );
  }
  return renderer;
}

export function renderRegisteredSitePage(
  page: PublishedPageSnapshot,
  context: ComponentRenderContext,
): SafeHtml {
  return assertRendererCompatible({ page }).render(page, context);
}
