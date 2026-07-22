import { Link, Section, Text } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export interface ReviewInvitationEmailProps {
  tenantName: string;
  tenantPrimaryColor?: string;
  customerName: string;
  message: string;
  appointmentDate: string;
  reviewUrl: string;
}

export function ReviewInvitationEmail(props: ReviewInvitationEmailProps) {
  return (
    <BaseEmailLayout tenantName={props.tenantName} tenantPrimaryColor={props.tenantPrimaryColor} previewText={'An invitation to share honest feedback'}>
      <Text className="text-gray-800 text-base">Hi {props.customerName},</Text>
      <Text className="text-gray-800 text-base">{props.message}</Text>
      <Text className="text-gray-600 text-sm">Visit date: {props.appointmentDate}</Text>
      <Section className="my-6 text-center">
        <Link href={props.reviewUrl} className="rounded bg-slate-900 px-5 py-3 text-white no-underline">Choose a review provider</Link>
      </Section>
      <Text className="text-gray-600 text-sm">There is no obligation to leave a review. This link expires automatically.</Text>
    </BaseEmailLayout>
  );
}

export default ReviewInvitationEmail;

