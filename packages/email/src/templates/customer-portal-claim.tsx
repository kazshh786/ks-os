import { Button, Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';

export interface CustomerPortalClaimProps extends EmailBrandingProps {
  customerName: string;
  claimUrl?: string;
  bookingManagementUrl?: string;
  emailHeading?: string;
  emailBody?: string;
}

export const CustomerPortalClaimEmail = ({
  tenantName,
  tenantPrimaryColor,
  customerName,
  claimUrl,
  bookingManagementUrl,
  emailHeading,
  emailBody,
  ...branding
}: CustomerPortalClaimProps) => (
  <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} {...branding} previewText="View your customer portal">
    {emailHeading && <Text className="text-gray-950 text-xl font-bold mb-4">{emailHeading}</Text>}
    <Text className="text-gray-800 text-base mb-5" style={{ whiteSpace: 'pre-line' }}>{emailBody || <>Hi {customerName}, use the secure link below to view your appointments, forms and payment updates.</>}</Text>
    {claimUrl && <>
      <Button href={claimUrl} style={{ backgroundColor: tenantPrimaryColor || '#0f172a' }} className="rounded px-5 py-3 text-white">View customer portal</Button>
      <Text className="text-gray-500 text-sm mt-5">The portal claim link expires in seven days and can only be used once.</Text>
    </>}
    {bookingManagementUrl && <>
      <Text className="text-gray-800 text-base mb-4">You can also manage this booking without signing in. This separate secure link grants access to this booking only.</Text>
      <Button href={bookingManagementUrl} className="rounded bg-slate-700 px-5 py-3 text-white">Manage this booking</Button>
    </>}
  </BaseEmailLayout>
);

export default CustomerPortalClaimEmail;
