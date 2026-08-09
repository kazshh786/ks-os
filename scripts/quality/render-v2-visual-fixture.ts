import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { renderSection, type ComponentRenderContext, type SafeHtml } from '@ks-os/site-components';
import { createOriginalInternalSiteFixture } from '@ks-os/site-templates';
import type { SiteSection } from '@ks-os/site-schema';
import { renderSiteThemePresentation } from '../../apps/sites/src/lib/design-tokens.js';

async function main() {
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const outputDirectory = resolve(repositoryRoot, 'docs/evidence/website-generation-v2');
await mkdir(outputDirectory, { recursive: true });

const snapshot = structuredClone(createOriginalInternalSiteFixture());
const home = snapshot.pages.find(page => page.pageType === 'HOME')!;
const sourceSections = new Map(snapshot.pages.flatMap(page => page.sections.map(section => [section.type, section])));
const clone = (type: SiteSection['type'], referenceSuffix: string, componentKey: string) => ({
  ...structuredClone(sourceSections.get(type)!),
  reference: `70000000-0000-4000-8000-${referenceSuffix.padStart(12, '0')}`,
  componentKey,
}) as SiteSection;
const bookingAction = { type: 'KS_OS_BOOKING' as const, label: 'Plan your visit' };
const assetReferences = snapshot.assets.map(asset => asset.publicReference);

home.sections = [
  clone('HEADER', '1', 'header-transparent-overlay-v1'),
  clone('HERO', '2', 'hero-layered-media-v1'),
  { ...clone('INTRODUCTION', '3', 'intro-with-points-v1'), supportingPoints: ['Verified services and people', 'A clear native booking path', 'Responsive private review'] },
  clone('FEATURED_SERVICES', '4', 'services-overlapping-media-v1'),
  clone('BENEFITS', '5', 'benefits-large-statements-v1'),
  {
    reference: '70000000-0000-4000-8000-000000000006', type: 'PROCESS', componentKey: 'process-alternating-v1',
    heading: 'A calm, considered process', imageAssetReference: assetReferences[0],
    steps: [
      { heading: 'Discover', body: 'Start with the verified information that matters to your visit.' },
      { heading: 'Choose', body: 'Review the right service, specialist and location without guesswork.' },
      { heading: 'Book', body: 'Continue into the native KS OS booking flow with your choices intact.' },
    ],
  },
  clone('TEAM', '7', 'team-featured-lead-v1'),
  {
    reference: '70000000-0000-4000-8000-000000000008', type: 'GALLERY', componentKey: 'gallery-collage-v1',
    heading: 'Inside Northlight', assetReferences,
  },
  clone('TESTIMONIALS', '9', 'testimonials-quote-led-v1'),
  clone('TRUST_INDICATORS', '10', 'trust-statements-v1'),
  clone('FAQ', '11', 'faq-split-v1'),
  { ...clone('LOCATION', '12', 'location-media-split-v1'), imageAssetReference: assetReferences[0] },
  {
    reference: '70000000-0000-4000-8000-000000000013', type: 'FINAL_CTA', componentKey: 'cta-high-impact-v1',
    heading: 'Ready when you are', body: 'Move from a complete, verified page into native booking.', primaryAction: bookingAction,
  },
  clone('FOOTER', '14', 'footer-large-brand-v1'),
];

snapshot.theme.designTokens = {
  designVersion: 2,
  typography: { displayFont: 'EDITORIAL_SERIF', headingFont: 'SYSTEM_SERIF', bodyFont: 'SYSTEM_SANS', displayScale: 'DRAMATIC', headingScale: 'EXPRESSIVE', bodyScale: 'GENEROUS', headingWeight: 'SEMIBOLD', bodyWeight: 'REGULAR', displayTracking: 'TIGHT', headingTracking: 'NORMAL', headingLineHeight: 'TIGHT', bodyLineHeight: 'RELAXED' },
  layout: { containerWidths: 'EXPANSIVE_RANGE', pageGutter: 'STANDARD', sectionSpacing: 'STANDARD', contentSpacing: 'RELAXED', gridColumns: 'TWELVE', gridGap: 'GENEROUS', textMeasure: 'READABLE' },
  shape: { radiusScale: 'SOFT', cardRadius: 'LARGE', buttonRadius: 'PILL', imageRadius: 'LARGE' },
  surface: { background: '#f5f0e9', surface: '#fffdf9', surfaceAlt: '#e8dfd4', border: '#c9b9a8', mutedSurface: '#eee5db' },
  elevation: 'MEDIUM',
  buttons: { height: 'LARGE', padding: 'GENEROUS', weight: 'SEMIBOLD', primaryStyle: 'HIGH_CONTRAST', secondaryStyle: 'SOFT' },
  imagery: { defaultAspectRatio: 'FOUR_THREE', portraitAspectRatio: 'FOUR_FIVE', serviceAspectRatio: 'THREE_TWO', cropMode: 'COVER', focalBehaviour: 'CENTRE', imageTreatment: 'EDITORIAL' },
  sectionRhythm: 'SOFT_LUXURY',
};

const pagePathByReference = Object.fromEntries(snapshot.pages.map(page => [page.publicReference, page.path]));
const context: ComponentRenderContext = { snapshot, page: home, pagePathByReference };
let content = `<div class="site-layout editorial-layout" data-renderer="home-editorial-v1">${home.sections.map(section => renderSection(section, context)).join('')}</div>`;
const illustrativeImage = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#283b35"/><stop offset=".48" stop-color="#bd8d6d"/><stop offset="1" stop-color="#ede1d4"/></linearGradient><filter id="n"><feTurbulence baseFrequency=".55" numOctaves="3" stitchTiles="stitch"/><feBlend mode="soft-light" in="SourceGraphic"/></filter></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="1180" cy="310" r="320" fill="#fff" opacity=".16"/><rect width="100%" height="100%" filter="url(#n)" opacity=".18"/></svg>');
content = content.replaceAll(/https:\/\/assets\.example\.invalid\/[^"']+/g, illustrativeImage);
const [siteCss, designCss] = await Promise.all([
  readFile(resolve(repositoryRoot, 'apps/sites/public/site.css'), 'utf8'),
  readFile(resolve(repositoryRoot, 'apps/sites/public/design-library.css'), 'utf8'),
]);
const theme = renderSiteThemePresentation(snapshot.theme);
const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Website Generation V2 visual fixture</title><style>${siteCss}\n${designCss}</style></head><body${theme.bodyAttributes} style="${theme.style}"><aside class="preview-banner">Review fixture · noindex · no publication</aside>${content as SafeHtml}</body></html>`;
const htmlPath = resolve(outputDirectory, 'representative-home.html');
await writeFile(htmlPath, html, 'utf8');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(new URL(`file:///${htmlPath.replaceAll('\\', '/')}`).toString(), { waitUntil: 'load' });
  for (const viewport of [{ name: '390-mobile', width: 390, height: 844 }, { name: '768-tablet', width: 768, height: 1024 }, { name: '1440-desktop', width: 1440, height: 1000 }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.screenshot({ path: resolve(outputDirectory, `${viewport.name}.jpg`), type: 'jpeg', quality: 78, fullPage: true });
  }
} finally {
  await browser.close();
}
}

void main();
