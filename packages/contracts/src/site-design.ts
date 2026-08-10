import { z } from 'zod';

export const SiteDesignPresetKeySchema = z.enum([
  'NORTHLIGHT', 'EDITORIAL', 'MODERN', 'LUXURY', 'WELLNESS',
  'CLINICAL', 'FRIENDLY', 'BOLD', 'LOCAL', 'CREATIVE',
]);
export type SiteDesignPresetKey = z.infer<typeof SiteDesignPresetKeySchema>;

export const SiteDesignTokensV2EditorSchema = z.object({
  designVersion: z.literal(2),
  typography: z.object({
    displayFont: z.enum(['SYSTEM_SANS', 'SYSTEM_SERIF', 'EDITORIAL_SERIF']),
    headingFont: z.enum(['SYSTEM_SANS', 'SYSTEM_SERIF', 'EDITORIAL_SERIF']),
    bodyFont: z.enum(['SYSTEM_SANS', 'SYSTEM_SERIF']),
    displayScale: z.enum(['RESTRAINED', 'BALANCED', 'DRAMATIC']),
    headingScale: z.enum(['COMPACT', 'BALANCED', 'EXPRESSIVE']),
    bodyScale: z.enum(['COMPACT', 'STANDARD', 'GENEROUS']),
    headingWeight: z.enum(['REGULAR', 'MEDIUM', 'SEMIBOLD', 'BOLD']),
    bodyWeight: z.enum(['REGULAR', 'MEDIUM']),
    displayTracking: z.enum(['TIGHT', 'NORMAL', 'WIDE']),
    headingTracking: z.enum(['TIGHT', 'NORMAL', 'WIDE']),
    headingLineHeight: z.enum(['TIGHT', 'STANDARD', 'RELAXED']),
    bodyLineHeight: z.enum(['STANDARD', 'RELAXED', 'SPACIOUS']),
  }).strict(),
  layout: z.object({
    containerWidths: z.enum(['COMPACT_RANGE', 'BALANCED_RANGE', 'EXPANSIVE_RANGE']),
    pageGutter: z.enum(['COMPACT', 'STANDARD', 'GENEROUS']),
    sectionSpacing: z.enum(['COMPACT', 'STANDARD', 'EXPANSIVE']),
    contentSpacing: z.enum(['TIGHT', 'STANDARD', 'RELAXED']),
    gridColumns: z.enum(['TEN', 'TWELVE', 'SIXTEEN']),
    gridGap: z.enum(['TIGHT', 'STANDARD', 'GENEROUS']),
    textMeasure: z.enum(['NARROW', 'READABLE', 'WIDE']),
  }).strict(),
  shape: z.object({
    radiusScale: z.enum(['NONE', 'SUBTLE', 'SOFT', 'ROUNDED']),
    cardRadius: z.enum(['NONE', 'SMALL', 'MEDIUM', 'LARGE']),
    buttonRadius: z.enum(['SQUARE', 'SOFT', 'PILL']),
    imageRadius: z.enum(['NONE', 'SMALL', 'MEDIUM', 'LARGE']),
  }).strict(),
  surface: z.object({
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    surface: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    surfaceAlt: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    border: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    mutedSurface: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }).strict(),
  elevation: z.enum(['NONE', 'SUBTLE', 'MEDIUM', 'STRONG']),
  buttons: z.object({
    height: z.enum(['COMPACT', 'STANDARD', 'LARGE']),
    padding: z.enum(['COMPACT', 'STANDARD', 'GENEROUS']),
    weight: z.enum(['MEDIUM', 'SEMIBOLD', 'BOLD']),
    primaryStyle: z.enum(['SOLID', 'OUTLINE', 'SOFT', 'HIGH_CONTRAST']),
    secondaryStyle: z.enum(['TEXT', 'OUTLINE', 'SOFT']),
  }).strict(),
  imagery: z.object({
    defaultAspectRatio: z.enum(['SQUARE', 'FOUR_THREE', 'THREE_TWO', 'SIXTEEN_NINE']),
    portraitAspectRatio: z.enum(['THREE_FOUR', 'FOUR_FIVE', 'TWO_THREE']),
    serviceAspectRatio: z.enum(['SQUARE', 'FOUR_THREE', 'THREE_TWO', 'SIXTEEN_NINE']),
    cropMode: z.enum(['COVER', 'CONTAIN']),
    focalBehaviour: z.enum(['ASSET_FOCAL_POINT', 'CENTRE', 'TOP']),
    imageTreatment: z.enum(['NATURAL', 'EDITORIAL', 'SOFTENED', 'HIGH_CONTRAST', 'MONOCHROME']),
  }).strict(),
  sectionRhythm: z.enum(['CONTINUOUS', 'ALTERNATING_SURFACES', 'EDITORIAL', 'HIGH_CONTRAST', 'SOFT_LUXURY']),
}).strict();
export type SiteDesignTokensV2Editor = z.infer<typeof SiteDesignTokensV2EditorSchema>;

export const SiteThemeEditorSchema = z.object({
  primaryColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accentColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  surfaceColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  textColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  mutedTextColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  borderColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  headingFontKey: z.enum(['SYSTEM_SANS', 'SYSTEM_SERIF', 'EDITORIAL_SERIF']),
  bodyFontKey: z.enum(['SYSTEM_SANS', 'SYSTEM_SERIF']),
  radiusScale: z.enum(['NONE', 'SMALL', 'MEDIUM', 'LARGE']),
  spacingDensity: z.enum(['COMPACT', 'COMFORTABLE', 'AIRY']),
  containerWidth: z.enum(['NARROW', 'STANDARD', 'WIDE']),
  buttonStyle: z.enum(['SOLID', 'OUTLINE', 'SOFT']),
  imageStyle: z.enum(['SQUARE', 'ROUNDED', 'EDITORIAL']),
  motionPreference: z.enum(['NONE', 'REDUCED', 'STANDARD']),
  designTokens: SiteDesignTokensV2EditorSchema.optional(),
}).strict();
export type SiteThemeEditor = z.infer<typeof SiteThemeEditorSchema>;

export const UpdateSiteStudioThemeSchema = z.object({
  presetKey: SiteDesignPresetKeySchema.optional(),
  theme: SiteThemeEditorSchema,
}).strict();
export type UpdateSiteStudioTheme = z.infer<typeof UpdateSiteStudioThemeSchema>;

export const SiteStudioSectionVariantSchema = z.enum([
  'editorial', 'grid', 'split', 'compact', 'standard', 'featured', 'quiet',
]);
export type SiteStudioSectionVariant = z.infer<typeof SiteStudioSectionVariantSchema>;
export const UpdateSiteStudioSectionVariantSchema = z.object({
  variant: SiteStudioSectionVariantSchema,
}).strict();

export const SiteComponentKeySchema = z.string().trim().min(1).max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/);
export const UpdateSiteStudioSectionComponentSchema = z.object({
  componentKey: SiteComponentKeySchema,
}).strict();

export const UpdateSiteStudioSectionContentSchema = z.object({
  patch: z.object({
    heading: z.string().trim().min(1).max(160).optional(),
    body: z.string().trim().min(1).max(4_000).optional(),
    eyebrow: z.string().trim().min(1).max(160).optional(),
    message: z.string().trim().min(1).max(160).optional(),
    legalText: z.string().trim().min(1).max(500).optional(),
    imageAssetReference: z.string().uuid().optional(),
  }).strict().refine(patch => Object.keys(patch).length > 0, {
    message: 'At least one controlled section content field is required.',
  }),
}).strict().superRefine((input, context) => {
  const strings: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(input.patch);
  if (strings.some(value => /(?:<\/?(?:script|style|iframe|object|embed)\b|javascript:|data:text\/html|\bon\w+\s*=|```|@import\b)/i.test(value))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Section content cannot contain executable markup or code.' });
  }
});

export const ReorderSiteStudioSectionsSchema = z.object({
  sectionReferences: z.array(z.string().uuid()).min(1).max(100),
}).strict().superRefine((input, context) => {
  if (new Set(input.sectionReferences).size !== input.sectionReferences.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Section order cannot contain duplicates.' });
  }
});

export interface SiteDesignPreset {
  key: SiteDesignPresetKey;
  name: string;
  description: string;
  bestFor: string[];
  theme: SiteThemeEditor;
}

const preset = (
  key: SiteDesignPresetKey,
  name: string,
  description: string,
  bestFor: string[],
  colours: Pick<SiteThemeEditor,
    'primaryColour' | 'secondaryColour' | 'accentColour' | 'backgroundColour'
    | 'surfaceColour' | 'textColour' | 'mutedTextColour' | 'borderColour'>,
  options: Omit<SiteThemeEditor, keyof typeof colours>,
): SiteDesignPreset => ({ key, name, description, bestFor, theme: { ...colours, ...options } });

export const SITE_DESIGN_PRESETS: readonly SiteDesignPreset[] = [
  preset('NORTHLIGHT', 'Northlight', 'Calm, trustworthy and spacious with a strong service-led hierarchy.', ['Appointment businesses', 'Consultants', 'Professional services'],
    { primaryColour: '#16324F', secondaryColour: '#365E71', accentColour: '#A64F2A', backgroundColour: '#F8FAFC', surfaceColour: '#FFFFFF', textColour: '#172025', mutedTextColour: '#4B5563', borderColour: '#D7DEE5' },
    { headingFontKey: 'SYSTEM_SERIF', bodyFontKey: 'SYSTEM_SANS', radiusScale: 'LARGE', spacingDensity: 'AIRY', containerWidth: 'STANDARD', buttonStyle: 'SOLID', imageStyle: 'ROUNDED', motionPreference: 'REDUCED' }),
  preset('EDITORIAL', 'Editorial', 'Warm, considered and content-rich with magazine-inspired typography.', ['Creative studios', 'Coaches', 'Premium personal brands'],
    { primaryColour: '#2B2118', secondaryColour: '#6B5B4D', accentColour: '#A14D2F', backgroundColour: '#FBF7F2', surfaceColour: '#FFFFFF', textColour: '#211A15', mutedTextColour: '#5F574F', borderColour: '#DED5CB' },
    { headingFontKey: 'EDITORIAL_SERIF', bodyFontKey: 'SYSTEM_SERIF', radiusScale: 'SMALL', spacingDensity: 'AIRY', containerWidth: 'NARROW', buttonStyle: 'OUTLINE', imageStyle: 'EDITORIAL', motionPreference: 'REDUCED' }),
  preset('MODERN', 'Modern', 'Crisp, efficient and product-like with clear actions and compact scanning.', ['Technology', 'Agencies', 'B2B services'],
    { primaryColour: '#111827', secondaryColour: '#334155', accentColour: '#2563EB', backgroundColour: '#F8FAFC', surfaceColour: '#FFFFFF', textColour: '#111827', mutedTextColour: '#475569', borderColour: '#CBD5E1' },
    { headingFontKey: 'SYSTEM_SANS', bodyFontKey: 'SYSTEM_SANS', radiusScale: 'MEDIUM', spacingDensity: 'COMFORTABLE', containerWidth: 'WIDE', buttonStyle: 'SOLID', imageStyle: 'ROUNDED', motionPreference: 'REDUCED' }),
  preset('LUXURY', 'Luxury', 'Refined and premium with restrained colour, generous whitespace and elegant imagery.', ['Aesthetics', 'Luxury services', 'Boutique hospitality'],
    { primaryColour: '#241A2A', secondaryColour: '#5B4766', accentColour: '#9B6A2F', backgroundColour: '#FCFAF7', surfaceColour: '#FFFFFF', textColour: '#211822', mutedTextColour: '#5E5662', borderColour: '#DED6E0' },
    { headingFontKey: 'EDITORIAL_SERIF', bodyFontKey: 'SYSTEM_SANS', radiusScale: 'SMALL', spacingDensity: 'AIRY', containerWidth: 'STANDARD', buttonStyle: 'OUTLINE', imageStyle: 'EDITORIAL', motionPreference: 'REDUCED' }),
  preset('WELLNESS', 'Wellness', 'Natural, reassuring and human with soft surfaces and relaxed spacing.', ['Wellbeing', 'Therapy', 'Holistic services'],
    { primaryColour: '#193B36', secondaryColour: '#416A62', accentColour: '#A84E31', backgroundColour: '#F4FAF8', surfaceColour: '#FFFFFF', textColour: '#15312D', mutedTextColour: '#49615D', borderColour: '#CFE0DC' },
    { headingFontKey: 'SYSTEM_SERIF', bodyFontKey: 'SYSTEM_SANS', radiusScale: 'LARGE', spacingDensity: 'AIRY', containerWidth: 'STANDARD', buttonStyle: 'SOFT', imageStyle: 'ROUNDED', motionPreference: 'REDUCED' }),
  preset('CLINICAL', 'Clinical', 'Clear, precise and credible with high legibility and predictable information patterns.', ['Clinics', 'Healthcare', 'Regulated services'],
    { primaryColour: '#12344A', secondaryColour: '#316A82', accentColour: '#007A6F', backgroundColour: '#F7FBFD', surfaceColour: '#FFFFFF', textColour: '#102A3A', mutedTextColour: '#45626F', borderColour: '#C9DCE5' },
    { headingFontKey: 'SYSTEM_SANS', bodyFontKey: 'SYSTEM_SANS', radiusScale: 'SMALL', spacingDensity: 'COMFORTABLE', containerWidth: 'STANDARD', buttonStyle: 'SOLID', imageStyle: 'SQUARE', motionPreference: 'NONE' }),
  preset('FRIENDLY', 'Friendly', 'Approachable and welcoming with rounded forms, warm neutrals and obvious actions.', ['Family services', 'Education', 'Community organisations'],
    { primaryColour: '#3C2A21', secondaryColour: '#775548', accentColour: '#B84A3A', backgroundColour: '#FFF8F4', surfaceColour: '#FFFFFF', textColour: '#33251F', mutedTextColour: '#66534A', borderColour: '#E8D6CE' },
    { headingFontKey: 'SYSTEM_SANS', bodyFontKey: 'SYSTEM_SANS', radiusScale: 'LARGE', spacingDensity: 'COMFORTABLE', containerWidth: 'STANDARD', buttonStyle: 'SOFT', imageStyle: 'ROUNDED', motionPreference: 'REDUCED' }),
  preset('BOLD', 'Bold', 'Direct and high-impact with strong contrast, large type and decisive conversion points.', ['Trades', 'Fitness', 'Campaign landing pages'],
    { primaryColour: '#191919', secondaryColour: '#3D3D3D', accentColour: '#A63D20', backgroundColour: '#FAFAF7', surfaceColour: '#FFFFFF', textColour: '#181818', mutedTextColour: '#555555', borderColour: '#D9D9D4' },
    { headingFontKey: 'SYSTEM_SANS', bodyFontKey: 'SYSTEM_SANS', radiusScale: 'NONE', spacingDensity: 'COMFORTABLE', containerWidth: 'WIDE', buttonStyle: 'SOLID', imageStyle: 'SQUARE', motionPreference: 'STANDARD' }),
  preset('LOCAL', 'Local', 'Practical and familiar with location, trust and contact information prioritised.', ['Local services', 'Trades', 'Multi-location businesses'],
    { primaryColour: '#183B2B', secondaryColour: '#496B54', accentColour: '#A34E2D', backgroundColour: '#F8FBF7', surfaceColour: '#FFFFFF', textColour: '#173126', mutedTextColour: '#52645A', borderColour: '#D5E1D8' },
    { headingFontKey: 'SYSTEM_SERIF', bodyFontKey: 'SYSTEM_SANS', radiusScale: 'MEDIUM', spacingDensity: 'COMFORTABLE', containerWidth: 'STANDARD', buttonStyle: 'SOLID', imageStyle: 'ROUNDED', motionPreference: 'REDUCED' }),
  preset('CREATIVE', 'Creative', 'Expressive and flexible with distinctive colour, asymmetric layouts and visual storytelling.', ['Portfolios', 'Design studios', 'Events and culture'],
    { primaryColour: '#2A1F4F', secondaryColour: '#51407A', accentColour: '#B54B78', backgroundColour: '#FAF8FF', surfaceColour: '#FFFFFF', textColour: '#211A3B', mutedTextColour: '#5A536E', borderColour: '#DDD7EA' },
    { headingFontKey: 'EDITORIAL_SERIF', bodyFontKey: 'SYSTEM_SANS', radiusScale: 'MEDIUM', spacingDensity: 'AIRY', containerWidth: 'WIDE', buttonStyle: 'SOFT', imageStyle: 'EDITORIAL', motionPreference: 'STANDARD' }),
] as const;

function channel(value: number) {
  const normal = value / 255;
  return normal <= 0.04045 ? normal / 12.92 : ((normal + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  const value = hex.replace('#', '');
  return (0.2126 * channel(Number.parseInt(value.slice(0, 2), 16)))
    + (0.7152 * channel(Number.parseInt(value.slice(2, 4), 16)))
    + (0.0722 * channel(Number.parseInt(value.slice(4, 6), 16)));
}

export function siteColourContrastRatio(first: string, second: string) {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

export function siteThemeAccessibilityIssues(theme: SiteThemeEditor) {
  const checks = [
    ['Body text and page background', theme.textColour, theme.backgroundColour, 4.5],
    ['Body text and surface', theme.textColour, theme.surfaceColour, 4.5],
    ['Muted text and page background', theme.mutedTextColour, theme.backgroundColour, 4.5],
    ['White text and primary actions', '#FFFFFF', theme.primaryColour, 4.5],
    ['White text and secondary surfaces', '#FFFFFF', theme.secondaryColour, 4.5],
    ['Primary focus indicator and page background', theme.primaryColour, theme.backgroundColour, 3],
  ] as const;
  return checks.flatMap(([label, foreground, background, minimum]) => {
    const ratio = siteColourContrastRatio(foreground, background);
    return ratio >= minimum ? [] : [`${label} is ${ratio.toFixed(2)}:1; it must be at least ${minimum}:1.`];
  });
}

export function siteDesignPreset(key: SiteDesignPresetKey) {
  return SITE_DESIGN_PRESETS.find(item => item.key === key) ?? SITE_DESIGN_PRESETS[0];
}
