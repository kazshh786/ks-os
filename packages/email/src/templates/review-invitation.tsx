import { Link, Section, Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';

export interface ReviewInvitationEmailProps extends EmailBrandingProps {
  customerName: string;
  message: string;
  appointmentDate: string;
  reviewUrl: string;
  reviewProvider?: 'GOOGLE' | 'TRUSTPILOT';
  emailHeading?: string;
  emailBody?: string;
}

export function ReviewInvitationEmail(props: ReviewInvitationEmailProps) {
  return (
    <BaseEmailLayout {...props} tenantName={props.tenantName} tenantPrimaryColor={props.tenantPrimaryColor} previewText={'Thank you for your visit'}>
      {props.emailHeading && <Text className="text-gray-950 text-xl font-bold">{props.emailHeading}</Text>}
      <Text className="text-gray-800 text-base" style={{ whiteSpace: 'pre-line' }}>{props.emailBody || <>Hi {props.customerName}, {props.message}</>}</Text>
      <Text className="text-gray-600 text-sm">Visit date: {props.appointmentDate}</Text>
      <Section className="my-6 text-center">
        <Link href={props.reviewUrl} className="rounded bg-slate-900 px-5 py-3 text-white no-underline">
          {props.reviewProvider === 'GOOGLE' ? 'Rate us on Google' : props.reviewProvider === 'TRUSTPILOT' ? 'Review us on Trustpilot' : 'Share your feedback'}
        </Link>
      </Section>
      <Text className="text-gray-600 text-sm">There is no obligation to leave a review. This link expires automatically.</Text>
    </BaseEmailLayout>
  );
}

export default ReviewInvitationEmail;

