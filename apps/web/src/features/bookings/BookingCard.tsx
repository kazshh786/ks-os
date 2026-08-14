import { AlertTriangle, FileText, MapPin, Wallet } from 'lucide-react';
import type { BookingOperationsItem } from '@ks-os/contracts';
import { BookingStatusBadge } from './BookingStatusBadge.js';
import { localTime } from './booking-display.js';

interface BookingCardProps {
  booking: BookingOperationsItem;
  density: 'compact' | 'comfortable' | 'detailed';
  onOpen: (booking: BookingOperationsItem) => void;
  draggable?: boolean;
  onDragStart?: (booking: BookingOperationsItem) => void;
}
export function BookingCard({ booking, density, onOpen, draggable, onDragStart }: BookingCardProps) {
  return <button type="button" draggable={draggable} onDragStart={() => onDragStart?.(booking)} onClick={() => onOpen(booking)} aria-label={`${localTime(booking.startTime, booking.timezone)} ${booking.customer.name}, ${booking.service.name}, ${booking.status.toLowerCase()}`} className={`w-full rounded-xl border-l-4 border border-slate-200 bg-white text-left shadow-xs transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${density === 'compact' ? 'p-2' : 'p-3'}`}>
    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="font-mono text-xs font-black text-slate-950">{localTime(booking.startTime, booking.timezone)}–{localTime(booking.endTime, booking.timezone)}</p><p className="mt-0.5 line-clamp-2 break-words text-sm font-black text-slate-900">{booking.customer.name}</p></div><BookingStatusBadge status={booking.status} compact /></div>
    {density !== 'compact' && <p className="mt-2 line-clamp-2 break-words text-xs font-semibold text-slate-600">{booking.service.name} · {booking.staff.name}</p>}
    {density === 'detailed' && <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold text-slate-500">
      {booking.location.name && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{booking.location.name}</span>}
      <span className="inline-flex items-center gap-1"><Wallet className="h-3 w-3" />{booking.paymentStatus}</span>
      <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />{booking.intakeStatus.replaceAll('_', ' ')}</span>
      {booking.attentionReasons.length > 0 && <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3 w-3" />Attention</span>}
    </div>}
  </button>;
}
