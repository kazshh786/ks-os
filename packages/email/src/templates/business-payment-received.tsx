import { Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';
import {
  PaymentReceiptCard,
  StatusHero,
} from '../components/FormEmailComponents.js';
import { getEmailDesign } from '../components/email-design.js';

export interface BusinessPaymentReceivedProps extends EmailBrandingProps {
  recipientName?: string;
  customerName: string;
  serviceName?: string | null;
  amount: string;
  currency: string;
  bookingReference?: string;
  paymentReference?: string;
  emailHeading?: string;
  emailBody?: string;
  emailPreview?: string;
}

export function BusinessPaymentReceivedEmail(props: BusinessPaymentReceivedProps) {
  const design = getEmailDesign(props.emailDesignStyle, { ...props.emailTheme, primaryColor: props.emailTheme?.primaryColor || props.tenantPrimaryColor });
  return (
    <BaseEmailLayout {...props} previewText={props.emailPreview || props.serviceName + ' · Payment recorded successfully'}>
      <StatusHero eyebrow="PAYMENT RECEIVED" heading={props.emailHeading || props.amount + ' ' + props.currency} description="A customer payment has been recorded successfully." design={design} />
      {props.recipientName ? <Text style={{ color: design.tokens.body, fontSize: '16px', lineHeight: '25px', margin: '20px 0 8px' }}>Hi {props.recipientName},</Text> : null}
      {props.emailBody ? <Text style={{ color: design.tokens.body, fontSize: '16px', lineHeight: '25px', margin: '8px 0', whiteSpace: 'pre-line' }}>{props.emailBody}</Text> : null}
      <PaymentReceiptCard amount={props.amount} currency={props.currency} status="Received" serviceName={props.serviceName || undefined} bookingReference={props.bookingReference} paymentReference={props.paymentReference} design={design} />
      <Text style={{ color: design.tokens.body, fontSize: '14px', lineHeight: '22px', margin: 0 }}><strong>Customer:</strong> {props.customerName}</Text>
    </BaseEmailLayout>
  );
}

export default BusinessPaymentReceivedEmail;
