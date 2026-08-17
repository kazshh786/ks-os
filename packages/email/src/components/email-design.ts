import {
  darkenEmailColor,
  ensureReadableTextColor,
  getReadableTextColor,
  lightenEmailColor,
  mixEmailColor,
} from './email-colors.js';

export type EmailDesignStyle = 'CLEAN' | 'EDITORIAL' | 'STUDIO' | 'CONTRAST';

export interface EmailBrandTheme {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  surfaceColor?: string;
  textColor?: string;
  fontFamily?: 'system' | 'sans' | 'serif';
  borderRadius?: 'compact' | 'medium' | 'rounded';
  mode?: 'light' | 'dark' | 'system';
}

export interface EmailDesignTokens {
  canvas: string;
  card: string;
  mutedSurface: string;
  border: string;
  heading: string;
  body: string;
  mutedText: string;
  primaryAction: string;
  primaryActionText: string;
  accentSurface: string;
  accentText: string;
  darkSurface: string;
  darkSurfaceText: string;
  successSurface: string;
  warningSurface: string;
}

export interface EmailDesign {
  style: EmailDesignStyle;
  tokens: EmailDesignTokens;
  radius: { card: number; panel: number; button: number };
  spacing: { content: string; section: string };
  typography: { body: string; heading: string; headingSize: string; headingWeight: number };
  cardShadow?: string;
  heroAlignment: 'left' | 'center';
}

const DEFAULT_THEME: Required<EmailBrandTheme> = {
  primaryColor: '#0f172a',
  secondaryColor: '#475569',
  accentColor: '#4f46e5',
  surfaceColor: '#ffffff',
  textColor: '#0f172a',
  fontFamily: 'system',
  borderRadius: 'rounded',
  mode: 'light',
};

const validHex = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;

function normaliseTheme(theme?: EmailBrandTheme): Required<EmailBrandTheme> {
  return {
    primaryColor: validHex(theme?.primaryColor, DEFAULT_THEME.primaryColor),
    secondaryColor: validHex(theme?.secondaryColor, DEFAULT_THEME.secondaryColor),
    accentColor: validHex(theme?.accentColor, DEFAULT_THEME.accentColor),
    surfaceColor: validHex(theme?.surfaceColor, DEFAULT_THEME.surfaceColor),
    textColor: validHex(theme?.textColor, DEFAULT_THEME.textColor),
    fontFamily: theme?.fontFamily || DEFAULT_THEME.fontFamily,
    borderRadius: theme?.borderRadius || DEFAULT_THEME.borderRadius,
    mode: theme?.mode || DEFAULT_THEME.mode,
  };
}

export function getEmailDesign(style: EmailDesignStyle = 'CLEAN', sourceTheme?: EmailBrandTheme): EmailDesign {
  const theme = normaliseTheme(sourceTheme);
  const primaryAction = theme.primaryColor;
  const darkSurface = darkenEmailColor(mixEmailColor(theme.primaryColor, theme.secondaryColor, 0.45), 0.58);
  const card = lightenEmailColor(theme.surfaceColor, 0.72);
  const shared = {
    heading: ensureReadableTextColor(card, theme.textColor),
    body: ensureReadableTextColor(card, mixEmailColor(theme.textColor, theme.secondaryColor, 0.28)),
    mutedText: ensureReadableTextColor(card, mixEmailColor(theme.textColor, '#64748b', 0.62), 3),
    primaryAction,
    primaryActionText: getReadableTextColor(primaryAction),
    darkSurface,
    darkSurfaceText: getReadableTextColor(darkSurface),
    successSurface: lightenEmailColor(mixEmailColor(theme.primaryColor, '#16a34a', 0.62), 0.86),
    warningSurface: lightenEmailColor(mixEmailColor(theme.accentColor, '#d97706', 0.55), 0.84),
  };

  if (style === 'EDITORIAL') {
    const editorialCard = lightenEmailColor(theme.surfaceColor, 0.82);
    return {
      style,
      tokens: {
        ...shared,
        canvas: lightenEmailColor(theme.secondaryColor, 0.91),
        card: editorialCard,
        mutedSurface: lightenEmailColor(theme.secondaryColor, 0.94),
        border: lightenEmailColor(theme.secondaryColor, 0.76),
        heading: ensureReadableTextColor(editorialCard, theme.textColor),
        body: ensureReadableTextColor(editorialCard, mixEmailColor(theme.textColor, theme.secondaryColor, 0.22)),
        accentSurface: lightenEmailColor(theme.accentColor, 0.86),
        accentText: ensureReadableTextColor(lightenEmailColor(theme.accentColor, 0.86), theme.textColor),
      },
      radius: { card: 4, panel: 2, button: 2 },
      spacing: { content: '38px 34px 28px', section: '28px' },
      typography: {
        body: 'Arial, Helvetica, sans-serif',
        heading: 'Georgia, Times New Roman, serif',
        headingSize: '34px',
        headingWeight: 500,
      },
      heroAlignment: 'left',
    };
  }

  if (style === 'STUDIO') {
    return {
      style,
      tokens: {
        ...shared,
        canvas: lightenEmailColor(mixEmailColor(theme.primaryColor, theme.accentColor, 0.3), 0.86),
        card,
        mutedSurface: lightenEmailColor(theme.secondaryColor, 0.91),
        border: lightenEmailColor(theme.primaryColor, 0.72),
        accentSurface: lightenEmailColor(theme.accentColor, 0.8),
        accentText: ensureReadableTextColor(lightenEmailColor(theme.accentColor, 0.8), theme.textColor),
      },
      radius: { card: 20, panel: 14, button: 12 },
      spacing: { content: '34px 30px 26px', section: '24px' },
      typography: {
        body: 'Arial, Helvetica, sans-serif',
        heading: 'Arial, Helvetica, sans-serif',
        headingSize: '31px',
        headingWeight: 800,
      },
      cardShadow: '0 18px 45px rgba(15, 23, 42, 0.16)',
      heroAlignment: 'left',
    };
  }

  if (style === 'CONTRAST') {
    const accentSurface = theme.accentColor;
    return {
      style,
      tokens: {
        ...shared,
        canvas: darkSurface,
        card,
        mutedSurface: lightenEmailColor(theme.secondaryColor, 0.88),
        border: mixEmailColor(theme.primaryColor, theme.secondaryColor, 0.48),
        accentSurface,
        accentText: getReadableTextColor(accentSurface),
      },
      radius: { card: 2, panel: 2, button: 2 },
      spacing: { content: '34px 30px 28px', section: '26px' },
      typography: {
        body: 'Arial, Helvetica, sans-serif',
        heading: 'Arial Black, Arial, Helvetica, sans-serif',
        headingSize: '34px',
        headingWeight: 900,
      },
      heroAlignment: 'left',
    };
  }

  return {
    style: 'CLEAN',
    tokens: {
      ...shared,
      canvas: lightenEmailColor(theme.secondaryColor, 0.94),
      card,
      mutedSurface: lightenEmailColor(theme.secondaryColor, 0.93),
      border: lightenEmailColor(theme.secondaryColor, 0.78),
      accentSurface: lightenEmailColor(theme.accentColor, 0.88),
      accentText: ensureReadableTextColor(lightenEmailColor(theme.accentColor, 0.88), theme.textColor),
    },
    radius: { card: 12, panel: 10, button: 8 },
    spacing: { content: '32px 28px 24px', section: '22px' },
    typography: {
      body: 'Arial, Helvetica, sans-serif',
      heading: 'Arial, Helvetica, sans-serif',
      headingSize: '30px',
      headingWeight: 800,
    },
    heroAlignment: 'left',
  };
}
