import { Text, Section } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';

export interface RefundUpdatedProps extends EmailBrandingProps {
  clientName?: string;
  customerName?: string;
  status: string;
  refundAmount?: string | number;
  currency?: string;
  emailHeading?: string;
  emailBody?: string;
}

export const RefundUpdatedEmail = ({
  tenantName,
  tenantPrimaryColor,
  clientName,
  customerName,
  status,
  refundAmount,
  currency = 'GBP',
  emailHeading,
  emailBody,
  ...branding
}: RefundUpdatedProps) => (
  <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} previewText="Your refund has been updated" {...branding}>
    {emailHeading && <Text className="text-gray-950 text-xl font-bold mb-4">{emailHeading}</Text>}
    <Text className="text-gray-800 text-base mb-4" style={{ whiteSpace: 'pre-line' }}>{emailBody || <>Hello {clientName || customerName}, your refund has been updated.</>}</Text>
    <Section className="rounded bg-gray-50 p-4">
      <Text className="m-0 text-base text-gray-800"><strong>Status:</strong> {status}</Text>
      {refundAmount && <Text className="m-0 mt-2 text-base text-gray-800"><strong>Refund amount:</strong> {refundAmount} {currency}</Text>}
    </Section>
  </BaseEmailLayout>
);

export default RefundUpdatedEmail;
