import { Section, Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';
import {
  AppointmentSummaryCard,
  BusinessContactCard,
  FormActionCard,
  PrimaryEmailButton,
  SecondaryEmailAction,
  SocialFollowCard,
  StatusHero,
} from '../components/FormEmailComponents.js';
import { getEmailDesign } from '../components/email-design.js';

export interface OutstandingFormEmailItem {
  formName: string;
  formLink: string;
  estimatedMinutes?: number;
}

export interface BookingConfirmedProps extends EmailBrandingProps {
  customerName: string;
  bookingTime: string;
  bookingDate: string;
  serviceName: string;
  clientName?: string;
  startTime?: string;
  timezone?: string;
  staffName?: string;
  locationName?: string;
  bookingReference?: string;
  managementUrl?: string;
  calendarUrl?: string;
  directionsUrl?: string;
  emailHeading?: string;
  emailBody?: string;
  emailPreview?: string;
  outstandingForms?: OutstandingFormEmailItem[];
}

export const BookingConfirmedEmail = (props: BookingConfirmedProps) => {
  const instant = props.startTime ? new Date(props.startTime) : null;
  const validInstant = instant && Number.isFinite(instant.getTime()) ? instant : null;
  const localDate = validInstant ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: props.timezone || 'Europe/London' }).format(validInstant) : props.bookingDate;
  const localTime = validInstant ? new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: props.timezone || 'Europe/London' }).format(validInstant) : props.bookingTime;
  const safeOutstandingForms = (props.outstandingForms || []).filter(form => Boolean(form.formName && form.formLink));
  const design = getEmailDesign(props.emailDesignStyle, { ...props.emailTheme, primaryColor: props.emailTheme?.primaryColor || props.tenantPrimaryColor });
  const customerName = props.clientName || props.customerName;
  const businessName = props.businessName || props.tenantName;

  return (
    <BaseEmailLayout {...props} previewText={props.emailPreview || props.serviceName + ' · ' + localDate + ' at ' + localTime}>
      <StatusHero
        eyebrow="BOOKING CONFIRMED"
        heading={props.emailHeading || "You're booked, " + customerName}
        description="Everything is confirmed. Keep these details handy for your appointment."
        design={design}
      />
      <Text style={{ color: design.tokens.body, fontSize: '16px', lineHeight: '25px', margin: '20px 0 0', whiteSpace: 'pre-line' }}>
        {props.emailBody || <>Hi {customerName}, your <strong>{props.serviceName}</strong> appointment is confirmed.</>}
      </Text>
      <AppointmentSummaryCard
        title={props.serviceName}
        serviceName={props.serviceName}
        date={localDate}
        time={localTime}
        staffName={props.staffName}
        locationName={props.locationName}
        bookingReference={props.bookingReference}
        design={design}
      />
      {props.managementUrl ? (
        <Section style={{ margin: '22px 0', textAlign: 'center' }}>
          <PrimaryEmailButton href={props.managementUrl} label="Manage booking" design={design} />
        </Section>
      ) : null}
      {props.calendarUrl || props.directionsUrl ? (
        <Section style={{ margin: '10px 0 22px', textAlign: 'center' }}>
          {props.calendarUrl ? <SecondaryEmailAction href={props.calendarUrl} label="Add to calendar" design={design} /> : null}
          {props.calendarUrl && props.directionsUrl ? <Text style={{ color: design.tokens.mutedText, display: 'inline', margin: '0 10px' }}> · </Text> : null}
          {props.directionsUrl ? <SecondaryEmailAction href={props.directionsUrl} label="Directions" design={design} /> : null}
        </Section>
      ) : null}
      {safeOutstandingForms.length ? (
        <Section style={{ borderTop: '1px solid ' + design.tokens.border, marginTop: '24px', paddingTop: '20px' }}>
          <Text style={{ color: design.tokens.heading, fontSize: '20px', fontWeight: 800, lineHeight: '27px', margin: '0 0 8px' }}>Before your appointment</Text>
          <Text style={{ color: design.tokens.body, fontSize: '15px', lineHeight: '23px', margin: 0 }}>
            {safeOutstandingForms.length === 1 ? '1 form needs completing.' : safeOutstandingForms.length + ' forms need completing.'}
          </Text>
          {safeOutstandingForms.map(form => (
            <FormActionCard
              key={form.formLink}
              formName={form.formName}
              formLink={form.formLink}
              estimatedMinutes={form.estimatedMinutes}
              actionLabel="Complete intake form"
              design={design}
            />
          ))}
        </Section>
      ) : null}
      <BusinessContactCard businessName={businessName} businessEmail={props.businessEmail} businessPhone={props.businessPhone} businessWebsiteUrl={props.businessWebsiteUrl} design={design} />
      <SocialFollowCard businessName={businessName} instagramUrl={props.instagramUrl} facebookUrl={props.facebookUrl} tiktokUrl={props.tiktokUrl} design={design} />
    </BaseEmailLayout>
  );
};

export default BookingConfirmedEmail;
