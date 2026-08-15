import { Button, Column, Heading, Img, Link, Row, Section, Text } from '@react-email/components';
import {
  getEmailDesign,
  type EmailDesign,
} from './email-design.js';

export interface SocialBrandingProps {
  businessName?: string;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  tiktokUrl?: string | null;
}

const fallbackDesign = (brandColor = '#0f172a') => getEmailDesign('CLEAN', { primaryColor: brandColor });
const resolveDesign = (design?: EmailDesign, brandColor?: string) => design || fallbackDesign(brandColor);

export function BrandLogoPanel({
  businessName,
  businessLogoUrl,
  design,
}: {
  businessName: string;
  businessLogoUrl?: string | null;
  design?: EmailDesign;
}) {
  const active = resolveDesign(design);
  return (
    <Section
      data-email-logo-panel="white"
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid ' + active.tokens.border,
        borderRadius: active.radius.panel + 'px',
        padding: '22px 24px',
        textAlign: active.style === 'EDITORIAL' || active.style === 'CONTRAST' ? 'left' : 'center',
      }}
    >
      {businessLogoUrl ? (
        <Img
          src={businessLogoUrl}
          alt={businessName + ' logo'}
          width="160"
          style={{ display: 'block', margin: active.heroAlignment === 'center' ? '0 auto' : '0', maxHeight: '68px', maxWidth: '160px', objectFit: 'contain' }}
        />
      ) : (
        <Text style={{ color: '#111827', fontFamily: active.typography.heading, fontSize: '21px', fontWeight: 800, lineHeight: '28px', margin: 0 }}>
          {businessName}
        </Text>
      )}
    </Section>
  );
}

/** @deprecated Use BrandLogoPanel. */
export const BrandHeader = BrandLogoPanel;

export function StatusHero({
  eyebrow,
  heading,
  description,
  brandColor,
  design,
}: {
  eyebrow: string;
  heading: string;
  description?: string;
  brandColor?: string;
  design?: EmailDesign;
}) {
  const active = resolveDesign(design, brandColor);
  const highContrast = active.style === 'CONTRAST';
  const studio = active.style === 'STUDIO';
  const backgroundColor = highContrast ? active.tokens.darkSurface : studio ? active.tokens.accentSurface : active.tokens.card;
  const headingColor = highContrast ? active.tokens.darkSurfaceText : active.tokens.heading;
  const bodyColor = highContrast ? active.tokens.darkSurfaceText : active.tokens.body;
  return (
    <Section style={{
      backgroundColor,
      borderTop: highContrast ? '6px solid ' + active.tokens.primaryAction : '4px solid ' + active.tokens.primaryAction,
      borderRadius: (highContrast || studio ? active.radius.panel : 0) + 'px',
      padding: highContrast || studio ? '24px' : '10px 0 4px',
      textAlign: active.heroAlignment,
    }}>
      <Text style={{ color: highContrast ? active.tokens.darkSurfaceText : active.tokens.mutedText, fontSize: '12px', fontWeight: 800, letterSpacing: '1.4px', lineHeight: '18px', margin: '0 0 8px' }}>
        {eyebrow}
      </Text>
      <Heading as="h1" style={{ color: headingColor, fontFamily: active.typography.heading, fontSize: active.typography.headingSize, fontWeight: active.typography.headingWeight, lineHeight: '1.18', margin: '0 0 12px' }}>
        {heading}
      </Heading>
      {description ? (
        <Text style={{ color: bodyColor, fontSize: '16px', lineHeight: '25px', margin: 0 }}>{description}</Text>
      ) : null}
    </Section>
  );
}

export function PrimaryEmailButton({
  href,
  label,
  brandColor,
  design,
}: {
  href: string;
  label: string;
  brandColor?: string;
  design?: EmailDesign;
}) {
  const active = resolveDesign(design, brandColor);
  return (
    <Button
      href={href}
      style={{
        backgroundColor: active.tokens.primaryAction,
        borderRadius: active.radius.button + 'px',
        color: active.tokens.primaryActionText,
        display: 'inline-block',
        fontSize: '16px',
        fontWeight: 800,
        lineHeight: '20px',
        padding: '15px 24px',
        textDecoration: 'none',
      }}
    >
      {label}
    </Button>
  );
}

export function SecondaryEmailAction({
  href,
  label,
  design,
}: {
  href: string;
  label: string;
  design?: EmailDesign;
}) {
  const active = resolveDesign(design);
  return <Link href={href} style={{ color: active.tokens.heading, fontSize: '14px', fontWeight: 700, lineHeight: '22px' }}>{label}</Link>;
}

function Detail({ label, value, design }: { label: string; value?: string | number | null; design?: EmailDesign }) {
  if (value === undefined || value === null || value === '') return null;
  const active = resolveDesign(design);
  return (
    <Text style={{ color: active.tokens.body, fontSize: '14px', lineHeight: '21px', margin: '6px 0' }}>
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
  design,
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
  brandColor?: string;
  design?: EmailDesign;
}) {
  const active = resolveDesign(design, brandColor);
  return (
    <Section style={{ backgroundColor: active.tokens.mutedSurface, border: '1px solid ' + active.tokens.border, borderRadius: active.radius.panel + 'px', margin: '22px 0', padding: '20px' }}>
      <Heading as="h2" style={{ color: active.tokens.heading, fontFamily: active.typography.heading, fontSize: '21px', lineHeight: '28px', margin: '0 0 8px' }}>
        {formName}
      </Heading>
      {formDescription ? (
        <Text style={{ color: active.tokens.body, fontSize: '14px', lineHeight: '22px', margin: '0 0 12px' }}>{formDescription}</Text>
      ) : null}
      <Detail label="Estimated time" value={estimatedMinutes ? 'Approx. ' + estimatedMinutes + ' minutes' : undefined} design={active} />
      <Detail label="Due" value={dueDate} design={active} />
      <Detail label="Related to" value={serviceName} design={active} />
      <Detail label="Appointment" value={appointmentDate && appointmentTime ? appointmentDate + ' at ' + appointmentTime : appointmentDate || appointmentTime} design={active} />
      <Section style={{ marginTop: '18px', textAlign: 'center' }}>
        <PrimaryEmailButton href={formLink} label={actionLabel} design={active} />
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
  bookingReference,
  title = 'Appointment',
  design,
}: {
  date?: string;
  time?: string;
  serviceName?: string;
  staffName?: string;
  locationName?: string;
  bookingReference?: string;
  title?: string;
  design?: EmailDesign;
}) {
  if (!date && !time && !serviceName && !staffName && !locationName && !bookingReference) return null;
  const active = resolveDesign(design);
  return (
    <Section style={{ backgroundColor: active.tokens.mutedSurface, border: '1px solid ' + active.tokens.border, borderRadius: active.radius.panel + 'px', margin: '20px 0', padding: '20px' }}>
      <Text style={{ color: active.tokens.heading, fontSize: '15px', fontWeight: 800, letterSpacing: '0.2px', lineHeight: '21px', margin: '0 0 10px' }}>{title}</Text>
      <Detail label="Service" value={serviceName} design={active} />
      <Detail label="Date" value={date} design={active} />
      <Detail label="Time" value={time} design={active} />
      <Detail label="With" value={staffName} design={active} />
      <Detail label="Location" value={locationName} design={active} />
      <Detail label="Booking reference" value={bookingReference} design={active} />
    </Section>
  );
}

export function BookingReferenceCard({ reference, design }: { reference?: string; design?: EmailDesign }) {
  if (!reference) return null;
  const active = resolveDesign(design);
  return (
    <Section style={{ backgroundColor: active.tokens.accentSurface, borderRadius: active.radius.panel + 'px', margin: '16px 0', padding: '13px 16px', textAlign: 'center' }}>
      <Text style={{ color: active.tokens.accentText, fontSize: '12px', letterSpacing: '1px', lineHeight: '18px', margin: 0 }}>BOOKING REFERENCE</Text>
      <Text style={{ color: active.tokens.accentText, fontSize: '18px', fontWeight: 800, lineHeight: '24px', margin: '3px 0 0' }}>{reference}</Text>
    </Section>
  );
}

export function ChangeComparisonCard({
  previous,
  next,
  design,
}: {
  previous?: string;
  next: string;
  design?: EmailDesign;
}) {
  const active = resolveDesign(design);
  return (
    <Section style={{ border: '1px solid ' + active.tokens.border, borderRadius: active.radius.panel + 'px', margin: '22px 0', overflow: 'hidden' }}>
      <Row>
        <Column style={{ backgroundColor: active.tokens.mutedSurface, padding: '18px', width: '44%' }}>
          <Text style={{ color: active.tokens.mutedText, fontSize: '11px', fontWeight: 800, letterSpacing: '1px', margin: '0 0 8px' }}>PREVIOUS</Text>
          <Text style={{ color: active.tokens.body, fontSize: '14px', lineHeight: '21px', margin: 0 }}>{previous || 'Previous time'}</Text>
        </Column>
        <Column style={{ backgroundColor: active.tokens.accentSurface, padding: '18px', width: '56%' }}>
          <Text style={{ color: active.tokens.accentText, fontSize: '11px', fontWeight: 800, letterSpacing: '1px', margin: '0 0 8px' }}>NEW</Text>
          <Text style={{ color: active.tokens.accentText, fontSize: '17px', fontWeight: 800, lineHeight: '24px', margin: 0 }}>{next}</Text>
        </Column>
      </Row>
    </Section>
  );
}

export function CancellationCard({
  serviceName,
  appointment,
  bookingReference,
  paymentImpact,
  design,
}: {
  serviceName?: string;
  appointment?: string;
  bookingReference?: string;
  paymentImpact?: string;
  design?: EmailDesign;
}) {
  const active = resolveDesign(design);
  return (
    <Section style={{ backgroundColor: active.tokens.mutedSurface, borderLeft: '5px solid ' + active.tokens.primaryAction, borderRadius: active.radius.panel + 'px', margin: '20px 0', padding: '18px' }}>
      <Detail label="Service" value={serviceName} design={active} />
      <Detail label="Cancelled appointment" value={appointment} design={active} />
      <Detail label="Booking reference" value={bookingReference} design={active} />
      <Detail label="Payment" value={paymentImpact} design={active} />
    </Section>
  );
}

export function PaymentReceiptCard({
  amount,
  currency,
  status,
  serviceName,
  appointment,
  bookingReference,
  paymentReference,
  title = 'Payment receipt',
  design,
}: {
  amount: string;
  currency?: string;
  status?: string;
  serviceName?: string;
  appointment?: string;
  bookingReference?: string;
  paymentReference?: string;
  title?: string;
  design?: EmailDesign;
}) {
  const active = resolveDesign(design);
  return (
    <Section style={{ backgroundColor: active.tokens.mutedSurface, border: '1px solid ' + active.tokens.border, borderRadius: active.radius.panel + 'px', margin: '22px 0', padding: '20px' }}>
      <Text style={{ color: active.tokens.mutedText, fontSize: '12px', fontWeight: 800, letterSpacing: '1px', margin: '0 0 6px' }}>{title.toUpperCase()}</Text>
      <Text style={{ color: active.tokens.heading, fontSize: '30px', fontWeight: 900, lineHeight: '36px', margin: '0 0 16px' }}>{amount} {currency || ''}</Text>
      <Detail label="Service" value={serviceName} design={active} />
      <Detail label="Appointment" value={appointment} design={active} />
      <Detail label="Status" value={status} design={active} />
      <Detail label="Booking reference" value={bookingReference} design={active} />
      <Detail label="Payment reference" value={paymentReference} design={active} />
    </Section>
  );
}

export function ReviewRequestCard({
  question,
  reviewUrl,
  actionLabel,
  design,
}: {
  question: string;
  reviewUrl: string;
  actionLabel: string;
  design?: EmailDesign;
}) {
  const active = resolveDesign(design);
  return (
    <Section style={{ backgroundColor: active.tokens.accentSurface, borderRadius: active.radius.panel + 'px', margin: '22px 0', padding: '22px', textAlign: 'center' }}>
      <Text aria-label="Five star rating" style={{ color: active.tokens.accentText, fontSize: '20px', letterSpacing: '5px', margin: '0 0 10px' }}>★ ★ ★ ★ ★</Text>
      <Heading as="h2" style={{ color: active.tokens.accentText, fontFamily: active.typography.heading, fontSize: '22px', lineHeight: '29px', margin: '0 0 18px' }}>{question}</Heading>
      <PrimaryEmailButton href={reviewUrl} label={actionLabel} design={active} />
    </Section>
  );
}

export function SecurityNotice({ businessName, design }: { businessName: string; design?: EmailDesign }) {
  const active = resolveDesign(design);
  return (
    <Section style={{ backgroundColor: active.tokens.mutedSurface, borderRadius: active.radius.panel + 'px', margin: '18px 0', padding: '14px 16px' }}>
      <Text style={{ color: active.tokens.body, fontSize: '13px', lineHeight: '20px', margin: 0 }}>
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
  design,
}: {
  businessName: string;
  businessEmail?: string | null;
  businessPhone?: string | null;
  businessWebsiteUrl?: string | null;
  design?: EmailDesign;
}) {
  if (!businessEmail && !businessPhone && !businessWebsiteUrl) return null;
  const active = resolveDesign(design);
  return (
    <Section style={{ borderTop: '1px solid ' + active.tokens.border, marginTop: '20px', paddingTop: '18px' }}>
      <Text style={{ color: active.tokens.heading, fontSize: '14px', fontWeight: 800, lineHeight: '20px', margin: '0 0 6px' }}>Need help?</Text>
      <Text style={{ color: active.tokens.body, fontSize: '13px', lineHeight: '21px', margin: 0 }}>
        Contact {businessName}
        {businessEmail ? <><br /><Link href={'mailto:' + businessEmail} style={{ color: active.tokens.body }}>{businessEmail}</Link></> : null}
        {businessPhone ? <><br /><Link href={'tel:' + businessPhone} style={{ color: active.tokens.body }}>{businessPhone}</Link></> : null}
        {businessWebsiteUrl ? <><br /><Link href={businessWebsiteUrl} style={{ color: active.tokens.body }}>Visit {businessName} online</Link></> : null}
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

export function SocialFollowCard(props: SocialBrandingProps & { design?: EmailDesign }) {
  const links = configuredSocialLinks(props);
  if (!links.length) return null;
  const active = resolveDesign(props.design);
  const heading = links.length === 1 && links[0]!.label === 'Instagram'
    ? 'Follow us on Instagram'
    : 'Follow ' + (props.businessName || 'us');
  return (
    <Section style={{ backgroundColor: active.tokens.accentSurface, border: '1px solid ' + active.tokens.border, borderRadius: active.radius.panel + 'px', marginTop: '22px', padding: '16px' }}>
      <Text style={{ color: active.tokens.accentText, fontSize: '14px', fontWeight: 800, lineHeight: '20px', margin: '0 0 10px' }}>{heading}</Text>
      <Text style={{ fontSize: '13px', lineHeight: '22px', margin: 0 }}>
        {links.map((item, index) => (
          <span key={item.label}>
            {index ? <span> &nbsp;·&nbsp; </span> : null}
            <Link href={item.url} style={{ color: active.tokens.accentText, fontWeight: 700 }}>{item.label}</Link>
          </span>
        ))}
      </Text>
    </Section>
  );
}

export function EmailFooter({
  tenantName,
  businessName = tenantName,
  businessAddress,
  businessEmail,
  businessPhone,
  businessWebsiteUrl,
  design,
}: {
  tenantName: string;
  businessName?: string;
  businessAddress?: string | null;
  businessEmail?: string | null;
  businessPhone?: string | null;
  businessWebsiteUrl?: string | null;
  design?: EmailDesign;
}) {
  const active = resolveDesign(design);
  const contact = [businessPhone, businessEmail].filter(Boolean).join(' · ');
  return (
    <Section style={{ borderTop: '1px solid ' + active.tokens.border, padding: '22px 24px 26px', textAlign: 'center' }}>
      <Text style={{ color: active.tokens.heading, fontSize: '13px', fontWeight: 800, lineHeight: '19px', margin: '0 0 6px' }}>{businessName}</Text>
      {businessAddress ? <Text style={{ color: active.tokens.mutedText, fontSize: '12px', lineHeight: '18px', margin: '0 0 5px' }}>{businessAddress}</Text> : null}
      {contact ? <Text style={{ color: active.tokens.mutedText, fontSize: '12px', lineHeight: '18px', margin: '0 0 5px' }}>{contact}</Text> : null}
      {businessWebsiteUrl ? <Text style={{ fontSize: '12px', lineHeight: '18px', margin: '0 0 8px' }}><Link href={businessWebsiteUrl} style={{ color: active.tokens.body }}>Visit our website</Link></Text> : null}
      <Text style={{ color: active.tokens.mutedText, fontSize: '11px', lineHeight: '17px', margin: 0 }}>
        Sent securely by KS OS on behalf of {tenantName}.
      </Text>
    </Section>
  );
}
