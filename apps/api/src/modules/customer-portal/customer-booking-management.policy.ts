import type { CustomerBookingManagementPolicy } from '@ks-os/contracts';

export type CustomerBookingPolicySettings = {
  customerCancellationEnabled: boolean;
  customerReschedulingEnabled: boolean;
  minimumCancellationNoticeMinutes: number;
  minimumRescheduleNoticeMinutes: number;
  maximumCustomerReschedules: number;
  requireCancellationReason: boolean;
  lateCancellationMessage: string;
  depositPolicyMessage: string;
};

export type CustomerBookingPolicyAppointment = {
  status: string;
  startTime: Date;
  customerRescheduleCount: number;
};

export type CustomerBookingPaymentContext = {
  paidAmount: number;
  hasOnlinePayment: boolean;
  hasDirectPayment: boolean;
};

const manageableStatuses = new Set(['PENDING', 'CONFIRMED']);

export function evaluateCustomerBookingManagementPolicy(input: {
  appointment: CustomerBookingPolicyAppointment;
  settings: CustomerBookingPolicySettings;
  payment: CustomerBookingPaymentContext;
  now?: Date;
}): CustomerBookingManagementPolicy {
  const { appointment, settings, payment } = input;
  const now = input.now ?? new Date();
  const cancellationDeadline = new Date(appointment.startTime.getTime() - settings.minimumCancellationNoticeMinutes * 60_000);
  const rescheduleDeadline = new Date(appointment.startTime.getTime() - settings.minimumRescheduleNoticeMinutes * 60_000);
  const stateManageable = manageableStatuses.has(appointment.status);
  const cancellationLate = now >= cancellationDeadline;
  const rescheduleLate = now >= rescheduleDeadline;
  const reschedulesRemaining = Math.max(settings.maximumCustomerReschedules - appointment.customerRescheduleCount, 0);
  const limitReached = reschedulesRemaining === 0;
  const blockedReasons: string[] = [];

  if (!stateManageable) blockedReasons.push('This appointment can no longer be changed online. Please contact the salon.');
  if (!settings.customerCancellationEnabled) blockedReasons.push('Online cancellation is not offered for this appointment. Please contact the salon.');
  if (!settings.customerReschedulingEnabled) blockedReasons.push('Online rescheduling is not offered for this appointment. Please contact the salon.');
  if ((cancellationLate || rescheduleLate) && stateManageable) blockedReasons.push(settings.lateCancellationMessage);
  if (limitReached && stateManageable) blockedReasons.push('The maximum number of online reschedules has been reached. Please contact the salon.');

  const paymentImpact = payment.paidAmount <= 0
    ? { type: 'NONE' as const, message: 'No online payment was recorded for this booking.' }
    : payment.hasOnlinePayment
      ? { type: 'REFUND_REVIEW_REQUIRED' as const, message: settings.depositPolicyMessage }
      : payment.hasDirectPayment
        ? { type: 'NO_AUTOMATIC_REFUND' as const, message: 'Please contact the salon regarding any payment already made directly to them.' }
        : { type: 'NO_AUTOMATIC_REFUND' as const, message: settings.depositPolicyMessage };

  return {
    canCancel: stateManageable && settings.customerCancellationEnabled && !cancellationLate,
    canReschedule: stateManageable && settings.customerReschedulingEnabled && !rescheduleLate && !limitReached,
    cancellationDeadline: cancellationDeadline.toISOString(),
    rescheduleDeadline: rescheduleDeadline.toISOString(),
    reschedulesUsed: appointment.customerRescheduleCount,
    reschedulesRemaining,
    requireCancellationReason: settings.requireCancellationReason,
    paymentImpact,
    blockedReasons: [...new Set(blockedReasons)],
    cancellationPolicyMessage: settings.lateCancellationMessage,
    depositPolicyMessage: settings.depositPolicyMessage,
  };
}

export function policyRestrictionCode(
  action: 'CANCEL' | 'RESCHEDULE',
  appointment: CustomerBookingPolicyAppointment,
  settings: CustomerBookingPolicySettings,
  now = new Date(),
) {
  if (!manageableStatuses.has(appointment.status)) return 'CUSTOMER_BOOKING_NOT_MANAGEABLE';
  if (action === 'CANCEL' && !settings.customerCancellationEnabled) return 'CUSTOMER_BOOKING_CANCELLATION_DISABLED';
  if (action === 'RESCHEDULE' && !settings.customerReschedulingEnabled) return 'CUSTOMER_BOOKING_RESCHEDULING_DISABLED';
  const notice = action === 'CANCEL' ? settings.minimumCancellationNoticeMinutes : settings.minimumRescheduleNoticeMinutes;
  if (now >= new Date(appointment.startTime.getTime() - notice * 60_000)) {
    return action === 'CANCEL'
      ? 'CUSTOMER_BOOKING_CANCELLATION_DEADLINE_PASSED'
      : 'CUSTOMER_BOOKING_RESCHEDULE_DEADLINE_PASSED';
  }
  if (action === 'RESCHEDULE' && appointment.customerRescheduleCount >= settings.maximumCustomerReschedules) {
    return 'CUSTOMER_BOOKING_RESCHEDULE_LIMIT_REACHED';
  }
  return null;
}
