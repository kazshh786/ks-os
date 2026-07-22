import { Text } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export const RefundUpdatedEmail = ({ tenantName, tenantPrimaryColor, clientName, status }: any) => (
  <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} previewText="Your refund has been updated">
    <Text>Hello {clientName},</Text><Text>Your refund status is now: {status}.</Text>
  </BaseEmailLayout>
);
export default RefundUpdatedEmail;
