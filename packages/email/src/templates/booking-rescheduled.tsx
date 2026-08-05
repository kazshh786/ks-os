import { Text, Section } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';

export interface BookingRescheduledProps extends EmailBrandingProps {
  customerName: string;
  clientName?: string;
  bookingReference?: string;
  oldDateTime?: string;
  newDateTime?: string;
  newBookingTime?: string;
  newBookingDate?: string;
  serviceName: string;
  staffName?: string;
  location?: string;
  managementUrl?: string;
  emailHeading?: string;
  emailBody?: string;
}

export const BookingRescheduledEmail = ({
  tenantName,
  tenantPrimaryColor,
  customerName,
  clientName,
  bookingReference,
  oldDateTime,
  newDateTime,
  newBookingTime,
  newBookingDate,
  serviceName,
  staffName,
  location,
  managementUrl,
  emailHeading,
  emailBody,
  ...branding
}: BookingRescheduledProps) => (
  <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} {...branding} previewText="Your booking has been rescheduled">
    {emailHeading && <Text className="text-gray-950 text-xl font-bold mb-4">{emailHeading}</Text>}
    <Text className="text-gray-800 text-base mb-4" style={{ whiteSpace: 'pre-line' }}>{emailBody || <>Hi {clientName || customerName}, your booking for <strong>{serviceName}</strong> has been rescheduled.</>}</Text>
    <Section className="bg-gray-50 rounded p-4 mb-4">
      {bookingReference && <Text className="text-gray-800 text-base m-0"><strong>Booking:</strong> {bookingReference}</Text>}
      {oldDateTime && <Text className="text-gray-800 text-base m-0 mt-2"><strong>Previous time:</strong> {oldDateTime}</Text>}
      <Text className="text-gray-800 text-base m-0 mt-2"><strong>New time:</strong> {newDateTime || `${newBookingDate || ''} ${newBookingTime || ''}`}</Text>
      {staffName && <Text className="text-gray-800 text-base m-0 mt-2"><strong>Team member:</strong> {staffName}</Text>}
      {location && <Text className="text-gray-800 text-base m-0 mt-2"><strong>Location:</strong> {location}</Text>}
    </Section>
    {managementUrl && <Text className="text-gray-800 text-base"><a href={managementUrl}>Manage this booking</a></Text>}
  </BaseEmailLayout>
);

export default BookingRescheduledEmail;
