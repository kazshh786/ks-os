import { Heading, Section, Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';
import { FormActionCard } from '../components/FormEmailComponents.js';

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
  emailHeading?: string;
  emailBody?: string;
  outstandingForms?: OutstandingFormEmailItem[];
}

export const BookingConfirmedEmail = ({
  tenantName,
  tenantPrimaryColor,
  customerName,
  bookingTime,
  bookingDate,
  serviceName,
  clientName,
  startTime,
  timezone = 'Europe/London',
  emailHeading,
  emailBody,
  outstandingForms,
  ...branding
}: BookingConfirmedProps) => {
  const instant = startTime ? new Date(startTime) : null;
  const localDate = instant ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: timezone }).format(instant) : bookingDate;
  const localTime = instant ? new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: timezone }).format(instant) : bookingTime;
  const safeOutstandingForms = (outstandingForms || []).filter(form => Boolean(form.formName && form.formLink));
  const brandColor = tenantPrimaryColor || '#111827';

  return (
    <BaseEmailLayout
      tenantName={tenantName}
      tenantPrimaryColor={brandColor}
      {...branding}
      previewText="Your booking has been confirmed"
    >
      {emailHeading ? <Text className="text-gray-950 text-xl font-bold mb-4">{emailHeading}</Text> : null}
      <Text className="text-gray-800 text-base mb-4" style={{ whiteSpace: 'pre-line' }}>
        {emailBody || <>Hi {clientName || customerName}, your booking for <strong>{serviceName}</strong> has been confirmed.</>}
      </Text>
      <Section className="bg-gray-50 rounded p-4 mb-4">
        <Text className="text-gray-800 text-base m-0"><strong>Date:</strong> {localDate}</Text>
        <Text className="text-gray-800 text-base m-0 mt-2"><strong>Time:</strong> {localTime}</Text>
      </Section>
      {safeOutstandingForms.length ? (
        <Section style={{ borderTop: '1px solid #e5e7eb', marginTop: '24px', paddingTop: '20px' }}>
          <Heading as="h2" style={{ color: '#111827', fontSize: '20px', lineHeight: '27px', margin: '0 0 8px' }}>
            Before your appointment
          </Heading>
          <Text style={{ color: '#374151', fontSize: '15px', lineHeight: '23px', margin: 0 }}>
            {safeOutstandingForms.length === 1 ? '1 form needs completing.' : safeOutstandingForms.length + ' forms need completing.'}
          </Text>
          {safeOutstandingForms.map(form => (
            <FormActionCard
              key={form.formLink}
              formName={form.formName}
              formLink={form.formLink}
              estimatedMinutes={form.estimatedMinutes}
              actionLabel="Complete intake form"
              brandColor={brandColor}
            />
          ))}
        </Section>
      ) : null}
      <Text className="text-gray-800 text-base">We look forward to seeing you!</Text>
    </BaseEmailLayout>
  );
};

export default BookingConfirmedEmail;
