import { Button, Heading, Text } from '@react-email/components';
import { BaseEmailLayout, type EmailBrandingProps } from '../components/BaseEmailLayout.js';

interface Props extends Partial<EmailBrandingProps> { invitationUrl?: string; channelName?: string; expiresLabel?: string }
export function CustomerCollaborationInvitationEmail({ invitationUrl, channelName = 'Customer messages', expiresLabel, tenantName = 'Your business', ...branding }: Props) {
  return <BaseEmailLayout {...branding} tenantName={tenantName} businessLogoUrl={null} title="Your customer collaboration invitation" previewText={`A secure invitation from ${tenantName}`}>
    <Heading as="h1" style={{color:'#0f172a',fontSize:'24px',lineHeight:'32px'}}>You are invited to collaborate</Heading>
    <Text style={{color:'#334155',fontSize:'16px',lineHeight:'24px'}}>{tenantName} has invited you to {channelName}.</Text>
    <Text style={{color:'#334155',fontSize:'16px',lineHeight:'24px'}}>Sign in with the email address that received this invitation to access your messages, shared files and explicitly invited meetings. You do not need access to the business staff workspace.</Text>
    {invitationUrl && <Button href={invitationUrl} style={{backgroundColor:'#0f172a',color:'#ffffff',padding:'14px 20px',boxSizing:'border-box',borderRadius:'6px',fontSize:'16px',lineHeight:'24px',fontWeight:600,textDecoration:'none'}}>Accept customer invitation</Button>}
    {expiresLabel && <Text style={{color:'#334155',fontSize:'14px',lineHeight:'22px'}}>This invitation expires on {expiresLabel}.</Text>}
    <Text style={{color:'#334155',fontSize:'14px',lineHeight:'22px'}}>Keep this invitation private. Forwarding it does not give another email address access. If you did not expect it, you can ignore this email.</Text>
  </BaseEmailLayout>;
}
