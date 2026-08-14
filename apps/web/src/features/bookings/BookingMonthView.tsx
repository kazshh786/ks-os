import { useEffect, useState } from 'react';
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
  const [selectedDayKey, setSelectedDayKey] = useState('');
  const itemsForDay = (dayKey: string) => bookings.filter(booking => localDayKey(booking.startTime, timezone) === dayKey);
  useEffect(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const available = days.some(day => format(day, 'yyyy-MM-dd') === today) ? today : format(days[0], 'yyyy-MM-dd');
    setSelectedDayKey(current => days.some(day => format(day, 'yyyy-MM-dd') === current) ? current : available);
  }, [from, to]);
  const selectedDay = days.find(day => format(day, 'yyyy-MM-dd') === selectedDayKey) || days[0];
  const selectedItems = itemsForDay(format(selectedDay, 'yyyy-MM-dd'));

  return <>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white md:hidden">
      <div className="grid grid-cols-7 border-b bg-slate-50">{['M','T','W','T','F','S','S'].map((day, index) => <div key={`${day}-${index}`} className="py-2 text-center text-[10px] font-black uppercase text-slate-500">{day}</div>)}</div>
      <div className="grid grid-cols-7 gap-px bg-slate-200">{days.map(day => { const dayKey = format(day, 'yyyy-MM-dd'); const count = itemsForDay(dayKey).length; return <button key={dayKey} type="button" aria-pressed={selectedDayKey === dayKey} aria-label={`${format(day, 'd MMMM')}, ${count} booking${count === 1 ? '' : 's'}`} onClick={() => setSelectedDayKey(dayKey)} className={`relative min-h-11 bg-white text-sm font-black ${selectedDayKey === dayKey ? 'bg-indigo-600 text-white' : 'text-slate-800'}`}>{format(day, 'd')}{count > 0 && <span className={`absolute bottom-1 right-1 rounded-full px-1 text-[9px] ${selectedDayKey === dayKey ? 'bg-white text-indigo-700' : 'bg-indigo-100 text-indigo-800'}`}>{count}</span>}</button>; })}</div>
      <section className="border-t bg-white p-4" aria-labelledby="selected-month-day"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wide text-indigo-600">Selected day</p><h3 id="selected-month-day" className="font-black text-slate-950">{format(selectedDay, 'EEEE d MMMM')}</h3></div><button onClick={() => onSelectDay(selectedDay)} className="min-h-11 shrink-0 rounded-xl border px-3 text-xs font-black">Day view</button></div>
        <div className="mt-3 space-y-2">{selectedItems.map(booking => <button key={booking.id} onClick={() => onOpen(booking)} className="flex min-h-11 w-full items-center gap-3 rounded-xl border p-3 text-left"><span className="shrink-0 font-mono text-xs font-black text-indigo-700">{localTime(booking.startTime, timezone)}</span><span className="min-w-0 flex-1 break-words text-sm font-bold">{booking.customer.name}</span><BookingStatusBadge status={booking.status} compact /></button>)}{selectedItems.length === 0 && <div className="rounded-xl border border-dashed p-5 text-center text-sm text-slate-500">No bookings on this day.</div>}</div>
      </section>
    </div>
    <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 md:block"><div className="grid grid-cols-7 gap-px bg-slate-200">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => <div key={day} className="bg-slate-50 p-2 text-center text-xs font-black uppercase text-slate-500">{day}</div>)}{days.map(day => {
    const dayKey = format(day, 'yyyy-MM-dd');
    const items = itemsForDay(dayKey);
    return <section key={dayKey} className="min-h-32 bg-white p-2"><button onClick={() => onSelectDay(day)} aria-label={`Open ${format(day, 'd MMMM')} in day view`} className="grid h-11 w-11 place-items-center rounded-lg text-xs font-black hover:bg-slate-100">{format(day, 'd')}</button><div className="mt-1 space-y-1">{items.slice(0, 3).map(booking => <button key={booking.id} onClick={() => onOpen(booking)} className="flex min-h-11 w-full items-center gap-1 rounded-md border p-2 text-left text-[10px] hover:border-indigo-300"><span className="font-mono font-black">{localTime(booking.startTime, timezone)}</span><span className="min-w-0 flex-1 truncate font-bold">{booking.customer.name}</span><span className="sr-only"><BookingStatusBadge status={booking.status} compact /></span></button>)}{items.length > 3 && <button onClick={() => onSelectDay(day)} className="min-h-11 text-[10px] font-bold text-indigo-700">+{items.length - 3} more</button>}</div></section>;
  })}</div></div>
  </>;
}
