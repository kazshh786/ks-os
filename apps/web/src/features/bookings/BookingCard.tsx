import type { DragEvent } from 'react';
import { AlertTriangle, FileText, MapPin, Wallet } from 'lucide-react';
import type { BookingOperationsItem } from '@ks-os/contracts';
import { BookingStatusBadge } from './BookingStatusBadge.js';
import { localTime } from './booking-display.js';

interface BookingCardProps {
  booking: BookingOperationsItem;
  density: 'compact' | 'comfortable' | 'detailed';
  onOpen: (booking: BookingOperationsItem) => void;
  draggable?: boolean;
  onDragStart?: (booking: BookingOperationsItem, event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  timeGrid?: boolean;
  className?: string;
}

export function BookingCard({ booking, density, onOpen, draggable, onDragStart, onDragEnd, timeGrid = false, className = '' }: BookingCardProps) {
  const durationMinutes = Math.max(0, Math.round((new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / 60_000));
  const compressed = timeGrid && (density === 'compact' || durationMinutes < 45);
  const detailed = density === 'detailed' && (!timeGrid || durationMinutes >= 75);

  return <button
    type="button"
    draggable={draggable}
    onDragStart={event => onDragStart?.(booking, event)}
    onDragEnd={onDragEnd}
    onClick={() => onOpen(booking)}
    aria-label={`${localTime(booking.startTime, booking.timezone)} ${booking.customer.name}, ${booking.service.name}, ${booking.status.toLowerCase()}`}
    className={`w-full overflow-hidden rounded-xl border-l-4 border border-slate-200 bg-white text-left shadow-xs transition hover:border-indigo-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${timeGrid ? 'h-full p-2' : density === 'compact' ? 'p-2' : 'p-3'} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${className}`}
  >
    <div className="flex min-w-0 items-start justify-between gap-1.5">
      <div className="min-w-0">
        <p className="truncate font-mono text-[11px] font-black text-slate-950">{localTime(booking.startTime, booking.timezone)}–{localTime(booking.endTime, booking.timezone)}</p>
        <p className="mt-0.5 truncate text-sm font-black leading-tight text-slate-900">{booking.customer.name}</p>
      </div>
      {!compressed && <BookingStatusBadge status={booking.status} compact />}
    </div>
    {!compressed && <p className="mt-1 truncate text-xs font-semibold text-slate-600">{booking.service.name} · {booking.staff.name}</p>}
    {detailed && <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold text-slate-500">
      {booking.location.name && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{booking.location.name}</span>}
      <span className="inline-flex items-center gap-1"><Wallet className="h-3 w-3" />{booking.paymentStatus}</span>
      <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />{booking.intakeStatus.replaceAll('_', ' ')}</span>
      {booking.attentionReasons.length > 0 && <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3 w-3" />Attention</span>}
    </div>}
  </button>;
}
