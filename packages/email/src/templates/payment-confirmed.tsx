import { Text } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export const PaymentConfirmedEmail = ({ tenantName, tenantPrimaryColor, clientName, amount, currency = 'GBP', ...branding }: any) => (
  <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} previewText="Your payment is confirmed" {...branding}>
    <Text>Hello {clientName},</Text><Text>We have received your payment of {amount} {currency}.</Text>
  </BaseEmailLayout>
);
export default PaymentConfirmedEmail;
