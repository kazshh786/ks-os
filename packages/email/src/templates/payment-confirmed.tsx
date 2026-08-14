import { Text, Section } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';

export interface PaymentConfirmedProps extends EmailBrandingProps {
  clientName?: string;
  customerName?: string;
  amount: string | number;
  currency?: string;
  serviceName?: string;
  emailHeading?: string;
  emailBody?: string;
}

export const PaymentConfirmedEmail = ({
  tenantName,
  tenantPrimaryColor,
  clientName,
  customerName,
  amount,
  currency = 'GBP',
  serviceName,
  emailHeading,
  emailBody,
  ...branding
}: PaymentConfirmedProps) => (
  <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} previewText="Your payment is confirmed" {...branding}>
    {emailHeading && <Text className="text-gray-950 text-xl font-bold mb-4">{emailHeading}</Text>}
    <Text className="text-gray-800 text-base mb-4" style={{ whiteSpace: 'pre-line' }}>{emailBody || <>Hello {clientName || customerName}, we have received your payment.</>}</Text>
    <Section className="rounded bg-gray-50 p-4">
      <Text className="m-0 text-base text-gray-800"><strong>Amount:</strong> {amount} {currency}</Text>
      {serviceName && <Text className="m-0 mt-2 text-base text-gray-800"><strong>For:</strong> {serviceName}</Text>}
    </Section>
  </BaseEmailLayout>
);

export default PaymentConfirmedEmail;
