import { Body, Container, Head, Html, Tailwind, Preview, Section, Heading, Text, Link, Img } from '@react-email/components';
import { ReactNode } from 'react';

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
  tenantPrimaryColor = '#000000',
  businessName = tenantName,
  businessEmail,
  businessPhone,
  businessAddress,
  businessWebsiteUrl,
  businessLogoUrl,
  instagramUrl,
  facebookUrl,
  tiktokUrl,
  children,
  previewText,
}: BaseEmailLayoutProps) => {
  const socialLinks = [
    ['Instagram', instagramUrl],
    ['Facebook', facebookUrl],
    ['TikTok', tiktokUrl],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <Html>
      <Head />
      {previewText && <Preview>{previewText}</Preview>}
      <Tailwind>
        <Body className="bg-gray-100 font-sans">
          <Container className="mx-auto my-[40px] max-w-[600px] p-[20px]">
            <Section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <Section className="p-6 text-center" style={{ backgroundColor: tenantPrimaryColor }}>
                {businessLogoUrl && <Img src={businessLogoUrl} alt={businessName + ' logo'} className="mx-auto mb-3 max-h-16 max-w-40 object-contain" />}
                <Heading className="text-white m-0 text-xl font-bold">{businessName}</Heading>
              </Section>
              <Section className="p-6">
                {children}
              </Section>
              <Section className="px-6 pb-6 text-center">
                {socialLinks.length > 0 && (
                  <Section className="mb-5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-4">
                    <Text className="m-0 mb-3 text-sm font-bold text-gray-900">Check us out on our socials</Text>
                    <Text className="m-0 text-sm">
                      {socialLinks.map(([label, url], index) => (
                        <span key={label}>
                          {index > 0 && <span>&nbsp;&nbsp;·&nbsp;&nbsp;</span>}
                          <Link href={url} className="font-bold text-gray-800">{label}</Link>
                        </span>
                      ))}
                    </Text>
                  </Section>
                )}
                {(businessAddress || businessPhone || businessEmail || businessWebsiteUrl) && (
                  <Text className="m-0 mb-3 text-xs leading-5 text-gray-600">
                    {businessAddress && <span>{businessAddress}<br /></span>}
                    {businessPhone && <span>{businessPhone}<br /></span>}
                    {businessEmail && <Link href={'mailto:' + businessEmail} className="text-gray-600">{businessEmail}</Link>}
                    {businessEmail && businessWebsiteUrl && <span> · </span>}
                    {businessWebsiteUrl && <Link href={businessWebsiteUrl} className="text-gray-600">Website</Link>}
                  </Text>
                )}
                <Text className="m-0 text-xs text-gray-500">Sent securely by KS OS on behalf of {tenantName}.</Text>
              </Section>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};
