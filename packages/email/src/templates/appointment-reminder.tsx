import { Text, Section } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';

export interface AppointmentReminderProps extends EmailBrandingProps {
  customerName: string;
  bookingTime: string;
  bookingDate: string;
  serviceName: string;
  emailHeading?: string;
  emailBody?: string;
}

export const AppointmentReminderEmail = ({
  tenantName,
  tenantPrimaryColor,
  customerName,
  bookingTime,
  bookingDate,
  serviceName,
  emailHeading,
  emailBody,
  ...branding
}: AppointmentReminderProps) => {
  return (
    <BaseEmailLayout 
      tenantName={tenantName} 
      tenantPrimaryColor={tenantPrimaryColor}
      {...branding}
      previewText="Reminder: Upcoming appointment"
    >
      {emailHeading && <Text className="text-gray-950 text-xl font-bold mb-4">{emailHeading}</Text>}
      <Text className="text-gray-800 text-base mb-4" style={{ whiteSpace: 'pre-line' }}>{emailBody || <>Hi {customerName}, this is a reminder for your upcoming appointment for <strong>{serviceName}</strong>.</>}</Text>
      <Section className="bg-gray-50 rounded p-4 mb-4">
        <Text className="text-gray-800 text-base m-0"><strong>Date:</strong> {bookingDate}</Text>
        <Text className="text-gray-800 text-base m-0 mt-2"><strong>Time:</strong> {bookingTime}</Text>
      </Section>
      <Text className="text-gray-800 text-base">We look forward to seeing you soon!</Text>
    </BaseEmailLayout>
  );
};

export default AppointmentReminderEmail;
