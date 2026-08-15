import { Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';
import {
  AppointmentSummaryCard,
  StatusHero,
} from '../components/FormEmailComponents.js';
import { getEmailDesign } from '../components/email-design.js';

export interface BusinessBookingConfirmedProps extends EmailBrandingProps {
  recipientName?: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  serviceName: string;
  staffName?: string | null;
  bookingDate: string;
  bookingTime: string;
  bookingReference?: string;
  locationName?: string;
  emailHeading?: string;
  emailBody?: string;
  emailPreview?: string;
}

export function BusinessBookingConfirmedEmail(props: BusinessBookingConfirmedProps) {
  const design = getEmailDesign(props.emailDesignStyle, { ...props.emailTheme, primaryColor: props.emailTheme?.primaryColor || props.tenantPrimaryColor });
  return (
    <BaseEmailLayout {...props} previewText={props.emailPreview || props.bookingDate + ' at ' + props.bookingTime + ' · ' + props.serviceName}>
      <StatusHero eyebrow="NEW BOOKING" heading={props.emailHeading || 'A new booking is confirmed'} description="The appointment has been added to the booking schedule." design={design} />
      {props.recipientName ? <Text style={{ color: design.tokens.body, fontSize: '16px', lineHeight: '25px', margin: '20px 0 8px' }}>Hi {props.recipientName},</Text> : null}
      {props.emailBody ? <Text style={{ color: design.tokens.body, fontSize: '16px', lineHeight: '25px', margin: '8px 0', whiteSpace: 'pre-line' }}>{props.emailBody}</Text> : null}
      <AppointmentSummaryCard serviceName={props.serviceName} date={props.bookingDate} time={props.bookingTime} staffName={props.staffName || undefined} locationName={props.locationName} bookingReference={props.bookingReference} design={design} />
      <Text style={{ color: design.tokens.heading, fontSize: '14px', fontWeight: 800, lineHeight: '21px', margin: '18px 0 6px' }}>Customer</Text>
      <Text style={{ color: design.tokens.body, fontSize: '14px', lineHeight: '22px', margin: 0 }}>{props.customerName}{props.customerEmail ? <><br />{props.customerEmail}</> : null}{props.customerPhone ? <><br />{props.customerPhone}</> : null}</Text>
    </BaseEmailLayout>
  );
}

export default BusinessBookingConfirmedEmail;
