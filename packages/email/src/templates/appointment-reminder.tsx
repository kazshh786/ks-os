import { Section, Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';
import {
  AppointmentSummaryCard,
  BusinessContactCard,
  FormActionCard,
  PrimaryEmailButton,
  SocialFollowCard,
  StatusHero,
} from '../components/FormEmailComponents.js';
import { getEmailDesign } from '../components/email-design.js';
import type { OutstandingFormEmailItem } from './booking-confirmed.js';

export interface AppointmentReminderProps extends EmailBrandingProps {
  customerName: string;
  bookingTime: string;
  bookingDate: string;
  serviceName: string;
  staffName?: string;
  locationName?: string;
  bookingReference?: string;
  managementUrl?: string;
  reminderHours?: number;
  emailHeading?: string;
  emailBody?: string;
  emailPreview?: string;
  outstandingForms?: OutstandingFormEmailItem[];
}

export const AppointmentReminderEmail = (props: AppointmentReminderProps) => {
  const design = getEmailDesign(props.emailDesignStyle, { ...props.emailTheme, primaryColor: props.emailTheme?.primaryColor || props.tenantPrimaryColor });
  const forms = (props.outstandingForms || []).filter(form => Boolean(form.formName && form.formLink));
  const tomorrow = props.reminderHours === 24;
  const businessName = props.businessName || props.tenantName;
  return (
    <BaseEmailLayout {...props} previewText={props.emailPreview || props.bookingDate + ' at ' + props.bookingTime + ' · ' + props.serviceName}>
      <StatusHero
        eyebrow={tomorrow ? 'APPOINTMENT TOMORROW' : 'APPOINTMENT REMINDER'}
        heading={props.emailHeading || (tomorrow ? 'See you tomorrow' : 'Your appointment is coming up')}
        description="Here are the details you need before you arrive."
        design={design}
      />
      <Text style={{ color: design.tokens.body, fontSize: '16px', lineHeight: '25px', margin: '20px 0 0', whiteSpace: 'pre-line' }}>
        {props.emailBody || <>Hi {props.customerName}, this is a reminder for your <strong>{props.serviceName}</strong> appointment.</>}
      </Text>
      <AppointmentSummaryCard
        serviceName={props.serviceName}
        date={props.bookingDate}
        time={props.bookingTime}
        staffName={props.staffName}
        locationName={props.locationName}
        bookingReference={props.bookingReference}
        design={design}
      />
      {props.managementUrl ? <Section style={{ margin: '22px 0', textAlign: 'center' }}><PrimaryEmailButton href={props.managementUrl} label="Manage booking" design={design} /></Section> : null}
      {forms.map(form => <FormActionCard key={form.formLink} formName={form.formName} formLink={form.formLink} estimatedMinutes={form.estimatedMinutes} actionLabel="Complete intake form" design={design} />)}
      <BusinessContactCard businessName={businessName} businessEmail={props.businessEmail} businessPhone={props.businessPhone} businessWebsiteUrl={props.businessWebsiteUrl} design={design} />
      <SocialFollowCard businessName={businessName} instagramUrl={props.instagramUrl} facebookUrl={props.facebookUrl} tiktokUrl={props.tiktokUrl} design={design} />
    </BaseEmailLayout>
  );
};

export default AppointmentReminderEmail;
