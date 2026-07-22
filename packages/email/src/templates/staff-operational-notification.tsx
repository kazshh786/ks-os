import { Text } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export const StaffOperationalNotificationEmail = ({ tenantName, tenantPrimaryColor, staffName, message }: any) => (
  <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} previewText="Operational notification">
    <Text>Hello {staffName},</Text><Text>{message}</Text>
  </BaseEmailLayout>
);
export default StaffOperationalNotificationEmail;
