import { Body, Container, Head, Html, Preview, Section, Tailwind } from '@react-email/components';
import type { ReactNode } from 'react';
import { BrandLogoPanel, EmailFooter } from './FormEmailComponents.js';
import {
  getEmailDesign,
  type EmailBrandTheme,
  type EmailDesignStyle,
} from './email-design.js';

export interface EmailBrandingProps {
  tenantName: string;
  tenantPrimaryColor?: string;
  businessName?: string;
  businessEmail?: string | null;
  businessPhone?: string | null;
  businessAddress?: string | null;
  businessWebsiteUrl?: string | null;
  businessLogoUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  tiktokUrl?: string | null;
  emailDesignStyle?: EmailDesignStyle;
  emailTheme?: EmailBrandTheme;
}

interface BaseEmailLayoutProps extends EmailBrandingProps {
  children: ReactNode;
  previewText?: string;
}

export const BaseEmailLayout = ({
  tenantName,
  tenantPrimaryColor = '#0f172a',
  businessName = tenantName,
  businessEmail,
  businessPhone,
  businessAddress,
  businessWebsiteUrl,
  businessLogoUrl,
  emailDesignStyle = 'CLEAN',
  emailTheme,
  children,
  previewText,
}: BaseEmailLayoutProps) => {
  const design = getEmailDesign(emailDesignStyle, {
    ...emailTheme,
    primaryColor: emailTheme?.primaryColor || tenantPrimaryColor,
  });
  return (
    <Html lang="en" dir="ltr">
      <Head />
      {previewText ? <Preview>{previewText}</Preview> : null}
      <Tailwind>
        <Body style={{ backgroundColor: design.tokens.canvas, fontFamily: design.typography.body, margin: 0 }}>
          <Container style={{ margin: '32px auto', maxWidth: '620px', padding: '0 14px' }}>
            <BrandLogoPanel
              businessName={businessName}
              businessLogoUrl={businessLogoUrl}
              design={design}
            />
            <Section style={{
              backgroundColor: design.tokens.card,
              border: '1px solid ' + design.tokens.border,
              borderRadius: design.radius.card + 'px',
              boxShadow: design.cardShadow,
              marginTop: design.style === 'STUDIO' ? '18px' : '10px',
              overflow: 'hidden',
            }}>
              <Section style={{ padding: design.spacing.content }}>{children}</Section>
              <EmailFooter
                tenantName={tenantName}
                businessName={businessName}
                businessAddress={businessAddress}
                businessEmail={businessEmail}
                businessPhone={businessPhone}
                businessWebsiteUrl={businessWebsiteUrl}
                design={design}
              />
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};
