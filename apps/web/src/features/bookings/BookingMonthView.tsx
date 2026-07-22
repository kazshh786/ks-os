import { eachDayOfInterval, format } from 'date-fns';
import type { BookingOperationsItem } from '@ks-os/contracts';
import { BookingStatusBadge } from './BookingStatusBadge.js';
import { localDayKey, localTime } from './booking-display.js';

interface BookingMonthViewProps {
  from: Date;
  to: Date;
  bookings: BookingOperationsItem[];
  timezone: string;
  onOpen: (booking: BookingOperationsItem) => void;
  onSelectDay: (day: Date) => void;
}
export function BookingMonthView({ from, to, bookings, timezone, onOpen, onSelectDay }: BookingMonthViewProps) {
  const days = eachDayOfInterval({ start: from, end: to });
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-200"><div className="grid grid-cols-7 gap-px bg-slate-200">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => <div key={day} className="bg-slate-50 p-2 text-center text-xs font-black uppercase text-slate-500">{day}</div>)}{days.map(day => {
    const dayKey = format(day, 'yyyy-MM-dd');
    const items = bookings.filter(booking => localDayKey(booking.startTime, timezone) === dayKey);
    return <section key={dayKey} className="min-h-32 bg-white p-2"><button onClick={() => onSelectDay(day)} aria-label={`Open ${format(day, 'd MMMM')} in day view`} className="rounded-md px-1 text-xs font-black hover:bg-slate-100">{format(day, 'd')}</button><div className="mt-1 space-y-1">{items.slice(0, 3).map(booking => <button key={booking.id} onClick={() => onOpen(booking)} className="flex w-full items-center gap-1 rounded-md border p-1 text-left text-[10px] hover:border-indigo-300"><span className="font-mono font-black">{localTime(booking.startTime, timezone)}</span><span className="min-w-0 flex-1 truncate font-bold">{booking.customer.name}</span><span className="sr-only"><BookingStatusBadge status={booking.status} compact /></span></button>)}{items.length > 3 && <button onClick={() => onSelectDay(day)} className="text-[10px] font-bold text-indigo-700">+{items.length - 3} more</button>}</div></section>;
  })}</div></div>;
}
