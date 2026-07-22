import { Text } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export interface BookingCancelledProps {
  tenantName: string;
  tenantPrimaryColor?: string;
  customerName: string;
  serviceName: string;
  bookingReference?: string;
  cancelledDateTime?: string;
  paymentImpact?: string;
  contactPhone?: string;
  managementUrl?: string;
}

export const BookingCancelledEmail = ({
  tenantName,
  tenantPrimaryColor,
  customerName,
  serviceName,
  bookingReference,
  cancelledDateTime,
  paymentImpact,
  contactPhone,
  managementUrl,
}: BookingCancelledProps) => {
  return (
    <BaseEmailLayout 
      tenantName={tenantName} 
      tenantPrimaryColor={tenantPrimaryColor}
      previewText="Your booking has been cancelled"
    >
      <Text className="text-gray-800 text-base mb-4">Hi {customerName},</Text>
      <Text className="text-gray-800 text-base mb-4">Your booking for <strong>{serviceName}</strong> has been cancelled.</Text>
      {bookingReference && <Text className="text-gray-800 text-base mb-2"><strong>Booking:</strong> {bookingReference}</Text>}
      {cancelledDateTime && <Text className="text-gray-800 text-base mb-2"><strong>Cancelled appointment:</strong> {cancelledDateTime}</Text>}
      {paymentImpact && <Text className="text-gray-800 text-base mb-4"><strong>Payment:</strong> {paymentImpact}</Text>}
      {contactPhone && <Text className="text-gray-800 text-base mb-4">Salon contact: {contactPhone}</Text>}
      {managementUrl && <Text className="text-gray-800 text-base mb-4"><a href={managementUrl}>View booking details</a></Text>}
      <Text className="text-gray-800 text-base">If this was a mistake or you would like to book another time, please feel free to reach out to us or book online.</Text>
    </BaseEmailLayout>
  );
};

export default BookingCancelledEmail;
