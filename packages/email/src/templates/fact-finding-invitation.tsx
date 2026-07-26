import { Button, Heading, Text } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export interface FactFindingInvitationEmailProps {
  tenantName?: string;
  tenantPrimaryColor?: string;
  participantName?: string;
  questionnaireUrl?: string;
  expiresAt?: string;
}

export const FactFindingInvitationEmail = ({
  tenantName = 'Your business team',
  tenantPrimaryColor = '#4f46e5',
  participantName = 'there',
  questionnaireUrl = 'https://example.test/fact-finding',
  expiresAt,
}: FactFindingInvitationEmailProps) => (
  <BaseEmailLayout
    tenantName={tenantName}
    tenantPrimaryColor={tenantPrimaryColor}
    previewText="Complete your secure business fact-finding questionnaire"
  >
    <Heading className="text-xl text-gray-900">Tell us about your business</Heading>
    <Text className="text-sm text-gray-700">Hello {participantName},</Text>
    <Text className="text-sm text-gray-700">
      Your KS OS team has prepared a secure questionnaire. Your answers will be
      reviewed before they are used to configure booking or create website content.
      You can save your progress and return later.
    </Text>
    <Button
      href={questionnaireUrl}
      className="rounded bg-indigo-600 px-5 py-3 text-sm font-bold text-white"
    >
      Open questionnaire
    </Button>
    {expiresAt ? (
      <Text className="mt-4 text-xs text-gray-500">
        This personal invitation expires on {expiresAt}.
      </Text>
    ) : null}
    <Text className="mt-5 text-xs text-gray-500">
      Do not forward this link. If you were not expecting it, you can safely ignore
      this email.
    </Text>
  </BaseEmailLayout>
);
