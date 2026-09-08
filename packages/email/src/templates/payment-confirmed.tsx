import { Section, Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';
import {
  AppointmentSummaryCard,
  BusinessContactCard,
  PaymentReceiptCard,
  PrimaryEmailButton,
  SocialFollowCard,
  StatusHero,
} from '../components/FormEmailComponents.js';
import { getEmailDesign } from '../components/email-design.js';

export interface PaymentConfirmedProps extends EmailBrandingProps {
  clientName?: string;
  customerName?: string;
  amount: string;
  bookingConfirmed?: boolean;
  balanceDue?: string;
  currency?: string;
  status?: string;
  serviceName?: string;
  appointmentDateTime?: string;
  timezone?: string;
  staffName?: string;
  locationName?: string;
  bookingReference?: string;
  paymentReference?: string;
  managementUrl?: string;
  emailPreview?: string;
}

export const PaymentConfirmedEmail = (props: PaymentConfirmedProps) => {
  const design = getEmailDesign(props.emailDesignStyle, { ...props.emailTheme, primaryColor: props.emailTheme?.primaryColor || props.tenantPrimaryColor });
  const customerName = props.clientName || props.customerName || 'there';
  const businessName = props.businessName || props.tenantName || 'the business';
  const instant = props.appointmentDateTime ? new Date(props.appointmentDateTime) : null;
  const validInstant = instant && Number.isFinite(instant.getTime()) ? instant : null;
  const timezone = props.timezone || 'Europe/London';
  const appointmentDate = validInstant
    ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: timezone }).format(validInstant)
    : undefined;
  const appointmentTime = validInstant
    ? new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: timezone }).format(validInstant)
    : undefined;

  return (
    <BaseEmailLayout {...props} previewText={props.emailPreview || (props.bookingConfirmed ? 'Payment received and booking confirmed · ' : 'Payment received · ') + (props.serviceName || businessName)}>
      <StatusHero
        eyebrow={props.bookingConfirmed ? "PAYMENT & BOOKING CONFIRMED" : "PAYMENT CONFIRMED"}
        heading={(props.bookingConfirmed ? "You're booked, " : "Payment received, ") + customerName}
        description={props.amount + ' ' + (props.currency || 'GBP') + ' has been received securely.' + (props.bookingConfirmed ? ' Your appointment is confirmed.' : '')}
        design={design}
      />
      <Text style={{ color: design.tokens.body, fontSize: '16px', lineHeight: '25px', margin: '20px 0 0' }}>
        Hi {customerName}, your payment to {businessName} has been received.{props.bookingConfirmed ? " Your booking is confirmed. Keep this email for your appointment and payment records." : " Keep this email as your payment receipt."}
      </Text>
      <AppointmentSummaryCard
        title={props.serviceName || 'Your booking'}
        serviceName={props.serviceName}
        date={appointmentDate}
        time={appointmentTime}
        staffName={props.staffName}
        locationName={props.locationName}
        bookingReference={props.bookingReference}
        design={design}
      />
      <PaymentReceiptCard
        amount={props.amount}
        currency={props.currency || 'GBP'}
        status={props.status || 'Paid'}
        serviceName={props.serviceName}
        bookingReference={props.bookingReference}
        paymentReference={props.paymentReference}
        design={design}
      />
      {props.bookingConfirmed && props.balanceDue && Number(props.balanceDue) > 0 ? (
        <Text style={{ color: design.tokens.body }}>Remaining balance: {props.balanceDue} {props.currency || 'GBP'}. Your booking is confirmed; this is the amount still to pay.</Text>
      ) : null}
      {props.managementUrl ? (
        <Section style={{ margin: '22px 0', textAlign: 'center' }}>
          <PrimaryEmailButton href={props.managementUrl} label="Manage booking" design={design} />
        </Section>
      ) : null}
      <BusinessContactCard businessName={businessName} businessEmail={props.businessEmail} businessPhone={props.businessPhone} businessWebsiteUrl={props.businessWebsiteUrl} design={design} />
      <SocialFollowCard businessName={businessName} instagramUrl={props.instagramUrl} facebookUrl={props.facebookUrl} tiktokUrl={props.tiktokUrl} design={design} />
    </BaseEmailLayout>
  );
};

export default PaymentConfirmedEmail;
