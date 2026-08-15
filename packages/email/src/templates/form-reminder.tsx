import { Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';
import {
  AppointmentSummaryCard,
  BusinessContactCard,
  FormActionCard,
  SecurityNotice,
  SocialFollowCard,
  StatusHero,
} from '../components/FormEmailComponents.js';
import { getEmailDesign } from '../components/email-design.js';

export interface FormReminderProps extends Partial<EmailBrandingProps> {
  customerName?: string;
  formName: string;
  formLink: string;
  formDescription?: string;
  estimatedMinutes?: number;
  appointmentDate?: string;
  appointmentTime?: string;
  appointmentDateTime?: string;
  timezone?: string;
  serviceName?: string;
  staffName?: string;
  locationName?: string;
  dueDate?: string;
  emailPreview?: string;
}

function appointmentParts(props: FormReminderProps) {
  if (!props.appointmentDateTime) return { date: props.appointmentDate, time: props.appointmentTime };
  const instant = new Date(props.appointmentDateTime);
  if (!Number.isFinite(instant.getTime())) return { date: props.appointmentDate, time: props.appointmentTime };
  try {
    return {
      date: props.appointmentDate || new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: props.timezone || 'Europe/London' }).format(instant),
      time: props.appointmentTime || new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: props.timezone || 'Europe/London' }).format(instant),
    };
  } catch {
    return { date: props.appointmentDate, time: props.appointmentTime };
  }
}

export const FormReminderEmail = (props: FormReminderProps) => {
  const tenantName = props.tenantName || props.businessName || 'Your business';
  const businessName = props.businessName || tenantName;
  const brandColor = props.tenantPrimaryColor || '#0f172a';
  const design = getEmailDesign(props.emailDesignStyle, { ...props.emailTheme, primaryColor: props.emailTheme?.primaryColor || brandColor });
  const appointment = appointmentParts(props);
  const hasAppointment = Boolean(appointment.date || appointment.time || props.serviceName);
  const heading = hasAppointment ? 'One form to complete before your appointment' : 'Reminder: please complete your form';
  const previewText = hasAppointment ? props.formName + ' is still outstanding before your appointment.' : 'Please complete ' + props.formName + ' securely.';

  return (
    <BaseEmailLayout
      tenantName={tenantName}
      tenantPrimaryColor={brandColor}
      businessName={businessName}
      businessEmail={props.businessEmail}
      businessPhone={props.businessPhone}
      businessAddress={props.businessAddress}
      businessWebsiteUrl={props.businessWebsiteUrl}
      businessLogoUrl={props.businessLogoUrl}
      instagramUrl={props.instagramUrl}
      facebookUrl={props.facebookUrl}
      tiktokUrl={props.tiktokUrl}
      emailDesignStyle={props.emailDesignStyle}
      emailTheme={props.emailTheme}
      previewText={props.emailPreview || previewText}
    >
      <StatusHero eyebrow="FORM STILL OUTSTANDING" heading={heading} description={hasAppointment ? 'There is one form left to complete before your appointment.' : undefined} design={design} />
      <Text style={{ color: design.tokens.body, fontSize: '16px', lineHeight: '25px', margin: '20px 0 0' }}>{props.customerName ? 'Hi ' + props.customerName + ',' : 'Hello,'}</Text>
      <FormActionCard formName={props.formName} formLink={props.formLink} formDescription={props.formDescription} estimatedMinutes={props.estimatedMinutes} dueDate={props.dueDate} actionLabel="Complete form" design={design} />
      <AppointmentSummaryCard date={appointment.date} time={appointment.time} serviceName={props.serviceName} staffName={props.staffName} locationName={props.locationName} design={design} />
      {hasAppointment ? <Text style={{ color: design.tokens.heading, fontSize: '15px', fontWeight: 800, lineHeight: '23px', margin: '16px 0' }}>Please complete this before arriving.</Text> : null}
      <SecurityNotice businessName={businessName} design={design} />
      <BusinessContactCard businessName={businessName} businessEmail={props.businessEmail} businessPhone={props.businessPhone} businessWebsiteUrl={props.businessWebsiteUrl} design={design} />
      <SocialFollowCard businessName={businessName} instagramUrl={props.instagramUrl} facebookUrl={props.facebookUrl} tiktokUrl={props.tiktokUrl} design={design} />
    </BaseEmailLayout>
  );
};

export default FormReminderEmail;
