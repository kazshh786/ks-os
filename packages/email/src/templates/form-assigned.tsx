import { Text, Button, Section } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export interface FormAssignedProps {
  tenantName: string;
  tenantPrimaryColor?: string;
  customerName: string;
  formName: string;
  formLink: string;
}

export const FormAssignedEmail = ({
  tenantName,
  tenantPrimaryColor,
  customerName,
  formName,
  formLink
}: FormAssignedProps) => {
  return (
    <BaseEmailLayout 
      tenantName={tenantName} 
      tenantPrimaryColor={tenantPrimaryColor}
      previewText="A form has been assigned to you"
    >
      <Text className="text-gray-800 text-base mb-4">Hi {customerName},</Text>
      <Text className="text-gray-800 text-base mb-4">Please complete the following form: <strong>{formName}</strong>.</Text>
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

export default FormAssignedEmail;
