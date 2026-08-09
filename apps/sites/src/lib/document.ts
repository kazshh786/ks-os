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
  const v2 = theme.designTokens;
  const v2Variables = v2 ? [
    `--site-display-font:${headingFonts[v2.typography.displayFont]}`,
    `--site-heading-font:${headingFonts[v2.typography.headingFont]}`,
    `--site-body-font:${bodyFonts[v2.typography.bodyFont]}`,
    `--site-display-size:${({ RESTRAINED: 'clamp(2.8rem, 7vw, 5.5rem)', BALANCED: 'clamp(3.2rem, 8vw, 7rem)', DRAMATIC: 'clamp(4rem, 11vw, 9.5rem)' } as const)[v2.typography.displayScale]}`,
    `--site-heading-size:${({ COMPACT: 'clamp(1.8rem, 3vw, 2.75rem)', BALANCED: 'clamp(2rem, 4vw, 3.6rem)', EXPRESSIVE: 'clamp(2.4rem, 5vw, 4.8rem)' } as const)[v2.typography.headingScale]}`,
    `--site-body-size:${({ COMPACT: '0.95rem', STANDARD: '1rem', GENEROUS: '1.125rem' } as const)[v2.typography.bodyScale]}`,
    `--site-heading-weight:${({ REGULAR: '400', MEDIUM: '500', SEMIBOLD: '600', BOLD: '700' } as const)[v2.typography.headingWeight]}`,
    `--site-body-weight:${v2.typography.bodyWeight === 'MEDIUM' ? '500' : '400'}`,
    `--site-display-tracking:${({ TIGHT: '-0.055em', NORMAL: '-0.02em', WIDE: '0.04em' } as const)[v2.typography.displayTracking]}`,
    `--site-heading-tracking:${({ TIGHT: '-0.035em', NORMAL: '-0.01em', WIDE: '0.035em' } as const)[v2.typography.headingTracking]}`,
    `--site-heading-leading:${({ TIGHT: '0.96', STANDARD: '1.08', RELAXED: '1.2' } as const)[v2.typography.headingLineHeight]}`,
    `--site-body-leading:${({ STANDARD: '1.55', RELAXED: '1.7', SPACIOUS: '1.85' } as const)[v2.typography.bodyLineHeight]}`,
    `--site-container:${({ COMPACT_RANGE: '68rem', BALANCED_RANGE: '78rem', EXPANSIVE_RANGE: '92rem' } as const)[v2.layout.containerWidths]}`,
    `--site-page-gutter:${({ COMPACT: '1rem', STANDARD: 'clamp(1rem, 3vw, 2.5rem)', GENEROUS: 'clamp(1.25rem, 5vw, 4.5rem)' } as const)[v2.layout.pageGutter]}`,
    `--site-section-space:${({ COMPACT: 'clamp(2.5rem, 5vw, 4.5rem)', STANDARD: 'clamp(3.5rem, 8vw, 7rem)', EXPANSIVE: 'clamp(5rem, 11vw, 10rem)' } as const)[v2.layout.sectionSpacing]}`,
    `--site-content-gap:${({ TIGHT: '0.75rem', STANDARD: '1.25rem', RELAXED: '2rem' } as const)[v2.layout.contentSpacing]}`,
    `--site-grid-columns:${({ TEN: '10', TWELVE: '12', SIXTEEN: '16' } as const)[v2.layout.gridColumns]}`,
    `--site-grid-gap:${({ TIGHT: '0.75rem', STANDARD: '1.25rem', GENEROUS: '2rem' } as const)[v2.layout.gridGap]}`,
    `--site-text-measure:${({ NARROW: '48ch', READABLE: '64ch', WIDE: '76ch' } as const)[v2.layout.textMeasure]}`,
    `--site-card-radius:${radius[v2.shape.cardRadius === 'NONE' ? 'NONE' : v2.shape.cardRadius]}`,
    `--site-button-radius:${({ SQUARE: '0', SOFT: '0.65rem', PILL: '999px' } as const)[v2.shape.buttonRadius]}`,
    `--site-image-radius:${radius[v2.shape.imageRadius === 'NONE' ? 'NONE' : v2.shape.imageRadius]}`,
    `--site-surface-alt:${v2.surface.surfaceAlt}`,
    `--site-muted-surface:${v2.surface.mutedSurface}`,
    `--site-shadow:${({ NONE: 'none', SUBTLE: '0 12px 35px rgb(15 23 42 / 0.08)', MEDIUM: '0 22px 55px rgb(15 23 42 / 0.13)', STRONG: '0 30px 80px rgb(15 23 42 / 0.2)' } as const)[v2.elevation]}`,
    `--site-button-height:${({ COMPACT: '2.75rem', STANDARD: '3rem', LARGE: '3.5rem' } as const)[v2.buttons.height]}`,
    `--site-button-padding:${({ COMPACT: '1rem', STANDARD: '1.35rem', GENEROUS: '1.8rem' } as const)[v2.buttons.padding]}`,
    `--site-button-weight:${({ MEDIUM: '500', SEMIBOLD: '600', BOLD: '700' } as const)[v2.buttons.weight]}`,
    `--site-image-fit:${v2.imagery.cropMode.toLowerCase()}`,
    `--site-image-position:${({ ASSET_FOCAL_POINT: 'var(--asset-focal-point, center)', CENTRE: 'center', TOP: 'top' } as const)[v2.imagery.focalBehaviour]}`,
    `--site-section-rhythm:${v2.sectionRhythm.toLowerCase().replaceAll('_', '-')}`,
  ] : [];
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
    ...v2Variables,
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
