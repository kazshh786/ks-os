import { Text, Button, Section } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export interface FormReminderProps {
  tenantName: string;
  tenantPrimaryColor?: string;
  customerName: string;
  formName: string;
  formLink: string;
}

export const FormReminderEmail = ({
  tenantName,
  tenantPrimaryColor,
  customerName,
  formName,
  formLink
}: FormReminderProps) => {
  return (
    <BaseEmailLayout 
      tenantName={tenantName} 
      tenantPrimaryColor={tenantPrimaryColor}
      previewText="Reminder: Please complete your form"
    >
      <Text className="text-gray-800 text-base mb-4">Hi {customerName},</Text>
      <Text className="text-gray-800 text-base mb-4">This is a reminder to please complete the following form: <strong>{formName}</strong>.</Text>
      <Section className="text-center mb-4 mt-6">
        <Button 
          href={formLink} 
          style={{ backgroundColor: tenantPrimaryColor || '#000000' }}
          className="px-6 py-3 text-white rounded font-medium"
        >
          Complete Form
        </Button>
      </Section>
      <Text className="text-gray-800 text-base">Thank you!</Text>
    </BaseEmailLayout>
  );
};

export default FormReminderEmail;
