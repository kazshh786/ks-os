import { z } from 'zod';

export const SiteDesignPresetKeySchema = z.enum([
  'NORTHLIGHT',
  'EDITORIAL',
  'MODERN',
  'LUXURY',
  'WELLNESS',
  'CLINICAL',
  'FRIENDLY',
  'BOLD',
  'LOCAL',
  'CREATIVE',
]);
export type SiteDesignPresetKey = z.infer<typeof SiteDesignPresetKeySchema>;

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
}).strict();
export type SiteThemeEditor = z.infer<typeof SiteThemeEditorSchema>;

export const UpdateSiteStudioThemeSchema = z.object({
  presetKey: SiteDesignPresetKeySchema.optional(),
  theme: SiteThemeEditorSchema,
}).strict();
export type UpdateSiteStudioTheme = z.infer<typeof UpdateSiteStudioThemeSchema>;

export const SiteStudioSectionVariantSchema = z.enum([
  'editorial',
  'grid',
  'split',
  'compact',
  'standard',
  'featured',
  'quiet',
]);
export type SiteStudioSectionVariant = z.infer<typeof SiteStudioSectionVariantSchema>;

export const UpdateSiteStudioSectionVariantSchema = z.object({
  variant: SiteStudioSectionVariantSchema,
}).strict();

export interface SiteDesignPreset {
  key: SiteDesignPresetKey;
  name: string;
  description: string;
  bestFor: string[];
  theme: SiteThemeEditor;
}

export const SITE_DESIGN_PRESETS: readonly SiteDesignPreset[] = [
  {
    key: 'NORTHLIGHT',
    name: 'Northlight',
    description: 'Calm, trustworthy and spacious with a strong service-led hierarchy.',
    bestFor: ['Appointment businesses', 'Consultants', 'Professional services'],
    theme: {
      primaryColour: '#16324F', secondaryColour: '#365E71', accentColour: '#A64F2A',
      backgroundColour: '#F8FAFC', surfaceColour: '#FFFFFF', textColour: '#172025',
      mutedTextColour: '#4B5563', borderColour: '#D7DEE5', headingFontKey: 'SYSTEM_SERIF',
      bodyFontKey: 'SYSTEM_SANS', radiusScale: 'LARGE', spacingDensity: 'AIRY',
      containerWidth: 'STANDARD', buttonStyle: 'SOLID', imageStyle: 'ROUNDED',
      motionPreference: 'REDUCED',
    },
  },
  {
    key: 'EDITORIAL',
    name: 'Editorial',
    description: 'Warm, considered and content-rich with magazine-inspired typography.',
    bestFor: ['Creative studios', 'Coaches', 'Premium personal brands'],
    theme: {
      primaryColour: '#2B2118', secondaryColour: '#6B5B4D', accentColour: '#A14D2F',
      backgroundColour: '#FBF7F2', surfaceColour: '#FFFFFF', textColour: '#211A15',
      mutedTextColour: '#5F574F', borderColour: '#DED5CB', headingFontKey: 'EDITORIAL_SERIF',
      bodyFontKey: 'SYSTEM_SERIF', radiusScale: 'SMALL', spacingDensity: 'AIRY',
      containerWidth: 'NARROW', buttonStyle: 'OUTLINE', imageStyle: 'EDITORIAL',
      motionPreference: 'REDUCED',
    },
  },
  {
    key: 'MODERN',
    name: 'Modern',
    description: 'Crisp, efficient and product-like with clear actions and compact scanning.',
    bestFor: ['Technology', 'Agencies', 'B2B services'],
    theme: {
      primaryColour: '#111827', secondaryColour: '#334155', accentColour: '#2563EB',
      backgroundColour: '#F8FAFC', surfaceColour: '#FFFFFF', textColour: '#111827',
      mutedTextColour: '#475569', borderColour: '#CBD5E1', headingFontKey: 'SYSTEM_SANS',
      bodyFontKey: 'SYSTEM_SANS', radiusScale: 'MEDIUM', spacingDensity: 'COMFORTABLE',
      containerWidth: 'WIDE', buttonStyle: 'SOLID', imageStyle: 'ROUNDED',
      motionPreference: 'REDUCED',
    },
  },
  {
    key: 'LUXURY',
    name: 'Luxury',
    description: 'Refined and premium with restrained colour, generous whitespace and elegant imagery.',
    bestFor: ['Aesthetics', 'Luxury services', 'Boutique hospitality'],
    theme: {
      primaryColour: '#241A2A', secondaryColour: '#5B4766', accentColour: '#9B6A2F',
      backgroundColour: '#FCFAF7', surfaceColour: '#FFFFFF', textColour: '#211822',
      mutedTextColour: '#5E5662', borderColour: '#DED6E0', headingFontKey: 'EDITORIAL_SERIF',
      bodyFontKey: 'SYSTEM_SANS', radiusScale: 'SMALL', spacingDensity: 'AIRY',
      containerWidth: 'STANDARD', buttonStyle: 'OUTLINE', imageStyle: 'EDITORIAL',
      motionPreference: 'REDUCED',
    },
  },
  {
    key: 'WELLNESS',
    name: 'Wellness',
    description: 'Natural, reassuring and human with soft surfaces and relaxed spacing.',
    bestFor: ['Wellbeing', 'Therapy', 'Holistic services'],
    theme: {
      primaryColour: '#193B36', secondaryColour: '#416A62', accentColour: '#A84E31',
      backgroundColour: '#F4FAF8', surfaceColour: '#FFFFFF', textColour: '#15312D',
      mutedTextColour: '#49615D', borderColour: '#CFE0DC', headingFontKey: 'SYSTEM_SERIF',
      bodyFontKey: 'SYSTEM_SANS', radiusScale: 'LARGE', spacingDensity: 'AIRY',
      containerWidth: 'STANDARD', buttonStyle: 'SOFT', imageStyle: 'ROUNDED',
      motionPreference: 'REDUCED',
    },
  },
  {
    key: 'CLINICAL',
    name: 'Clinical',
    description: 'Clear, precise and credible with high legibility and predictable information patterns.',
    bestFor: ['Clinics', 'Healthcare', 'Regulated services'],
    theme: {
      primaryColour: '#12344A', secondaryColour: '#316A82', accentColour: '#007A6F',
      backgroundColour: '#F7FBFD', surfaceColour: '#FFFFFF', textColour: '#102A3A',
      mutedTextColour: '#45626F', borderColour: '#C9DCE5', headingFontKey: 'SYSTEM_SANS',
      bodyFontKey: 'SYSTEM_SANS', radiusScale: 'SMALL', spacingDensity: 'COMFORTABLE',
      containerWidth: 'STANDARD', buttonStyle: 'SOLID', imageStyle: 'SQUARE',
      motionPreference: 'NONE',
    },
  },
  {
    key: 'FRIENDLY',
    name: 'Friendly',
    description: 'Approachable and welcoming with rounded forms, warm neutrals and obvious actions.',
    bestFor: ['Family services', 'Education', 'Community organisations'],
    theme: {
      primaryColour: '#3C2A21', secondaryColour: '#775548', accentColour: '#B84A3A',
      backgroundColour: '#FFF8F4', surfaceColour: '#FFFFFF', textColour: '#33251F',
      mutedTextColour: '#66534A', borderColour: '#E8D6CE', headingFontKey: 'SYSTEM_SANS',
      bodyFontKey: 'SYSTEM_SANS', radiusScale: 'LARGE', spacingDensity: 'COMFORTABLE',
      containerWidth: 'STANDARD', buttonStyle: 'SOFT', imageStyle: 'ROUNDED',
      motionPreference: 'REDUCED',
    },
  },
  {
    key: 'BOLD',
    name: 'Bold',
    description: 'Direct and high-impact with strong contrast, large type and decisive conversion points.',
    bestFor: ['Trades', 'Fitness', 'Campaign landing pages'],
    theme: {
      primaryColour: '#191919', secondaryColour: '#3D3D3D', accentColour: '#A63D20',
      backgroundColour: '#FAFAF7', surfaceColour: '#FFFFFF', textColour: '#181818',
      mutedTextColour: '#555555', borderColour: '#D9D9D4', headingFontKey: 'SYSTEM_SANS',
      bodyFontKey: 'SYSTEM_SANS', radiusScale: 'NONE', spacingDensity: 'COMFORTABLE',
      containerWidth: 'WIDE', buttonStyle: 'SOLID', imageStyle: 'SQUARE',
      motionPreference: 'STANDARD',
    },
  },
  {
    key: 'LOCAL',
    name: 'Local',
    description: 'Practical and familiar with location, trust and contact information prioritised.',
    bestFor: ['Local services', 'Trades', 'Multi-location businesses'],
    theme: {
      primaryColour: '#183B2B', secondaryColour: '#496B54', accentColour: '#A34E2D',
      backgroundColour: '#F8FBF7', surfaceColour: '#FFFFFF', textColour: '#173126',
      mutedTextColour: '#52645A', borderColour: '#D5E1D8', headingFontKey: 'SYSTEM_SERIF',
      bodyFontKey: 'SYSTEM_SANS', radiusScale: 'MEDIUM', spacingDensity: 'COMFORTABLE',
      containerWidth: 'STANDARD', buttonStyle: 'SOLID', imageStyle: 'ROUNDED',
      motionPreference: 'REDUCED',
    },
  },
  {
    key: 'CREATIVE',
    name: 'Creative',
    description: 'Expressive and flexible with distinctive colour, asymmetric layouts and visual storytelling.',
    bestFor: ['Portfolios', 'Design studios', 'Events and culture'],
    theme: {
      primaryColour: '#2A1F4F', secondaryColour: '#51407A', accentColour: '#B54B78',
      backgroundColour: '#FAF8FF', surfaceColour: '#FFFFFF', textColour: '#211A3B',
      mutedTextColour: '#5A536E', borderColour: '#DDD7EA', headingFontKey: 'EDITORIAL_SERIF',
      bodyFontKey: 'SYSTEM_SANS', radiusScale: 'MEDIUM', spacingDensity: 'AIRY',
      containerWidth: 'WIDE', buttonStyle: 'SOFT', imageStyle: 'EDITORIAL',
      motionPreference: 'STANDARD',
    },
  },
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
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function siteThemeAccessibilityIssues(theme: SiteThemeEditor) {
  const checks = [
    ['Body text and page background', theme.textColour, theme.backgroundColour, 4.5],
    ['Body text and surface', theme.textColour, theme.surfaceColour, 4.5],
    ['Muted text and page background', theme.mutedTextColour, theme.backgroundColour, 4.5],
    ['White text and primary actions', '#FFFFFF', theme.primaryColour, 4.5],
    ['White text and secondary surfaces', '#FFFFFF', theme.secondaryColour, 4.5],
    ['Primary focus indicator and page background', theme.primaryColour, theme.backgroundColour, 3],
    ['Borders and page background', theme.borderColour, theme.backgroundColour, 1.5],
  ] as const;
  return checks.flatMap(([label, foreground, background, minimum]) => {
    const ratio = siteColourContrastRatio(foreground, background);
    return ratio >= minimum ? [] : [`${label} is ${ratio.toFixed(2)}:1; it must be at least ${minimum}:1.`];
  });
}

export function siteDesignPreset(key: SiteDesignPresetKey) {
  return SITE_DESIGN_PRESETS.find(preset => preset.key === key) ?? SITE_DESIGN_PRESETS[0];
}
