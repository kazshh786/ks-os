import {
  NotFound,
  SiteUnavailable,
  escapeHtml,
  type SafeHtml,
} from '@ks-os/site-components';
import type {
  PublishedPageSnapshot,
  PublishedSiteSnapshot,
  SiteStructuredData,
} from '@ks-os/site-schema';
import { canonicalPageUrl, serializeStructuredData } from './seo.js';
import { renderSiteThemePresentation } from './design-tokens.js';

function documentShell(input: {
  title: string;
  description: string;
  language?: string;
  body: SafeHtml;
  canonicalUrl?: string;
  robots: string;
  themeColour?: string;
  openGraph?: {
    title: string;
    description: string;
    url: string;
    image?: string;
  };
  structuredData?: SiteStructuredData;
  bodyStyle?: string;
  bodyAttributes?: string;
}): string {
  const canonical = input.canonicalUrl
    ? `<link rel="canonical" href="${escapeHtml(input.canonicalUrl)}">`
    : '';
  const openGraph = input.openGraph
    ? [
      `<meta property="og:type" content="website">`,
      `<meta property="og:title" content="${escapeHtml(input.openGraph.title)}">`,
      `<meta property="og:description" content="${escapeHtml(input.openGraph.description)}">`,
      `<meta property="og:url" content="${escapeHtml(input.openGraph.url)}">`,
      input.openGraph.image
        ? `<meta property="og:image" content="${escapeHtml(input.openGraph.image)}">`
        : '',
      `<meta name="twitter:card" content="${input.openGraph.image ? 'summary_large_image' : 'summary'}">`,
    ].join('')
    : '';
  const jsonLd = input.structuredData
    ? `<script type="application/ld+json">${serializeStructuredData(input.structuredData)}</script>`
    : '';
  return `<!doctype html><html lang="${escapeHtml(input.language ?? 'en-GB')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title><meta name="description" content="${escapeHtml(input.description)}"><meta name="robots" content="${escapeHtml(input.robots)}">${input.themeColour ? `<meta name="theme-color" content="${escapeHtml(input.themeColour)}">` : ''}${canonical}${openGraph}<link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/design-library.css">${jsonLd}</head><body${input.bodyAttributes ?? ''}${input.bodyStyle ? ` style="${escapeHtml(input.bodyStyle)}"` : ''}><a class="skip-link" href="#main-content">Skip to content</a><div id="main-content">${input.body}</div></body></html>`;
}

export function renderPublishedPageDocument(input: {
  snapshot: PublishedSiteSnapshot;
  page: PublishedPageSnapshot;
  content: SafeHtml;
  structuredData: SiteStructuredData;
  preview?: boolean;
}): string {
  const themePresentation = renderSiteThemePresentation(input.snapshot.theme);
  const imageReference = input.page.seo.openGraphImageAssetReference;
  const image = imageReference
    ? input.snapshot.assets.find((asset) => asset.publicReference === imageReference)?.url
    : undefined;
  const canonicalUrl = canonicalPageUrl(input.snapshot, input.page);
  const previewBanner = input.preview
    ? `<aside class="preview-banner" role="status">Preview · Site ${escapeHtml(input.snapshot.siteReference)} · Version ${escapeHtml(input.snapshot.versionReference)}</aside>`
    : '';
  return documentShell({
    title: input.page.seo.title,
    description: input.page.seo.description,
    language: input.snapshot.language,
    body: `${previewBanner}${input.content}` as SafeHtml,
    canonicalUrl,
    robots: input.preview
      ? 'noindex, nofollow'
      : `${input.page.seo.index ? 'index' : 'noindex'}, ${input.page.seo.follow ? 'follow' : 'nofollow'}`,
    themeColour: input.snapshot.theme.primaryColour,
    openGraph: {
      title: input.page.seo.openGraphTitle,
      description: input.page.seo.openGraphDescription,
      url: canonicalUrl,
      ...(image ? { image } : {}),
    },
    structuredData: input.structuredData,
    bodyStyle: themePresentation.style,
    bodyAttributes: themePresentation.bodyAttributes,
  });
}

export function renderNotFoundDocument(siteName?: string): string {
  return documentShell({
    title: 'Page not found',
    description: 'The requested page could not be found.',
    body: NotFound(siteName),
    robots: 'noindex, nofollow',
  });
}

export function renderUnavailableDocument(): string {
  return documentShell({
    title: 'Website unavailable',
    description: 'This website is temporarily unavailable.',
    body: SiteUnavailable(),
    robots: 'noindex, nofollow',
  });
}
