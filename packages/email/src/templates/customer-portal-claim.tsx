import { Button, Text } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export interface CustomerPortalClaimProps {
  tenantName: string;
  tenantPrimaryColor?: string;
  customerName: string;
  claimUrl?: string;
  bookingManagementUrl?: string;
}

export const CustomerPortalClaimEmail = ({ tenantName, tenantPrimaryColor, customerName, claimUrl, bookingManagementUrl }: CustomerPortalClaimProps) => (
  <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} previewText="View your customer portal">
    <Text className="text-gray-800 text-base mb-4">Hi {customerName},</Text>
    {claimUrl && <>
      <Text className="text-gray-800 text-base mb-5">Use this secure, one-time link to sign in and view your appointments, forms, and payment updates.</Text>
      <Button href={claimUrl} className="rounded bg-slate-900 px-5 py-3 text-white">View in customer portal</Button>
      <Text className="text-gray-500 text-sm mt-5">The portal claim link expires in seven days and can only be used once.</Text>
    </>}
    {bookingManagementUrl && <>
      <Text className="text-gray-800 text-base mb-4">You can also manage this booking without signing in. This separate secure link grants access to this booking only.</Text>
      <Button href={bookingManagementUrl} className="rounded bg-slate-700 px-5 py-3 text-white">Manage this booking</Button>
    </>}
  </BaseEmailLayout>
);

export default CustomerPortalClaimEmail;
