import { Body, Container, Head, Html, Preview, Section, Tailwind } from '@react-email/components';
import { ReactNode } from 'react';
import { BrandHeader, EmailFooter } from './FormEmailComponents.js';

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
}

interface BaseEmailLayoutProps extends EmailBrandingProps {
  children: ReactNode;
  previewText?: string;
}

export const BaseEmailLayout = ({
  tenantName,
  tenantPrimaryColor = '#111827',
  businessName = tenantName,
  businessAddress,
  businessLogoUrl,
  children,
  previewText,
}: BaseEmailLayoutProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    {previewText ? <Preview>{previewText}</Preview> : null}
    <Tailwind>
      <Body style={{ backgroundColor: '#f3f4f6', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0 }}>
        <Container style={{ margin: '40px auto', maxWidth: '600px', padding: '0 16px' }}>
          <Section style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden' }}>
            <BrandHeader
              businessName={businessName}
              businessLogoUrl={businessLogoUrl}
              brandColor={tenantPrimaryColor}
            />
            <Section style={{ padding: '28px 24px 20px' }}>{children}</Section>
            <EmailFooter tenantName={tenantName} businessAddress={businessAddress} />
          </Section>
        </Container>
      </Body>
    </Tailwind>
  </Html>
);
