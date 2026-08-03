import { Section, Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';

export interface BusinessBookingConfirmedProps extends EmailBrandingProps {
  recipientName?: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  serviceName: string;
  staffName?: string | null;
  bookingDate: string;
  bookingTime: string;
  emailHeading?: string;
  emailBody?: string;
}

export function BusinessBookingConfirmedEmail({
  tenantName,
  tenantPrimaryColor,
  recipientName,
  customerName,
  customerEmail,
  customerPhone,
  serviceName,
  staffName,
  bookingDate,
  bookingTime,
  emailHeading,
  emailBody,
  ...branding
}: BusinessBookingConfirmedProps) {
  return (
    <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} {...branding} previewText="A new customer booking is confirmed">
      {emailHeading && <Text className="text-gray-950 text-xl font-bold">{emailHeading}</Text>}
      {recipientName && <Text className="text-gray-700">Hi {recipientName},</Text>}
      <Text className="text-gray-800" style={{ whiteSpace: 'pre-line' }}>{emailBody}</Text>
      <Section className="rounded bg-gray-50 p-4">
        <Text className="m-0"><strong>Customer:</strong> {customerName}</Text>
        <Text className="m-0 mt-2"><strong>Service:</strong> {serviceName}</Text>
        <Text className="m-0 mt-2"><strong>Date:</strong> {bookingDate}</Text>
        <Text className="m-0 mt-2"><strong>Time:</strong> {bookingTime}</Text>
        {staffName && <Text className="m-0 mt-2"><strong>Team member:</strong> {staffName}</Text>}
        {customerEmail && <Text className="m-0 mt-2"><strong>Email:</strong> {customerEmail}</Text>}
        {customerPhone && <Text className="m-0 mt-2"><strong>Phone:</strong> {customerPhone}</Text>}
      </Section>
    </BaseEmailLayout>
  );
}

export default BusinessBookingConfirmedEmail;
