import { Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';

export interface BookingCancelledProps extends EmailBrandingProps {
  customerName: string;
  clientName?: string;
  serviceName: string;
  bookingReference?: string;
  cancelledDateTime?: string;
  paymentImpact?: string;
  contactPhone?: string;
  managementUrl?: string;
  emailHeading?: string;
  emailBody?: string;
}

export const BookingCancelledEmail = ({
  tenantName,
  tenantPrimaryColor,
  customerName,
  clientName,
  serviceName,
  bookingReference,
  cancelledDateTime,
  paymentImpact,
  contactPhone,
  managementUrl,
  emailHeading,
  emailBody,
  ...branding
}: BookingCancelledProps) => (
  <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} {...branding} previewText="Your booking has been cancelled">
    {emailHeading && <Text className="text-gray-950 text-xl font-bold mb-4">{emailHeading}</Text>}
    <Text className="text-gray-800 text-base mb-4" style={{ whiteSpace: 'pre-line' }}>{emailBody || <>Hi {clientName || customerName}, your booking for <strong>{serviceName}</strong> has been cancelled.</>}</Text>
    {bookingReference && <Text className="text-gray-800 text-base mb-2"><strong>Booking:</strong> {bookingReference}</Text>}
    {cancelledDateTime && <Text className="text-gray-800 text-base mb-2"><strong>Cancelled appointment:</strong> {cancelledDateTime}</Text>}
    {paymentImpact && <Text className="text-gray-800 text-base mb-4"><strong>Payment:</strong> {paymentImpact}</Text>}
    {contactPhone && <Text className="text-gray-800 text-base mb-4">Business contact: {contactPhone}</Text>}
    {managementUrl && <Text className="text-gray-800 text-base mb-4"><a href={managementUrl}>View booking details</a></Text>}
  </BaseEmailLayout>
);

export default BookingCancelledEmail;
