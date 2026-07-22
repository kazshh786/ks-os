import { Body, Container, Head, Html, Tailwind, Preview, Section, Heading, Text } from '@react-email/components';
import { ReactNode } from 'react';

interface BaseEmailLayoutProps {
  tenantName: string;
  tenantPrimaryColor?: string;
  children: ReactNode;
  previewText?: string;
}

export const BaseEmailLayout = ({ tenantName, tenantPrimaryColor = '#000000', children, previewText }: BaseEmailLayoutProps) => {
  return (
    <Html>
      <Head />
      {previewText && <Preview>{previewText}</Preview>}
      <Tailwind>
        <Body className="bg-gray-100 font-sans">
          <Container className="mx-auto my-[40px] max-w-[600px] p-[20px]">
            <Section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <Section 
                className="p-6 text-center" 
                style={{ backgroundColor: tenantPrimaryColor }}
              >
                <Heading className="text-white m-0 text-xl font-bold">{tenantName}</Heading>
              </Section>
              <Section className="p-6">
                {children}
              </Section>
              <Section className="px-6 pb-6 text-center">
                <Text className="m-0 text-xs text-gray-500">Sent securely by KS OS on behalf of {tenantName}.</Text>
              </Section>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};
