export type FormDeliveryMethod = 'COPY_LINK' | 'EMAIL' | 'SMS';

export function buildSecureFormUrl(origin: string | undefined, token: string): string | undefined {
  const normalizedOrigin = origin?.trim().replace(/\/$/, '');
  return normalizedOrigin ? normalizedOrigin + '/forms/complete/' + token : undefined;
}

export function shouldQueueFormAssignmentEmail(input: {
  deliveryMethod: FormDeliveryMethod;
  recipientEmail?: string | null;
  formDeliveryEnabled?: boolean | null;
  secureUrl?: string;
}): boolean {
  return input.deliveryMethod === 'EMAIL'
    && Boolean(input.recipientEmail)
    && input.formDeliveryEnabled === true
    && Boolean(input.secureUrl);
}

export function formReminderScheduledFor(
  timing: string | null | undefined,
  assignedAt: Date,
  appointmentStart?: Date,
): Date | null {
  if (timing === '24_hours_after_assignment') return new Date(assignedAt.getTime() + 24 * 3_600_000);
  if (timing === '48_hours_before_appointment' && appointmentStart) {
    return new Date(appointmentStart.getTime() - 48 * 3_600_000);
  }
  if (timing === '24_hours_before_appointment' && appointmentStart) {
    return new Date(appointmentStart.getTime() - 24 * 3_600_000);
  }
  return null;
}

export function shouldQueueFormReminder(input: {
  deliveryMethod: FormDeliveryMethod;
  recipientEmail?: string | null;
  formDeliveryEnabled?: boolean | null;
  formRemindersEnabled?: boolean | null;
  secureUrl?: string;
  scheduledFor: Date | null;
  expiresAt: Date;
  now?: Date;
}): boolean {
  const now = input.now || new Date();
  return shouldQueueFormAssignmentEmail(input)
    && input.formRemindersEnabled === true
    && Boolean(input.scheduledFor)
    && input.scheduledFor!.getTime() > now.getTime()
    && input.scheduledFor!.getTime() < input.expiresAt.getTime();
}
