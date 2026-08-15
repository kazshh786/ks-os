import { Section, Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';
import {
  BusinessContactCard,
  CancellationCard,
  PrimaryEmailButton,
  StatusHero,
} from '../components/FormEmailComponents.js';
import { getEmailDesign } from '../components/email-design.js';

export interface BookingCancelledProps extends EmailBrandingProps {
  customerName: string;
  serviceName: string;
  bookingReference?: string;
  cancelledDateTime?: string;
  paymentImpact?: string;
  contactPhone?: string;
  managementUrl?: string;
  rebookingUrl?: string;
  emailPreview?: string;
}

export const BookingCancelledEmail = (props: BookingCancelledProps) => {
  const design = getEmailDesign(props.emailDesignStyle, { ...props.emailTheme, primaryColor: props.emailTheme?.primaryColor || props.tenantPrimaryColor });
  const businessName = props.businessName || props.tenantName;
  return (
    <BaseEmailLayout {...props} previewText={props.emailPreview || props.serviceName + ' booking cancelled'}>
      <StatusHero eyebrow="BOOKING CANCELLED" heading="Your appointment has been cancelled" description="This appointment is no longer scheduled." design={design} />
      <Text style={{ color: design.tokens.body, fontSize: '16px', lineHeight: '25px', margin: '20px 0 0' }}>Hi {props.customerName}, your booking for <strong>{props.serviceName}</strong> has been cancelled.</Text>
      <CancellationCard serviceName={props.serviceName} appointment={props.cancelledDateTime} bookingReference={props.bookingReference} paymentImpact={props.paymentImpact} design={design} />
      {props.rebookingUrl ? <Section style={{ margin: '22px 0', textAlign: 'center' }}><PrimaryEmailButton href={props.rebookingUrl} label="Book another appointment" design={design} /></Section> : null}
      {!props.rebookingUrl && props.managementUrl ? <Section style={{ margin: '22px 0', textAlign: 'center' }}><PrimaryEmailButton href={props.managementUrl} label="View booking details" design={design} /></Section> : null}
      <BusinessContactCard businessName={businessName} businessEmail={props.businessEmail} businessPhone={props.contactPhone || props.businessPhone} businessWebsiteUrl={props.businessWebsiteUrl} design={design} />
    </BaseEmailLayout>
  );
};

export default BookingCancelledEmail;
