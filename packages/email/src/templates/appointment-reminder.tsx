import { Text, Section } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export interface AppointmentReminderProps {
  tenantName: string;
  tenantPrimaryColor?: string;
  customerName: string;
  bookingTime: string;
  bookingDate: string;
  serviceName: string;
}

export const AppointmentReminderEmail = ({
  tenantName,
  tenantPrimaryColor,
  customerName,
  bookingTime,
  bookingDate,
  serviceName
}: AppointmentReminderProps) => {
  return (
    <BaseEmailLayout 
      tenantName={tenantName} 
      tenantPrimaryColor={tenantPrimaryColor}
      previewText="Reminder: Upcoming appointment"
    >
      <Text className="text-gray-800 text-base mb-4">Hi {customerName},</Text>
      <Text className="text-gray-800 text-base mb-4">This is a reminder for your upcoming appointment for <strong>{serviceName}</strong>.</Text>
      <Section className="bg-gray-50 rounded p-4 mb-4">
        <Text className="text-gray-800 text-base m-0"><strong>Date:</strong> {bookingDate}</Text>
        <Text className="text-gray-800 text-base m-0 mt-2"><strong>Time:</strong> {bookingTime}</Text>
      </Section>
      <Text className="text-gray-800 text-base">We look forward to seeing you soon!</Text>
    </BaseEmailLayout>
  );
};

export default AppointmentReminderEmail;
