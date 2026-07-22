import { Button, Heading, Text } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export interface AccountAccessInvitationEmailProps {
  tenantName?: string;
  tenantPrimaryColor?: string;
  recipientName?: string;
  accessLabel?: string;
  invitationUrl?: string;
  existingAccount?: boolean;
}

export const AccountAccessInvitationEmail = ({
  tenantName = 'KS OS', tenantPrimaryColor = '#4f46e5', recipientName = 'there',
  accessLabel = 'your workspace', invitationUrl = 'https://example.test/login', existingAccount = false,
}: AccountAccessInvitationEmailProps) => (
  <BaseEmailLayout tenantName={tenantName} tenantPrimaryColor={tenantPrimaryColor} previewText={`You have been invited to ${accessLabel}`}>
    <Heading className="text-xl text-gray-900">You have been invited</Heading>
    <Text className="text-sm text-gray-700">Hello {recipientName},</Text>
    <Text className="text-sm text-gray-700">
      {existingAccount
        ? `Your KS OS sign-in now has an invitation waiting for ${accessLabel}. Sign in to review it, or use Forgot password first if you have not set a password.`
        : `A secure invitation has been created for ${accessLabel}. Use the button below to continue.`}
    </Text>
    <Button href={invitationUrl} className="rounded bg-indigo-600 px-5 py-3 text-sm font-bold text-white">
      Review invitation
    </Button>
    <Text className="mt-5 text-xs text-gray-500">If you were not expecting this invitation, you can safely ignore this email.</Text>
  </BaseEmailLayout>
);
