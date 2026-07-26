import {
  EMPTY_TEMPLATE_DESIGN_SIGNALS,
  EMPTY_TEMPLATE_RESPONSIVE_SIGNALS,
  type TemplateDesignSignals,
  type TemplateResponsiveSignals,
} from '@ks-os/contracts';

function unique<T>(values: readonly T[], limit: number): T[] {
  return [...new Set(values)].slice(0, limit);
}

function matches(css: string, pattern: RegExp, group = 1) {
  return [...css.matchAll(pattern)]
    .map((match) => match[group]?.trim())
    .filter((value): value is string => Boolean(value));
}

export function extractDesignSignals(cssSources: readonly string[]): TemplateDesignSignals {
  const css = cssSources.join('\n');
  const customProperties = matches(css, /(--[a-z0-9_-]+)\s*:/gi);
  const customPropertyValues = matches(
    css,
    /--[a-z0-9_-]+\s*:\s*([^;}{]+)/gi,
  );
  const colours = [
    ...matches(css, /(#[0-9a-f]{3,8})\b/gi),
    ...matches(css, /\b((?:rgb|hsl)a?\([^)]{3,80}\))/gi),
    ...customPropertyValues.filter((value) =>
      /^(?:#|rgb|hsl|oklch|color\()/i.test(value)
    ),
  ];
  const fontFamilies = matches(css, /font-family\s*:\s*([^;}{]+)/gi)
    .flatMap((value) => value.split(','))
    .map((value) => value.replace(/["']/g, '').trim());
  const fontWeights = matches(css, /font-weight\s*:\s*(\d{1,4})/gi)
    .map(Number)
    .filter((value) => value >= 1 && value <= 1000);
  const spacingValues = matches(
    css,
    /(?:margin|padding|gap)(?:-[a-z]+)?\s*:\s*([^;}{]+)/gi,
  );
  const borderRadii = matches(css, /border-radius\s*:\s*([^;}{]+)/gi);
  const shadows = matches(css, /box-shadow\s*:\s*([^;}{]+)/gi);
  const containerWidths = matches(
    css,
    /(?:max-width|inline-size)\s*:\s*([^;}{]+)/gi,
  );
  const frameworks: string[] = [];
  if (/--tw-|\.container\s*\{|@tailwind/i.test(css)) frameworks.push('TAILWIND');
  if (/\.row\s*\{[^}]*--bs-|--bs-[a-z-]+/is.test(css)) frameworks.push('BOOTSTRAP');
  if (/\.uk-(?:container|grid|button)/i.test(css)) frameworks.push('UIKIT');
  if (/\.elementor-|--e-global-/i.test(css)) frameworks.push('ELEMENTOR');
  if (/\.swiper-|swiper-wrapper/i.test(css)) frameworks.push('SWIPER');

  return {
    ...EMPTY_TEMPLATE_DESIGN_SIGNALS,
    cssCustomProperties: unique(customProperties, 250),
    colours: unique(colours, 100),
    fontFamilies: unique(fontFamilies, 50),
    fontWeights: unique(fontWeights, 20),
    spacingValues: unique(spacingValues, 100),
    borderRadii: unique(borderRadii, 50),
    shadows: unique(shadows, 50),
    containerWidths: unique(containerWidths, 50),
    buttonVariants: unique(
      matches(css, /\.([a-z0-9_-]*(?:btn|button)[a-z0-9_-]*)\b/gi),
      50,
    ),
    frameworkIndicators: unique(frameworks, 30),
  };
}

export function extractCssResponsiveSignals(
  cssSources: readonly string[],
): TemplateResponsiveSignals {
  const css = cssSources.join('\n');
  const mediaQueries = [...css.matchAll(/@media\s*([^{]+)/gi)];
  const breakpoints = mediaQueries.flatMap((match) =>
    [...(match[1] || '').matchAll(/(?:min|max)-width\s*:\s*(\d+)px/gi)]
      .map((item) => Number(item[1]))
      .filter(Number.isFinite)
  );
  const fixedWidths = matches(
    css,
    /(?:^|[;{])\s*width\s*:\s*(\d{4,})px\b/gim,
  );
  const overflowRisks: string[] = [];
  if (/white-space\s*:\s*nowrap/i.test(css)) overflowRisks.push('WHITE_SPACE_NOWRAP');
  if (/overflow-x\s*:\s*(?:visible|scroll)/i.test(css)) {
    overflowRisks.push('HORIZONTAL_OVERFLOW_DECLARATION');
  }
  return {
    ...EMPTY_TEMPLATE_RESPONSIVE_SIGNALS,
    mediaQueryCount: mediaQueries.length,
    breakpoints: unique(breakpoints, 50),
    usesGrid: /display\s*:\s*grid/i.test(css),
    usesFlexbox: /display\s*:\s*(?:inline-)?flex/i.test(css),
    fixedWidthRisks: unique(
      fixedWidths.map((width) => `FIXED_WIDTH_${width}px`),
      50,
    ),
    horizontalOverflowRisks: unique(overflowRisks, 50),
  };
}

export function mergeResponsiveSignals(
  html: TemplateResponsiveSignals,
  css: TemplateResponsiveSignals,
): TemplateResponsiveSignals {
  return {
    hasViewportMeta: html.hasViewportMeta,
    mediaQueryCount: css.mediaQueryCount,
    breakpoints: unique([...html.breakpoints, ...css.breakpoints], 50),
    hasSrcset: html.hasSrcset,
    hasSizes: html.hasSizes,
    hasPictureElements: html.hasPictureElements,
    hasResponsiveNavigation: html.hasResponsiveNavigation,
    usesGrid: css.usesGrid,
    usesFlexbox: css.usesFlexbox,
    fixedWidthRisks: unique([...html.fixedWidthRisks, ...css.fixedWidthRisks], 50),
    horizontalOverflowRisks: unique(
      [...html.horizontalOverflowRisks, ...css.horizontalOverflowRisks],
      50,
    ),
    missingMobileNavigationSignal: html.missingMobileNavigationSignal,
  };
}
