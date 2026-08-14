import { Button, Heading, Img, Link, Section, Text } from '@react-email/components';
import { getReadableTextColor } from './email-colors.js';

export interface SocialBrandingProps {
  businessName?: string;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  tiktokUrl?: string | null;
}

export function BrandHeader({
  businessName,
  businessLogoUrl,
  brandColor,
}: {
  businessName: string;
  businessLogoUrl?: string | null;
  brandColor: string;
}) {
  const foregroundColor = getReadableTextColor(brandColor);
  return (
    <Section style={{ backgroundColor: brandColor, padding: '28px 24px', textAlign: 'center' }}>
      {businessLogoUrl ? (
        <Img
          src={businessLogoUrl}
          alt={businessName + ' logo'}
          width="160"
          style={{ display: 'block', margin: '0 auto 12px', maxHeight: '72px', maxWidth: '160px', objectFit: 'contain' }}
        />
      ) : null}
      <Heading as="h1" style={{ color: foregroundColor, fontSize: '22px', lineHeight: '28px', margin: 0 }}>
        {businessName}
      </Heading>
    </Section>
  );
}

export function StatusHero({
  eyebrow,
  heading,
  description,
  brandColor,
}: {
  eyebrow: string;
  heading: string;
  description?: string;
  brandColor: string;
}) {
  return (
    <Section style={{ borderTop: '4px solid ' + brandColor, padding: '8px 0 4px' }}>
      <Text style={{ color: '#4b5563', fontSize: '12px', fontWeight: 700, letterSpacing: '1.2px', lineHeight: '18px', margin: '0 0 8px' }}>
        {eyebrow}
      </Text>
      <Heading as="h2" style={{ color: '#111827', fontSize: '26px', lineHeight: '34px', margin: '0 0 12px' }}>
        {heading}
      </Heading>
      {description ? (
        <Text style={{ color: '#374151', fontSize: '16px', lineHeight: '25px', margin: 0 }}>{description}</Text>
      ) : null}
    </Section>
  );
}

export function PrimaryEmailButton({
  href,
  label,
  brandColor,
}: {
  href: string;
  label: string;
  brandColor: string;
}) {
  return (
    <Button
      href={href}
      style={{
        backgroundColor: brandColor,
        borderRadius: '8px',
        color: getReadableTextColor(brandColor),
        display: 'inline-block',
        fontSize: '16px',
        fontWeight: 700,
        lineHeight: '20px',
        padding: '14px 24px',
        textDecoration: 'none',
      }}
    >
      {label}
    </Button>
  );
}

function Detail({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <Text style={{ color: '#374151', fontSize: '14px', lineHeight: '21px', margin: '5px 0' }}>
      <strong>{label}:</strong> {value}
    </Text>
  );
}

export function FormActionCard({
  formName,
  formLink,
  formDescription,
  estimatedMinutes,
  dueDate,
  serviceName,
  appointmentDate,
  appointmentTime,
  actionLabel = 'Complete form',
  brandColor,
}: {
  formName: string;
  formLink: string;
  formDescription?: string;
  estimatedMinutes?: number;
  dueDate?: string;
  serviceName?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  actionLabel?: string;
  brandColor: string;
}) {
  return (
    <Section style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', margin: '22px 0', padding: '20px' }}>
      <Heading as="h3" style={{ color: '#111827', fontSize: '20px', lineHeight: '27px', margin: '0 0 8px' }}>
        {formName}
      </Heading>
      {formDescription ? (
        <Text style={{ color: '#4b5563', fontSize: '14px', lineHeight: '22px', margin: '0 0 12px' }}>{formDescription}</Text>
      ) : null}
      <Detail label="Estimated time" value={estimatedMinutes ? 'Approx. ' + estimatedMinutes + ' minutes' : undefined} />
      <Detail label="Due" value={dueDate} />
      <Detail label="Related to" value={serviceName} />
      <Detail label="Appointment" value={appointmentDate && appointmentTime ? appointmentDate + ' at ' + appointmentTime : appointmentDate || appointmentTime} />
      <Section style={{ marginTop: '18px', textAlign: 'center' }}>
        <PrimaryEmailButton href={formLink} label={actionLabel} brandColor={brandColor} />
      </Section>
    </Section>
  );
}

export function AppointmentSummaryCard({
  date,
  time,
  serviceName,
  staffName,
  locationName,
}: {
  date?: string;
  time?: string;
  serviceName?: string;
  staffName?: string;
  locationName?: string;
}) {
  if (!date && !time && !serviceName && !staffName && !locationName) return null;
  return (
    <Section style={{ backgroundColor: '#ffffff', border: '1px solid #d1d5db', borderRadius: '10px', margin: '18px 0', padding: '18px' }}>
      <Text style={{ color: '#111827', fontSize: '14px', fontWeight: 700, lineHeight: '20px', margin: '0 0 8px' }}>Appointment</Text>
      <Detail label="Date" value={date} />
      <Detail label="Time" value={time} />
      <Detail label="Service" value={serviceName} />
      <Detail label="With" value={staffName} />
      <Detail label="Location" value={locationName} />
    </Section>
  );
}

export function SecurityNotice({ businessName }: { businessName: string }) {
  return (
    <Section style={{ backgroundColor: '#f3f4f6', borderRadius: '8px', margin: '18px 0', padding: '14px 16px' }}>
      <Text style={{ color: '#374151', fontSize: '13px', lineHeight: '20px', margin: 0 }}>
        <strong>Submitted securely.</strong> Your information is sent securely to {businessName}.
      </Text>
    </Section>
  );
}

export function BusinessContactCard({
  businessName,
  businessEmail,
  businessPhone,
  businessWebsiteUrl,
}: {
  businessName: string;
  businessEmail?: string | null;
  businessPhone?: string | null;
  businessWebsiteUrl?: string | null;
}) {
  if (!businessEmail && !businessPhone && !businessWebsiteUrl) return null;
  return (
    <Section style={{ borderTop: '1px solid #e5e7eb', marginTop: '20px', paddingTop: '18px' }}>
      <Text style={{ color: '#111827', fontSize: '14px', fontWeight: 700, lineHeight: '20px', margin: '0 0 6px' }}>Need help?</Text>
      <Text style={{ color: '#4b5563', fontSize: '13px', lineHeight: '21px', margin: 0 }}>
        Contact {businessName}
        {businessEmail ? <><br /><Link href={'mailto:' + businessEmail} style={{ color: '#374151' }}>{businessEmail}</Link></> : null}
        {businessPhone ? <><br /><Link href={'tel:' + businessPhone} style={{ color: '#374151' }}>{businessPhone}</Link></> : null}
        {businessWebsiteUrl ? <><br /><Link href={businessWebsiteUrl} style={{ color: '#374151' }}>Visit {businessName} online</Link></> : null}
      </Text>
    </Section>
  );
}

function configuredSocialLinks(props: SocialBrandingProps) {
  return [
    { label: 'Instagram', url: props.instagramUrl },
    { label: 'Facebook', url: props.facebookUrl },
    { label: 'TikTok', url: props.tiktokUrl },
  ].filter((item): item is { label: string; url: string } => Boolean(item.url));
}

export function SocialFollowCard(props: SocialBrandingProps) {
  const links = configuredSocialLinks(props);
  if (!links.length) return null;
  const heading = links.length === 1 && links[0]!.label === 'Instagram'
    ? 'Follow us on Instagram'
    : 'Follow ' + (props.businessName || 'us');
  return (
    <Section style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', marginTop: '22px', padding: '16px' }}>
      <Text style={{ color: '#111827', fontSize: '14px', fontWeight: 700, lineHeight: '20px', margin: '0 0 10px' }}>{heading}</Text>
      <Text style={{ fontSize: '13px', lineHeight: '22px', margin: 0 }}>
        {links.map((item, index) => (
          <span key={item.label}>
            {index ? <span> &nbsp;·&nbsp; </span> : null}
            <Link href={item.url} style={{ color: '#374151', fontWeight: 600 }}>{item.label}</Link>
          </span>
        ))}
      </Text>
    </Section>
  );
}

export function EmailFooter({
  tenantName,
  businessAddress,
}: {
  tenantName: string;
  businessAddress?: string | null;
}) {
  return (
    <Section style={{ padding: '0 24px 24px', textAlign: 'center' }}>
      {businessAddress ? (
        <Text style={{ color: '#6b7280', fontSize: '12px', lineHeight: '18px', margin: '0 0 8px' }}>{businessAddress}</Text>
      ) : null}
      <Text style={{ color: '#6b7280', fontSize: '12px', lineHeight: '18px', margin: 0 }}>
        Sent securely by KS OS on behalf of {tenantName}.
      </Text>
    </Section>
  );
}
