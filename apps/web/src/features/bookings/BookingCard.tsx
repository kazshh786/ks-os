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
  const singleLine = timeGrid && durationMinutes <= 30;
  const veryShort = timeGrid && durationMinutes < 45;
  const canShowStatus = !timeGrid || durationMinutes >= (density === 'compact' ? 45 : 60);
  const canShowSeparateService = !timeGrid || durationMinutes >= (density === 'compact' ? 60 : density === 'comfortable' ? 45 : 45);
  const detailed = density === 'detailed' && (!timeGrid || durationMinutes >= 75);
  const startLabel = localTime(booking.startTime, booking.timezone);
  const timeLabel = `${startLabel}–${localTime(booking.endTime, booking.timezone)}`;

  return <button
    type="button"
    draggable={draggable}
    onDragStart={event => onDragStart?.(booking, event)}
    onDragEnd={onDragEnd}
    onClick={() => onOpen(booking)}
    aria-label={`${timeLabel} ${booking.customer.name}, ${booking.service.name}, ${booking.status.toLowerCase()}`}
    data-booking-card-layout={singleLine ? 'single-line' : 'stacked'}
    className={`w-full overflow-hidden rounded-xl border-l-4 border border-slate-200 bg-white text-left shadow-xs transition hover:border-indigo-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${timeGrid ? singleLine ? 'h-full px-1.5 py-1' : 'h-full p-1.5' : density === 'compact' ? 'p-2' : 'p-3'} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${className}`}
  >
    {singleLine
      ? <p className="flex h-full min-w-0 items-center gap-1 truncate text-[10px] font-semibold leading-none text-slate-600" title={`${timeLabel} · ${booking.customer.name} · ${booking.service.name}`}>
        <span className="shrink-0 font-mono font-black text-slate-700">{startLabel}</span>
        <span aria-hidden="true" className="text-slate-400">·</span>
        <span className="truncate font-black text-slate-950">{booking.customer.name}</span>
        <span aria-hidden="true" className="text-slate-400">·</span>
        <span className="truncate">{booking.service.name}</span>
      </p>
      : <>
        <div className="flex min-w-0 items-start justify-between gap-1.5">
          <p className="truncate font-mono text-[10px] font-black leading-tight text-slate-700">{timeLabel}</p>
          {canShowStatus && <BookingStatusBadge status={booking.status} compact />}
        </div>

        {veryShort || !canShowSeparateService
          ? <p className="mt-0.5 truncate text-[11px] font-black leading-tight text-slate-950" title={`${booking.customer.name} · ${booking.service.name}`}>{booking.customer.name} · <span className="font-semibold text-slate-600">{booking.service.name}</span></p>
          : <>
            <p className={`mt-0.5 text-sm font-black leading-tight text-slate-950 ${timeGrid ? 'truncate' : 'line-clamp-2 break-words'}`} title={booking.customer.name}>{booking.customer.name}</p>
            <p className={`mt-0.5 text-[11px] font-semibold leading-tight text-slate-600 ${timeGrid ? 'truncate' : 'line-clamp-2 break-words'}`} title={`${booking.service.name} with ${booking.staff.name}`}>{booking.service.name}{density !== 'compact' ? ` · ${booking.staff.name}` : ''}</p>
          </>}

        {detailed && <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold text-slate-500">
          {booking.location.name && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{booking.location.name}</span>}
          <span className="inline-flex items-center gap-1"><Wallet className="h-3 w-3" />{booking.paymentStatus}</span>
          <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />{booking.intakeStatus.replaceAll('_', ' ')}</span>
          {booking.attentionReasons.length > 0 && <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3 w-3" />Attention</span>}
        </div>}
      </>}
  </button>;
}
