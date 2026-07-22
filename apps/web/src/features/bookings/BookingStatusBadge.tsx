import type { OperationalBookingStatus } from '@ks-os/contracts';
import { bookingStatusDisplay } from './booking-display.js';

interface BookingStatusBadgeProps {
  status: OperationalBookingStatus;
  compact?: boolean;
}
export function BookingStatusBadge({ status, compact = false }: BookingStatusBadgeProps) {
  const display = bookingStatusDisplay[status];
  return <span className={`inline-flex items-center gap-1 rounded-full border font-bold ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'} ${display.className}`}>
    <span aria-hidden="true">{display.symbol}</span>
    <span>{display.label}</span>
  </span>;
}
