import { Text, Button, Section } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';

export interface FormAssignedProps extends EmailBrandingProps {
  customerName: string;
  formName: string;
  formLink: string;
  emailHeading?: string;
  emailBody?: string;
}

export const FormAssignedEmail = ({
  tenantName,
  tenantPrimaryColor,
  customerName,
  formName,
  formLink,
  emailHeading,
  emailBody,
  ...branding
}: FormAssignedProps) => (
  <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} {...branding} previewText="A form has been assigned to you">
    {emailHeading && <Text className="text-gray-950 text-xl font-bold mb-4">{emailHeading}</Text>}
    <Text className="text-gray-800 text-base mb-4" style={{ whiteSpace: 'pre-line' }}>{emailBody || <>Hi {customerName}, please complete <strong>{formName}</strong>.</>}</Text>
    <Section className="text-center mb-4 mt-6">
      <Button href={formLink} style={{ backgroundColor: tenantPrimaryColor || '#000000' }} className="px-6 py-3 text-white rounded font-medium">Complete form</Button>
    </Section>
  </BaseEmailLayout>
);

export default FormAssignedEmail;
