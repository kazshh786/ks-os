import { Section, Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';
import {
  PaymentReceiptCard,
  PrimaryEmailButton,
  StatusHero,
} from '../components/FormEmailComponents.js';
import { getEmailDesign } from '../components/email-design.js';

export interface PaymentConfirmedProps extends EmailBrandingProps {
  clientName?: string;
  customerName?: string;
  amount: string;
  currency?: string;
  status?: string;
  serviceName?: string;
  appointmentDateTime?: string;
  bookingReference?: string;
  paymentReference?: string;
  managementUrl?: string;
  emailPreview?: string;
}

export const PaymentConfirmedEmail = (props: PaymentConfirmedProps) => {
  const design = getEmailDesign(props.emailDesignStyle, { ...props.emailTheme, primaryColor: props.emailTheme?.primaryColor || props.tenantPrimaryColor });
  const customerName = props.clientName || props.customerName || 'there';
  return (
    <BaseEmailLayout {...props} previewText={props.emailPreview || props.amount + ' ' + (props.currency || 'GBP') + ' received'}>
      <StatusHero eyebrow="PAYMENT RECEIVED" heading={props.amount + ' ' + (props.currency || 'GBP')} description="Your payment has been received securely." design={design} />
      <Text style={{ color: design.tokens.body, fontSize: '16px', lineHeight: '25px', margin: '20px 0 0' }}>Hi {customerName}, here is your payment confirmation.</Text>
      <PaymentReceiptCard amount={props.amount} currency={props.currency || 'GBP'} status={props.status || 'Paid'} serviceName={props.serviceName} appointment={props.appointmentDateTime} bookingReference={props.bookingReference} paymentReference={props.paymentReference} design={design} />
      {props.managementUrl ? <Section style={{ margin: '22px 0', textAlign: 'center' }}><PrimaryEmailButton href={props.managementUrl} label="View booking" design={design} /></Section> : null}
    </BaseEmailLayout>
  );
};

export default PaymentConfirmedEmail;
