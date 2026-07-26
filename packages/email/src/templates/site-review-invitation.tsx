import { Button, Heading, Text } from '@react-email/components';
import { BaseEmailLayout } from '../components/BaseEmailLayout.js';

export interface SiteReviewInvitationEmailProps {
  tenantName?: string;
  tenantPrimaryColor?: string;
  participantName?: string;
  reviewUrl?: string;
  expiresAt?: string;
}

export const SiteReviewInvitationEmail = ({
  tenantName = 'Your website team',
  tenantPrimaryColor = '#4f46e5',
  participantName = 'there',
  reviewUrl = 'https://example.test/site-review',
  expiresAt,
}: SiteReviewInvitationEmailProps) => (
  <BaseEmailLayout
    tenantName={tenantName}
    tenantPrimaryColor={tenantPrimaryColor}
    previewText="Your website draft is ready for secure review"
  >
    <Heading className="text-xl text-gray-900">Your website is ready for review</Heading>
    <Text className="text-sm text-gray-700">Hello {participantName},</Text>
    <Text className="text-sm text-gray-700">
      Your website team has prepared a draft for you to review. You can verify facts,
      leave comments, request changes, and record your decision through the secure
      review link.
    </Text>
    <Button
      href={reviewUrl}
      className="rounded bg-indigo-600 px-5 py-3 text-sm font-bold text-white"
    >
      Review website
    </Button>
    {expiresAt ? (
      <Text className="mt-4 text-xs text-gray-500">
        This secure invitation expires on {expiresAt}.
      </Text>
    ) : null}
    <Text className="mt-5 text-xs text-gray-500">
      The review link is personal. Do not forward it. If you were not expecting this
      invitation, you can safely ignore this email.
    </Text>
  </BaseEmailLayout>
);
