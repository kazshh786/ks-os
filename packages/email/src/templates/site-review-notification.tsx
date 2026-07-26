import { Button, Heading, Text } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export interface SiteReviewNotificationEmailProps {
  tenantName?: string;
  tenantPrimaryColor?: string;
  participantName?: string;
  heading?: string;
  message?: string;
  reviewUrl?: string;
}

export const SiteReviewNotificationEmail = ({
  tenantName = 'Your website team',
  tenantPrimaryColor = '#4f46e5',
  participantName = 'there',
  heading = 'Website review update',
  message = 'There is an update to your website review.',
  reviewUrl,
}: SiteReviewNotificationEmailProps) => (
  <BaseEmailLayout
    tenantName={tenantName}
    tenantPrimaryColor={tenantPrimaryColor}
    previewText={heading}
  >
    <Heading className="text-xl text-gray-900">{heading}</Heading>
    <Text className="text-sm text-gray-700">Hello {participantName},</Text>
    <Text className="text-sm text-gray-700">{message}</Text>
    {reviewUrl ? (
      <Button
        href={reviewUrl}
        className="rounded bg-indigo-600 px-5 py-3 text-sm font-bold text-white"
      >
        Open secure review
      </Button>
    ) : null}
    <Text className="mt-5 text-xs text-gray-500">
      This message contains no website content or private review notes.
    </Text>
  </BaseEmailLayout>
);
