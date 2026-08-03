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

const headingFonts = {
  SYSTEM_SANS: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  SYSTEM_SERIF: 'Georgia, "Times New Roman", serif',
  EDITORIAL_SERIF: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
} as const;

const bodyFonts = {
  SYSTEM_SANS: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  SYSTEM_SERIF: 'Georgia, "Times New Roman", serif',
} as const;

const radius = {
  NONE: '0rem',
  SMALL: '0.45rem',
  MEDIUM: '0.9rem',
  LARGE: '1.5rem',
} as const;

const sectionSpacing = {
  COMPACT: 'clamp(2.25rem, 5vw, 4rem)',
  COMFORTABLE: 'clamp(3rem, 8vw, 7rem)',
  AIRY: 'clamp(4rem, 10vw, 9rem)',
} as const;

const containerWidth = {
  NARROW: '62rem',
  STANDARD: '74rem',
  WIDE: '88rem',
} as const;

const imageRadius = {
  SQUARE: '0rem',
  ROUNDED: '1rem',
  EDITORIAL: '0.25rem',
} as const;

function themeStyle(snapshot: PublishedSiteSnapshot): string {
  const theme = snapshot.theme;
  return [
    `--site-primary:${theme.primaryColour}`,
    `--site-secondary:${theme.secondaryColour}`,
    `--site-accent:${theme.accentColour}`,
    `--site-background:${theme.backgroundColour}`,
    `--site-surface:${theme.surfaceColour}`,
    `--site-text:${theme.textColour}`,
    `--site-muted:${theme.mutedTextColour}`,
    `--site-border:${theme.borderColour}`,
    `--site-heading-font:${headingFonts[theme.headingFontKey]}`,
    `--site-body-font:${bodyFonts[theme.bodyFontKey]}`,
    `--site-radius:${radius[theme.radiusScale]}`,
    `--site-section-space:${sectionSpacing[theme.spacingDensity]}`,
    `--site-container:${containerWidth[theme.containerWidth]}`,
    `--site-image-radius:${imageRadius[theme.imageStyle]}`,
    `--site-motion:${theme.motionPreference === 'STANDARD' ? '220ms' : '0ms'}`,
    `--site-button-fill:${theme.buttonStyle === 'SOLID' ? theme.primaryColour : theme.buttonStyle === 'SOFT' ? theme.surfaceColour : 'transparent'}`,
    `--site-button-text:${theme.buttonStyle === 'SOLID' ? '#ffffff' : theme.primaryColour}`,
  ].join(';');
}

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
  return `<!doctype html><html lang="${escapeHtml(input.language ?? 'en-GB')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title><meta name="description" content="${escapeHtml(input.description)}"><meta name="robots" content="${escapeHtml(input.robots)}">${input.themeColour ? `<meta name="theme-color" content="${escapeHtml(input.themeColour)}">` : ''}${canonical}${openGraph}<link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/design-library.css">${jsonLd}</head><body${input.bodyStyle ? ` style="${escapeHtml(input.bodyStyle)}"` : ''}><a class="skip-link" href="#main-content">Skip to content</a><div id="main-content">${input.body}</div></body></html>`;
}

export function renderPublishedPageDocument(input: {
  snapshot: PublishedSiteSnapshot;
  page: PublishedPageSnapshot;
  content: SafeHtml;
  structuredData: SiteStructuredData;
  preview?: boolean;
}): string {
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
    bodyStyle: themeStyle(input.snapshot),
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
