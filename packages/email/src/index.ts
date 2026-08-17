import { render } from '@react-email/render';
import React from 'react';

import { BookingConfirmedEmail } from './templates/booking-confirmed.js';
import { BookingRescheduledEmail } from './templates/booking-rescheduled.js';
import { BookingCancelledEmail } from './templates/booking-cancelled.js';
import { AppointmentReminderEmail } from './templates/appointment-reminder.js';
import { FormAssignedEmail } from './templates/form-assigned.js';
import { FormReminderEmail } from './templates/form-reminder.js';
import { PaymentConfirmedEmail } from './templates/payment-confirmed.js';
import { RefundUpdatedEmail } from './templates/refund-updated.js';
import { StaffOperationalNotificationEmail } from './templates/staff-operational-notification.js';
import { ScheduledReportReadyEmail } from './templates/scheduled-report-ready.js';
import { CustomerPortalClaimEmail } from './templates/customer-portal-claim.js';
import { ReviewInvitationEmail } from './templates/review-invitation.js';
import { AccountAccessInvitationEmail } from './templates/account-access-invitation.js';
import { SiteReviewInvitationEmail } from './templates/site-review-invitation.js';
import { SiteReviewNotificationEmail } from './templates/site-review-notification.js';
import { FactFindingInvitationEmail } from './templates/fact-finding-invitation.js';
import { FactFindingNotificationEmail } from './templates/fact-finding-notification.js';
import { BusinessBookingConfirmedEmail } from './templates/business-booking-confirmed.js';
import { BusinessPaymentReceivedEmail } from './templates/business-payment-received.js';

export const templates = {
  'booking-confirmed': BookingConfirmedEmail,
  'booking-rescheduled': BookingRescheduledEmail,
  'booking-cancelled': BookingCancelledEmail,
  'appointment-reminder': AppointmentReminderEmail,
  'form-assigned': FormAssignedEmail,
  'form-reminder': FormReminderEmail,
  'payment-confirmed': PaymentConfirmedEmail,
  'refund-updated': RefundUpdatedEmail,
  'staff-operational-notification': StaffOperationalNotificationEmail,
  'scheduled-report-ready': ScheduledReportReadyEmail,
  'customer-portal-claim': CustomerPortalClaimEmail,
  'review-invitation': ReviewInvitationEmail,
  'account-access-invitation': AccountAccessInvitationEmail,
  'site-review-invitation': SiteReviewInvitationEmail,
  'site-review-notification': SiteReviewNotificationEmail,
  'fact-finding-invitation': FactFindingInvitationEmail,
  'fact-finding-notification': FactFindingNotificationEmail,
  'business-booking-confirmed': BusinessBookingConfirmedEmail,
  'business-payment-received': BusinessPaymentReceivedEmail,
} as const;

export type TemplateKey = keyof typeof templates;

export async function renderEmail(templateKey: string, data: any): Promise<{ html: string; text: string }> {
  const Template = templates[templateKey as TemplateKey];
  if (!Template) throw new Error(`Template ${templateKey} not found`);
  const element = React.createElement(Template as any, data);
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { html, text };
}

export {
  darkenEmailColor,
  ensureReadableTextColor,
  getContrastRatio,
  getReadableTextColor,
  lightenEmailColor,
  mixEmailColor,
} from './components/email-colors.js';
export { getEmailDesign } from './components/email-design.js';
export type { EmailBrandTheme, EmailDesign, EmailDesignStyle } from './components/email-design.js';
export {
  BrandLogoPanel,
  SocialFollowCard,
  PaymentReceiptCard,
  ChangeComparisonCard,
} from './components/FormEmailComponents.js';
