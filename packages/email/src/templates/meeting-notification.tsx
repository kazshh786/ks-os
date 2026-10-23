import { Button, Heading, Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';
import { ensureReadableTextColor } from '../components/email-colors.js';

interface MeetingNotificationProps extends Partial<EmailBrandingProps> {
  kind?: 'invite' | 'rescheduled' | 'cancelled';
  meetingTitle?: string; hostName?: string; scheduleLabel?: string; expiresLabel?: string; invitationUrl?: string;
}
const safeLogo = (value?: string | null) => {
  try { const url = new URL(value || ''); return url.protocol === 'https:' && !url.username && !url.password && /\.(png|jpe?g)$/i.test(url.pathname) ? url.toString() : null; }
  catch { return null; }
};

export function MeetingNotificationEmail({
  kind = 'invite', tenantName = 'Your business', meetingTitle = 'Meeting', hostName = 'Your host',
  scheduleLabel, expiresLabel, invitationUrl, tenantPrimaryColor = '#0f172a', businessLogoUrl, ...branding
}: MeetingNotificationProps) {
  const heading = kind === 'cancelled' ? 'Meeting cancelled' : kind === 'rescheduled' ? 'Your meeting time has changed' : 'You are invited to a meeting';
  const color = /^#[0-9a-f]{6}$/i.test(tenantPrimaryColor) ? tenantPrimaryColor : '#0f172a';
  return <BaseEmailLayout {...branding} tenantName={tenantName} tenantPrimaryColor={color} businessLogoUrl={safeLogo(businessLogoUrl)} title={heading} previewText={heading}>
    <Heading as="h1" style={{ color: '#0f172a', fontSize: '24px', lineHeight: '32px', margin: '0 0 20px' }}>{heading}</Heading>
    <Text style={{ color: '#334155', fontSize: '16px', lineHeight: '24px' }}>{meetingTitle}</Text>
    <Text style={{ color: '#334155', fontSize: '16px', lineHeight: '24px' }}>Hosted by {hostName} at {tenantName}.</Text>
    {scheduleLabel && <Text style={{ color: '#334155', fontSize: '16px', lineHeight: '24px' }}>{scheduleLabel}</Text>}
    {kind === 'cancelled' ? <Text style={{ color: '#334155', fontSize: '16px', lineHeight: '24px' }}>This meeting will no longer take place. Its invitation can no longer be used to join.</Text> : <>
      <Text style={{ color: '#334155', fontSize: '16px', lineHeight: '24px' }}>Open the invitation, enter your name and request admission. Your host will admit you from the waiting room. You do not need a KS OS account.</Text>
      {invitationUrl && <Button href={invitationUrl} style={{ backgroundColor: color, color: ensureReadableTextColor(color, '#ffffff'), borderRadius: '6px', boxSizing: 'border-box', padding: '14px 20px', fontSize: '16px', lineHeight: '24px', textDecoration: 'none', fontWeight: 600 }}>Open meeting invitation</Button>}
      {expiresLabel && <Text style={{ color: '#334155', fontSize: '14px', lineHeight: '22px' }}>This invitation expires on {expiresLabel}.</Text>}
      <Text style={{ color: '#334155', fontSize: '14px', lineHeight: '22px' }}>Keep this invitation private. Anyone with the link can request admission using a name of their choice. The host controls access.</Text>
    </>}
    <Text style={{ color: '#334155', fontSize: '14px', lineHeight: '22px' }}>Meetings are provided through KS OS. Recording and transcription are not enabled.</Text>
  </BaseEmailLayout>;
}
