import { Section, Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';
import {
  AppointmentSummaryCard,
  ChangeComparisonCard,
  PrimaryEmailButton,
  StatusHero,
} from '../components/FormEmailComponents.js';
import { getEmailDesign } from '../components/email-design.js';

export interface BookingRescheduledProps extends EmailBrandingProps {
  customerName: string;
  bookingReference?: string;
  oldDateTime?: string;
  newDateTime?: string;
  newBookingTime?: string;
  newBookingDate?: string;
  serviceName: string;
  staffName?: string;
  location?: string;
  managementUrl?: string;
  emailPreview?: string;
}

export const BookingRescheduledEmail = (props: BookingRescheduledProps) => {
  const design = getEmailDesign(props.emailDesignStyle, { ...props.emailTheme, primaryColor: props.emailTheme?.primaryColor || props.tenantPrimaryColor });
  const next = props.newDateTime || [props.newBookingDate, props.newBookingTime].filter(Boolean).join(' ');
  return (
    <BaseEmailLayout {...props} previewText={props.emailPreview || 'Your new appointment time is ' + next}>
      <StatusHero eyebrow="BOOKING UPDATED" heading="Your appointment has moved" description="The new appointment details are confirmed below." design={design} />
      <Text style={{ color: design.tokens.body, fontSize: '16px', lineHeight: '25px', margin: '20px 0 0' }}>Hi {props.customerName}, your booking for <strong>{props.serviceName}</strong> has been rescheduled.</Text>
      <ChangeComparisonCard previous={props.oldDateTime} next={next} design={design} />
      <AppointmentSummaryCard serviceName={props.serviceName} date={props.newBookingDate} time={props.newBookingTime} staffName={props.staffName} locationName={props.location} bookingReference={props.bookingReference} title="New appointment" design={design} />
      {props.managementUrl ? <Section style={{ margin: '22px 0', textAlign: 'center' }}><PrimaryEmailButton href={props.managementUrl} label="Manage booking" design={design} /></Section> : null}
    </BaseEmailLayout>
  );
};

export default BookingRescheduledEmail;
