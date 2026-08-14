import { useEffect, useState } from 'react';
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
  onReschedule: (booking: BookingOperationsItem, target: ScheduleColumn) => void;
}

export function BookingScheduleView({ columns, bookings, groupBy, density, timezone, onOpen, onCreate, onReschedule }: BookingScheduleViewProps) {
  const [dragging, setDragging] = useState<BookingOperationsItem | null>(null);
  const [mobileColumnId, setMobileColumnId] = useState('');
  const forColumn = (column: ScheduleColumn) => bookings.filter(booking => groupBy === 'day'
    ? localDayKey(booking.startTime, timezone) === column.id
    : groupBy === 'staff' ? booking.staff.id === column.id : (booking.location.id || 'unassigned') === column.id);
  useEffect(() => {
    if (columns.some(column => column.id === mobileColumnId)) return;
    const today = localDayKey(new Date().toISOString(), timezone);
    setMobileColumnId(columns.find(column => column.id === today)?.id || columns.find(column => forColumn(column).length > 0)?.id || columns[0]?.id || '');
  }, [columns, mobileColumnId, timezone]);
  const mobileColumn = columns.find(column => column.id === mobileColumnId) || columns[0];

  const currentMarker = (column: ScheduleColumn) => groupBy === 'day' && localDayKey(new Date().toISOString(), timezone) === column.id
    ? <div className="border-b border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-rose-700" aria-label="Current day">Now · {new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date())}</div>
    : null;

  return <>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white md:hidden">
      {columns.length > 0 ? <>
        <label className="block border-b bg-slate-50 p-3 text-xs font-black uppercase tracking-wide text-slate-500">Schedule column<select aria-label="Choose schedule column" value={mobileColumn?.id || ''} onChange={event => setMobileColumnId(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-bold normal-case text-slate-900">{columns.map(column => <option key={column.id} value={column.id}>{column.label}{column.subtitle ? ` · ${column.subtitle}` : ''}</option>)}</select></label>
        {mobileColumn && <section aria-labelledby={`mobile-column-${mobileColumn.id}`}>
          <header className="border-b bg-white p-4"><h3 id={`mobile-column-${mobileColumn.id}`} className="text-base font-black text-slate-900">{mobileColumn.label}</h3>{mobileColumn.subtitle && <p className="text-sm text-slate-500">{mobileColumn.subtitle}</p>}</header>
          {currentMarker(mobileColumn)}
          <div className="space-y-3 p-3">{forColumn(mobileColumn).map(booking => <BookingCard key={booking.id} booking={booking} density={density} onOpen={onOpen} />)}{forColumn(mobileColumn).length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center"><p className="text-sm font-semibold text-slate-500">No bookings in this column.</p><button onClick={onCreate} className="mt-3 min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white">Create booking</button></div>}</div>
        </section>}
      </> : <div className="p-8 text-center text-sm text-slate-500">No schedule columns are available.</div>}
    </div>
    <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-slate-100 md:block">
      <div className="grid min-w-[760px] gap-px" style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(190px, 1fr))` }}>
      {columns.map(column => <section key={column.id} aria-labelledby={`column-${column.id}`} onDragOver={event => { if (groupBy !== 'location') event.preventDefault(); }} onDrop={() => { if (dragging && groupBy !== 'location') onReschedule(dragging, column); setDragging(null); }} className="min-h-[560px] bg-slate-50">
        <header className="sticky top-0 z-10 border-b bg-white p-3"><h3 id={`column-${column.id}`} className="text-sm font-black text-slate-900">{column.label}</h3>{column.subtitle && <p className="text-xs text-slate-500">{column.subtitle}</p>}</header>
        {currentMarker(column)}
        <div className="space-y-2 p-2">{forColumn(column).map(booking => <BookingCard key={booking.id} booking={booking} density={density} onOpen={onOpen} draggable={!['COMPLETED','CANCELLED','NO_SHOW'].includes(booking.status) && groupBy !== 'location'} onDragStart={setDragging} />)}{forColumn(column).length === 0 && <button onClick={onCreate} className="min-h-11 w-full rounded-xl border border-dashed border-slate-300 p-3 text-xs font-bold text-slate-500 hover:border-indigo-300 hover:text-indigo-700">Available · create booking</button>}</div>
      </section>)}
      </div>
    </div>
  </>;
}
