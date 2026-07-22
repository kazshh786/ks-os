import { Text, Section } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export interface BookingRescheduledProps {
  tenantName: string;
  tenantPrimaryColor?: string;
  customerName: string;
  bookingReference?: string;
  oldDateTime?: string;
  newDateTime?: string;
  newBookingTime?: string;
  newBookingDate?: string;
  serviceName: string;
  staffName?: string;
  location?: string;
  managementUrl?: string;
}

export const BookingRescheduledEmail = ({
  tenantName,
  tenantPrimaryColor,
  customerName,
  bookingReference,
  oldDateTime,
  newDateTime,
  newBookingTime,
  newBookingDate,
  serviceName,
  staffName,
  location,
  managementUrl,
}: BookingRescheduledProps) => {
  return (
    <BaseEmailLayout 
      tenantName={tenantName} 
      tenantPrimaryColor={tenantPrimaryColor}
      previewText="Your booking has been rescheduled"
    >
      <Text className="text-gray-800 text-base mb-4">Hi {customerName},</Text>
      <Text className="text-gray-800 text-base mb-4">Your booking for <strong>{serviceName}</strong> has been rescheduled. Your new details are below:</Text>
      <Section className="bg-gray-50 rounded p-4 mb-4">
        {bookingReference && <Text className="text-gray-800 text-base m-0"><strong>Booking:</strong> {bookingReference}</Text>}
        {oldDateTime && <Text className="text-gray-800 text-base m-0 mt-2"><strong>Previous time:</strong> {oldDateTime}</Text>}
        <Text className="text-gray-800 text-base m-0 mt-2"><strong>New time:</strong> {newDateTime || `${newBookingDate || ''} ${newBookingTime || ''}`}</Text>
        {staffName && <Text className="text-gray-800 text-base m-0 mt-2"><strong>Team member:</strong> {staffName}</Text>}
        {location && <Text className="text-gray-800 text-base m-0 mt-2"><strong>Location:</strong> {location}</Text>}
      </Section>
      {managementUrl && <Text className="text-gray-800 text-base"><a href={managementUrl}>Manage this booking</a></Text>}
      <Text className="text-gray-800 text-base">We look forward to seeing you!</Text>
    </BaseEmailLayout>
  );
};

export default BookingRescheduledEmail;
