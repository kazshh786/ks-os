import { Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';
import {
  PaymentReceiptCard,
  StatusHero,
} from '../components/FormEmailComponents.js';
import { getEmailDesign } from '../components/email-design.js';

export interface RefundUpdatedProps extends EmailBrandingProps {
  clientName?: string;
  customerName?: string;
  status: string;
  amount?: string;
  currency?: string;
  serviceName?: string;
  bookingReference?: string;
  refundReference?: string;
  emailPreview?: string;
}

export const RefundUpdatedEmail = (props: RefundUpdatedProps) => {
  const design = getEmailDesign(props.emailDesignStyle, { ...props.emailTheme, primaryColor: props.emailTheme?.primaryColor || props.tenantPrimaryColor });
  const customerName = props.clientName || props.customerName || 'there';
  return (
    <BaseEmailLayout {...props} previewText={props.emailPreview || 'Refund status: ' + props.status}>
      <StatusHero eyebrow="REFUND UPDATE" heading={'Refund ' + props.status.toLowerCase()} description="Here is the latest status of your refund." design={design} />
      <Text style={{ color: design.tokens.body, fontSize: '16px', lineHeight: '25px', margin: '20px 0 0' }}>Hi {customerName}, your refund status is now <strong>{props.status}</strong>.</Text>
      <PaymentReceiptCard amount={props.amount || 'Refund'} currency={props.amount ? props.currency || 'GBP' : ''} status={props.status} serviceName={props.serviceName} bookingReference={props.bookingReference} paymentReference={props.refundReference} title="Refund receipt" design={design} />
      <Text style={{ color: design.tokens.mutedText, fontSize: '13px', lineHeight: '20px', margin: '16px 0 0' }}>Your bank or payment provider controls when an approved refund appears in your account.</Text>
    </BaseEmailLayout>
  );
};

export default RefundUpdatedEmail;
