import { Button, Heading, Text } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export interface FactFindingNotificationEmailProps {
  tenantName?: string;
  tenantPrimaryColor?: string;
  participantName?: string;
  questionnaireUrl?: string;
  heading?: string;
  message?: string;
  expiresAt?: string;
}

export const FactFindingNotificationEmail = ({
  tenantName = 'Your business team',
  tenantPrimaryColor = '#4f46e5',
  participantName = 'there',
  questionnaireUrl = 'https://example.test/fact-finding',
  heading = 'Your business questionnaire needs attention',
  message = 'Open the secure questionnaire to continue or respond to the requested clarification.',
  expiresAt,
}: FactFindingNotificationEmailProps) => (
  <BaseEmailLayout
    tenantName={tenantName}
    tenantPrimaryColor={tenantPrimaryColor}
    previewText={heading}
  >
    <Heading className="text-xl text-gray-900">{heading}</Heading>
    <Text className="text-sm text-gray-700">Hello {participantName},</Text>
    <Text className="text-sm text-gray-700">{message}</Text>
    <Button
      href={questionnaireUrl}
      className="rounded bg-indigo-600 px-5 py-3 text-sm font-bold text-white"
    >
      Continue questionnaire
    </Button>
    {expiresAt ? (
      <Text className="mt-4 text-xs text-gray-500">
        The secure link expires on {expiresAt}.
      </Text>
    ) : null}
  </BaseEmailLayout>
);
