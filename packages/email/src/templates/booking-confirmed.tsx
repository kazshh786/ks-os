import { Button, Text, Section } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';

export interface BookingConfirmedProps extends EmailBrandingProps {
  customerName: string;
  bookingTime?: string;
  bookingDate?: string;
  serviceName: string;
  clientName?: string;
  startTime?: string;
  timezone?: string;
  emailHeading?: string;
  emailBody?: string;
  mainFormName?: string;
  mainFormLink?: string;
}

export const BookingConfirmedEmail = ({
  tenantName,
  tenantPrimaryColor,
  customerName,
  bookingTime,
  bookingDate,
  serviceName,
  clientName,
  startTime,
  timezone = 'Europe/London',
  emailHeading,
  emailBody,
  mainFormName,
  mainFormLink,
  ...branding
}: BookingConfirmedProps) => {
  const instant = startTime ? new Date(startTime) : null;
  const localDate = instant ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: timezone }).format(instant) : bookingDate;
  const localTime = instant ? new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: timezone }).format(instant) : bookingTime;
  return (
    <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} {...branding} previewText="Your booking has been confirmed">
      {emailHeading && <Text className="text-gray-950 text-xl font-bold mb-4">{emailHeading}</Text>}
      <Text className="text-gray-800 text-base mb-4" style={{ whiteSpace: 'pre-line' }}>{emailBody || <>Hi {clientName || customerName}, your booking for <strong>{serviceName}</strong> has been confirmed.</>}</Text>
      <Section className="bg-gray-50 rounded p-4 mb-4">
        {localDate && <Text className="text-gray-800 text-base m-0"><strong>Date:</strong> {localDate}</Text>}
        {localTime && <Text className="text-gray-800 text-base m-0 mt-2"><strong>Time:</strong> {localTime}</Text>}
      </Section>
      {mainFormName && mainFormLink && (
        <Section className="mb-5 rounded border border-gray-200 bg-gray-50 p-4 text-center">
          <Text className="m-0 mb-3 text-base text-gray-800">Please complete <strong>{mainFormName}</strong> before your appointment.</Text>
          <Button href={mainFormLink} style={{ backgroundColor: tenantPrimaryColor || '#000000' }} className="rounded px-6 py-3 font-medium text-white">Complete your form</Button>
        </Section>
      )}
      <Text className="text-gray-800 text-base">We look forward to seeing you!</Text>
    </BaseEmailLayout>
  );
};

export default BookingConfirmedEmail;
