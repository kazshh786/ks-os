import { Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';
import {
  ReviewRequestCard,
  StatusHero,
} from '../components/FormEmailComponents.js';
import { getEmailDesign } from '../components/email-design.js';

export interface ReviewInvitationEmailProps extends EmailBrandingProps {
  customerName: string;
  message: string;
  appointmentDate: string;
  reviewUrl: string;
  reviewProvider?: 'GOOGLE' | 'TRUSTPILOT';
  emailHeading?: string;
  emailBody?: string;
  emailPreview?: string;
}

export function ReviewInvitationEmail(props: ReviewInvitationEmailProps) {
  const design = getEmailDesign(props.emailDesignStyle, { ...props.emailTheme, primaryColor: props.emailTheme?.primaryColor || props.tenantPrimaryColor });
  const provider = props.reviewProvider === 'GOOGLE' ? 'Google' : props.reviewProvider === 'TRUSTPILOT' ? 'Trustpilot' : null;
  return (
    <BaseEmailLayout {...props} previewText={props.emailPreview || 'How was your visit on ' + props.appointmentDate + '?'}>
      <StatusHero eyebrow="THANK YOU FOR VISITING" heading={props.emailHeading || 'How was your experience?'} description="Your honest feedback helps our team keep improving." design={design} />
      <Text style={{ color: design.tokens.body, fontSize: '16px', lineHeight: '25px', margin: '20px 0 0', whiteSpace: 'pre-line' }}>{props.emailBody || <>Hi {props.customerName}, {props.message}</>}</Text>
      <Text style={{ color: design.tokens.mutedText, fontSize: '13px', lineHeight: '20px', margin: '12px 0 0' }}>Visit date: {props.appointmentDate}</Text>
      <ReviewRequestCard question="Would you recommend us?" reviewUrl={props.reviewUrl} actionLabel={provider ? 'Review us on ' + provider : 'Share your feedback'} design={design} />
      <Text style={{ color: design.tokens.mutedText, fontSize: '13px', lineHeight: '20px', margin: 0 }}>There is no obligation to leave a review. This secure link expires automatically.</Text>
    </BaseEmailLayout>
  );
}

export default ReviewInvitationEmail;
