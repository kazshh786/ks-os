import { Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';
import {
  BusinessContactCard,
  FormActionCard,
  SecurityNotice,
  SocialFollowCard,
  StatusHero,
} from '../components/FormEmailComponents.js';

export interface FormAssignedProps extends Partial<EmailBrandingProps> {
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
}

function appointmentParts(props: FormAssignedProps) {
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

export const FormAssignedEmail = (props: FormAssignedProps) => {
  const tenantName = props.tenantName || props.businessName || 'Your business';
  const businessName = props.businessName || tenantName;
  const brandColor = props.tenantPrimaryColor || '#111827';
  const appointment = appointmentParts(props);
  const appointmentContext = appointment.date || appointment.time || props.serviceName;
  const introduction = props.formDescription
    ? undefined
    : appointmentContext
      ? 'Before your upcoming appointment, ' + businessName + ' needs a few details from you.'
      : businessName + ' needs a few details from you.';
  const previewText = props.dueDate || appointment.date
    ? 'Complete ' + props.formName + ' securely before ' + (props.dueDate || appointment.date) + '.'
    : 'Complete ' + props.formName + ' securely for ' + businessName + '.';

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
      previewText={previewText}
    >
      <StatusHero
        eyebrow="ACTION REQUIRED"
        heading={'Complete your ' + props.formName}
        description={introduction}
        brandColor={brandColor}
      />
      <Text style={{ color: '#374151', fontSize: '16px', lineHeight: '25px', margin: '20px 0 0' }}>
        {props.customerName ? 'Hi ' + props.customerName + ',' : 'Hello,'}
      </Text>
      {props.formDescription ? (
        <Text style={{ color: '#374151', fontSize: '16px', lineHeight: '25px', margin: '10px 0 0' }}>
          {props.formDescription}
        </Text>
      ) : null}
      <FormActionCard
        formName={props.formName}
        formLink={props.formLink}
        estimatedMinutes={props.estimatedMinutes}
        dueDate={props.dueDate}
        serviceName={props.serviceName}
        appointmentDate={appointment.date}
        appointmentTime={appointment.time}
        actionLabel="Complete form"
        brandColor={brandColor}
      />
      <SecurityNotice businessName={businessName} />
      <BusinessContactCard
        businessName={businessName}
        businessEmail={props.businessEmail}
        businessPhone={props.businessPhone}
        businessWebsiteUrl={props.businessWebsiteUrl}
      />
      <SocialFollowCard
        businessName={businessName}
        instagramUrl={props.instagramUrl}
        facebookUrl={props.facebookUrl}
        tiktokUrl={props.tiktokUrl}
      />
    </BaseEmailLayout>
  );
};

export default FormAssignedEmail;
