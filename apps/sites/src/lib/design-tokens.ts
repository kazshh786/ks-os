import type { SiteDesignTokensV2, SiteTheme } from '@ks-os/site-schema';

const headingFonts = {
  SYSTEM_SANS: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  SYSTEM_SERIF: 'Georgia, "Times New Roman", serif',
  EDITORIAL_SERIF: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
} as const;

const bodyFonts = {
  SYSTEM_SANS: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  SYSTEM_SERIF: 'Georgia, "Times New Roman", serif',
} as const;

const radius = { NONE: '0rem', SMALL: '0.45rem', MEDIUM: '0.9rem', LARGE: '1.5rem' } as const;
const v2Radius = { NONE: '0rem', SUBTLE: '0.35rem', SOFT: '0.9rem', ROUNDED: '1.5rem' } as const;

export const SITE_DESIGN_TOKEN_V2_BINDINGS = {
  designVersion: { attributes: ['data-site-design-version'] },
  'typography.displayFont': { cssVariables: ['--site-display-font'] },
  'typography.headingFont': { cssVariables: ['--site-heading-font'] },
  'typography.bodyFont': { cssVariables: ['--site-body-font'] },
  'typography.displayScale': { cssVariables: ['--site-display-size'] },
  'typography.headingScale': { cssVariables: ['--site-heading-size'] },
  'typography.bodyScale': { cssVariables: ['--site-body-size'] },
  'typography.headingWeight': { cssVariables: ['--site-heading-weight'] },
  'typography.bodyWeight': { cssVariables: ['--site-body-weight'] },
  'typography.displayTracking': { cssVariables: ['--site-display-tracking'] },
  'typography.headingTracking': { cssVariables: ['--site-heading-tracking'] },
  'typography.headingLineHeight': { cssVariables: ['--site-heading-leading'] },
  'typography.bodyLineHeight': { cssVariables: ['--site-body-leading'] },
  'layout.containerWidths': { cssVariables: ['--site-container'] },
  'layout.pageGutter': { cssVariables: ['--site-page-gutter'] },
  'layout.sectionSpacing': { cssVariables: ['--site-section-space'] },
  'layout.contentSpacing': { cssVariables: ['--site-content-gap'] },
  'layout.gridColumns': { cssVariables: ['--site-grid-item-min'] },
  'layout.gridGap': { cssVariables: ['--site-grid-gap'] },
  'layout.textMeasure': { cssVariables: ['--site-text-measure'] },
  'shape.radiusScale': { cssVariables: ['--site-radius'] },
  'shape.cardRadius': { cssVariables: ['--site-card-radius'] },
  'shape.buttonRadius': { cssVariables: ['--site-button-radius'] },
  'shape.imageRadius': { cssVariables: ['--site-image-radius'] },
  'surface.background': { cssVariables: ['--site-background'] },
  'surface.surface': { cssVariables: ['--site-surface'] },
  'surface.surfaceAlt': { cssVariables: ['--site-surface-alt'] },
  'surface.border': { cssVariables: ['--site-border'] },
  'surface.mutedSurface': { cssVariables: ['--site-muted-surface'] },
  elevation: { cssVariables: ['--site-shadow'] },
  'buttons.height': { cssVariables: ['--site-button-height'] },
  'buttons.padding': { cssVariables: ['--site-button-padding'] },
  'buttons.weight': { cssVariables: ['--site-button-weight'] },
  'buttons.primaryStyle': { cssVariables: ['--site-primary-button-fill', '--site-primary-button-text', '--site-primary-button-border'] },
  'buttons.secondaryStyle': { cssVariables: ['--site-secondary-button-fill', '--site-secondary-button-text', '--site-secondary-button-border'] },
  'imagery.defaultAspectRatio': { cssVariables: ['--site-default-aspect-ratio'] },
  'imagery.portraitAspectRatio': { cssVariables: ['--site-portrait-aspect-ratio'] },
  'imagery.serviceAspectRatio': { cssVariables: ['--site-service-aspect-ratio'] },
  'imagery.cropMode': { cssVariables: ['--site-image-fit'] },
  'imagery.focalBehaviour': { cssVariables: ['--site-image-position'] },
  'imagery.imageTreatment': { cssVariables: ['--site-image-filter'] },
  sectionRhythm: { cssVariables: ['--site-rhythm-even-surface'] },
} as const;

export const SITE_DESIGN_TOKEN_V2_PATHS = Object.freeze(Object.keys(SITE_DESIGN_TOKEN_V2_BINDINGS));

function primaryButton(style: SiteDesignTokensV2['buttons']['primaryStyle']) {
  return ({
    SOLID: ['var(--site-primary)', '#ffffff', 'var(--site-primary)'],
    OUTLINE: ['transparent', 'var(--site-primary)', 'var(--site-primary)'],
    SOFT: ['color-mix(in srgb, var(--site-primary) 14%, var(--site-surface))', 'var(--site-primary)', 'transparent'],
    HIGH_CONTRAST: ['var(--site-text)', 'var(--site-background)', 'var(--site-text)'],
  } as const)[style];
}

function secondaryButton(style: SiteDesignTokensV2['buttons']['secondaryStyle']) {
  return ({
    TEXT: ['transparent', 'var(--site-primary)', 'transparent'],
    OUTLINE: ['transparent', 'var(--site-primary)', 'var(--site-border)'],
    SOFT: ['var(--site-muted-surface)', 'var(--site-text)', 'transparent'],
  } as const)[style];
}

function v2Variables(v2: SiteDesignTokensV2) {
  const primary = primaryButton(v2.buttons.primaryStyle);
  const secondary = secondaryButton(v2.buttons.secondaryStyle);
  return [
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
    `--site-grid-item-min:${({ TEN: '18rem', TWELVE: '16rem', SIXTEEN: '13rem' } as const)[v2.layout.gridColumns]}`,
    `--site-grid-gap:${({ TIGHT: '0.75rem', STANDARD: '1.25rem', GENEROUS: '2rem' } as const)[v2.layout.gridGap]}`,
    `--site-text-measure:${({ NARROW: '48ch', READABLE: '64ch', WIDE: '76ch' } as const)[v2.layout.textMeasure]}`,
    `--site-radius:${v2Radius[v2.shape.radiusScale]}`,
    `--site-card-radius:${radius[v2.shape.cardRadius === 'NONE' ? 'NONE' : v2.shape.cardRadius]}`,
    `--site-button-radius:${({ SQUARE: '0', SOFT: '0.65rem', PILL: '999px' } as const)[v2.shape.buttonRadius]}`,
    `--site-image-radius:${radius[v2.shape.imageRadius === 'NONE' ? 'NONE' : v2.shape.imageRadius]}`,
    `--site-background:${v2.surface.background}`,
    `--site-surface:${v2.surface.surface}`,
    `--site-surface-alt:${v2.surface.surfaceAlt}`,
    `--site-border:${v2.surface.border}`,
    `--site-muted-surface:${v2.surface.mutedSurface}`,
    `--site-shadow:${({ NONE: 'none', SUBTLE: '0 12px 35px rgb(15 23 42 / 0.08)', MEDIUM: '0 22px 55px rgb(15 23 42 / 0.13)', STRONG: '0 30px 80px rgb(15 23 42 / 0.2)' } as const)[v2.elevation]}`,
    `--site-button-height:${({ COMPACT: '2.75rem', STANDARD: '3rem', LARGE: '3.5rem' } as const)[v2.buttons.height]}`,
    `--site-button-padding:${({ COMPACT: '1rem', STANDARD: '1.35rem', GENEROUS: '1.8rem' } as const)[v2.buttons.padding]}`,
    `--site-button-weight:${({ MEDIUM: '500', SEMIBOLD: '600', BOLD: '700' } as const)[v2.buttons.weight]}`,
    `--site-primary-button-fill:${primary[0]}`,
    `--site-primary-button-text:${primary[1]}`,
    `--site-primary-button-border:${primary[2]}`,
    `--site-secondary-button-fill:${secondary[0]}`,
    `--site-secondary-button-text:${secondary[1]}`,
    `--site-secondary-button-border:${secondary[2]}`,
    `--site-default-aspect-ratio:${({ SQUARE: '1 / 1', FOUR_THREE: '4 / 3', THREE_TWO: '3 / 2', SIXTEEN_NINE: '16 / 9' } as const)[v2.imagery.defaultAspectRatio]}`,
    `--site-portrait-aspect-ratio:${({ THREE_FOUR: '3 / 4', FOUR_FIVE: '4 / 5', TWO_THREE: '2 / 3' } as const)[v2.imagery.portraitAspectRatio]}`,
    `--site-service-aspect-ratio:${({ SQUARE: '1 / 1', FOUR_THREE: '4 / 3', THREE_TWO: '3 / 2', SIXTEEN_NINE: '16 / 9' } as const)[v2.imagery.serviceAspectRatio]}`,
    `--site-image-fit:${v2.imagery.cropMode.toLowerCase()}`,
    `--site-image-position:${({ ASSET_FOCAL_POINT: 'var(--asset-focal-point, center)', CENTRE: 'center', TOP: 'top' } as const)[v2.imagery.focalBehaviour]}`,
    `--site-image-filter:${({ NATURAL: 'none', EDITORIAL: 'saturate(0.88) contrast(1.06)', SOFTENED: 'saturate(0.82) contrast(0.94)', HIGH_CONTRAST: 'contrast(1.18) saturate(1.04)', MONOCHROME: 'grayscale(1)' } as const)[v2.imagery.imageTreatment]}`,
    `--site-rhythm-even-surface:${({ CONTINUOUS: 'transparent', ALTERNATING_SURFACES: 'var(--site-surface-alt)', EDITORIAL: 'var(--site-muted-surface)', HIGH_CONTRAST: 'color-mix(in srgb, var(--site-primary) 12%, var(--site-surface))', SOFT_LUXURY: 'color-mix(in srgb, var(--site-surface-alt) 70%, var(--site-background))' } as const)[v2.sectionRhythm]}`,
  ];
}

export function renderSiteThemePresentation(theme: SiteTheme) {
  const legacy = [
    `--site-primary:${theme.primaryColour}`, `--site-secondary:${theme.secondaryColour}`,
    `--site-accent:${theme.accentColour}`, `--site-background:${theme.backgroundColour}`,
    `--site-surface:${theme.surfaceColour}`, `--site-text:${theme.textColour}`,
    `--site-muted:${theme.mutedTextColour}`, `--site-border:${theme.borderColour}`,
    `--site-heading-font:${headingFonts[theme.headingFontKey]}`, `--site-body-font:${bodyFonts[theme.bodyFontKey]}`,
    `--site-radius:${radius[theme.radiusScale]}`,
    `--site-section-space:${({ COMPACT: 'clamp(2.25rem, 5vw, 4rem)', COMFORTABLE: 'clamp(3rem, 8vw, 7rem)', AIRY: 'clamp(4rem, 10vw, 9rem)' } as const)[theme.spacingDensity]}`,
    `--site-container:${({ NARROW: '62rem', STANDARD: '74rem', WIDE: '88rem' } as const)[theme.containerWidth]}`,
    `--site-image-radius:${({ SQUARE: '0rem', ROUNDED: '1rem', EDITORIAL: '0.25rem' } as const)[theme.imageStyle]}`,
    `--site-motion:${theme.motionPreference === 'STANDARD' ? '220ms' : '0ms'}`,
    `--site-button-fill:${theme.buttonStyle === 'SOLID' ? theme.primaryColour : theme.buttonStyle === 'SOFT' ? theme.surfaceColour : 'transparent'}`,
    `--site-button-text:${theme.buttonStyle === 'SOLID' ? '#ffffff' : theme.primaryColour}`,
  ];
  return {
    style: [...legacy, ...(theme.designTokens ? v2Variables(theme.designTokens) : [])].join(';'),
    bodyAttributes: theme.designTokens ? ' data-site-design-version="2"' : '',
  } as const;
}
