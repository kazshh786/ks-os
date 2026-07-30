export interface BookingRescheduleIntent {
  bookingId: string;
  startTime: string;
  staffId: string;
  targetLabel: string;
}

let pendingIntent: BookingRescheduleIntent | null = null;

export function setPendingBookingReschedule(intent: BookingRescheduleIntent) {
  pendingIntent = intent;
}

export function consumePendingBookingReschedule(bookingId: string): BookingRescheduleIntent | null {
  if (!pendingIntent || pendingIntent.bookingId !== bookingId) return null;
  const intent = pendingIntent;
  pendingIntent = null;
  return intent;
}
