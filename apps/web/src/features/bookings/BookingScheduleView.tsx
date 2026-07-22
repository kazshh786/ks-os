import type { BookingOperationsItem } from '@ks-os/contracts';
import { BookingCard } from './BookingCard.js';
import { localDayKey } from './booking-display.js';

interface ScheduleColumn {
  id: string;
  label: string;
  subtitle?: string;
}
interface BookingScheduleViewProps {
  columns: ScheduleColumn[];
  bookings: BookingOperationsItem[];
  groupBy: 'day' | 'staff' | 'location';
  density: 'compact' | 'comfortable' | 'detailed';
  timezone: string;
  onOpen: (booking: BookingOperationsItem) => void;
  onCreate: () => void;
}

export function BookingScheduleView({ columns, bookings, groupBy, density, timezone, onOpen, onCreate }: BookingScheduleViewProps) {
  const forColumn = (column: ScheduleColumn) => bookings.filter(booking => groupBy === 'day'
    ? localDayKey(booking.startTime, timezone) === column.id
    : groupBy === 'staff' ? booking.staff.id === column.id : (booking.location.id || 'unassigned') === column.id);
  return <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-100">
    <div className="grid min-w-[760px] gap-px" style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(190px, 1fr))` }}>
      {columns.map(column => <section key={column.id} aria-labelledby={`column-${column.id}`} className="min-h-[560px] bg-slate-50">
        <header className="sticky top-0 z-10 border-b bg-white p-3"><h3 id={`column-${column.id}`} className="text-sm font-black text-slate-900">{column.label}</h3>{column.subtitle && <p className="text-xs text-slate-500">{column.subtitle}</p>}</header>
        {groupBy === 'day' && localDayKey(new Date().toISOString(), timezone) === column.id && <div className="border-b border-rose-200 bg-rose-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-rose-700" aria-label="Current day">Now · {new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date())}</div>}
        <div className="space-y-2 p-2">{forColumn(column).map(booking => <BookingCard key={booking.id} booking={booking} density={density} onOpen={onOpen} />)}{forColumn(column).length === 0 && <button onClick={onCreate} className="w-full rounded-xl border border-dashed border-slate-300 p-5 text-xs font-bold text-slate-500 hover:border-indigo-300 hover:text-indigo-700">Available · create booking</button>}</div>
      </section>)}
    </div>
  </div>;
}
