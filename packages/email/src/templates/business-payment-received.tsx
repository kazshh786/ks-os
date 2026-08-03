import { Section, Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';

export interface BusinessPaymentReceivedProps extends EmailBrandingProps {
  recipientName?: string;
  customerName: string;
  serviceName?: string | null;
  amount: string;
  currency: string;
  emailHeading?: string;
  emailBody?: string;
}

export function BusinessPaymentReceivedEmail({
  tenantName,
  tenantPrimaryColor,
  recipientName,
  customerName,
  serviceName,
  amount,
  currency,
  emailHeading,
  emailBody,
  ...branding
}: BusinessPaymentReceivedProps) {
  return (
    <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} {...branding} previewText="A customer payment has been received">
      {emailHeading && <Text className="text-gray-950 text-xl font-bold">{emailHeading}</Text>}
      {recipientName && <Text className="text-gray-700">Hi {recipientName},</Text>}
      <Text className="text-gray-800" style={{ whiteSpace: 'pre-line' }}>{emailBody}</Text>
      <Section className="rounded bg-emerald-50 p-4">
        <Text className="m-0"><strong>Amount:</strong> {amount} {currency}</Text>
        <Text className="m-0 mt-2"><strong>Customer:</strong> {customerName}</Text>
        {serviceName && <Text className="m-0 mt-2"><strong>Service:</strong> {serviceName}</Text>}
      </Section>
    </BaseEmailLayout>
  );
}

export default BusinessPaymentReceivedEmail;
