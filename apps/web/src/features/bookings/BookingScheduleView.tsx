import { useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import type { BookingOperationsItem } from '@ks-os/contracts';
import { BookingCard } from './BookingCard.js';
import { localDayKey } from './booking-display.js';

export interface ScheduleColumn {
  id: string;
  label: string;
  subtitle?: string;
}

export interface ScheduleDropTarget extends ScheduleColumn {
  day: string;
  time: string;
}

interface BookingScheduleViewProps {
  columns: ScheduleColumn[];
  days: ScheduleColumn[];
  bookings: BookingOperationsItem[];
  groupBy: 'day' | 'staff' | 'location';
  density: 'compact' | 'comfortable' | 'detailed';
  timezone: string;
  onOpen: (booking: BookingOperationsItem) => void;
  onCreate: () => void;
  onReschedule: (booking: BookingOperationsItem, target: ScheduleDropTarget) => void;
}

interface RenderColumn extends ScheduleColumn {
  key: string;
  day: string;
  dayLabel: string;
  daySubtitle?: string;
  resourceLabel?: string;
  resourceSubtitle?: string;
}

const slotMinutes = 15;
const defaultStartMinute = 8 * 60;
const defaultEndMinute = 20 * 60;
const hourHeightByDensity = { compact: 48, comfortable: 64, detailed: 80 } as const;

function localMinutes(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const hour = Number(parts.find(part => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find(part => part.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function bookingEndMinute(booking: BookingOperationsItem, timezone: string) {
  return localDayKey(booking.startTime, timezone) === localDayKey(booking.endTime, timezone)
    ? localMinutes(booking.endTime, timezone)
    : 24 * 60;
}

function minuteLabel(totalMinutes: number) {
  const safe = Math.max(0, Math.min(24 * 60, totalMinutes));
  const hour = Math.floor(safe / 60) % 24;
  const minute = safe % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function overlappingLayout(items: BookingOperationsItem[], timezone: string) {
  const rows = items.map(booking => ({
    booking,
    start: localMinutes(booking.startTime, timezone),
    end: Math.max(localMinutes(booking.startTime, timezone) + slotMinutes, bookingEndMinute(booking, timezone)),
  })).sort((left, right) => left.start - right.start || left.end - right.end || left.booking.id.localeCompare(right.booking.id));

  const result: Array<(typeof rows)[number] & { lane: number; laneCount: number }> = [];
  let cluster: typeof rows = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const assigned = cluster.map(row => {
      let lane = laneEnds.findIndex(end => end <= row.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(row.end);
      } else {
        laneEnds[lane] = row.end;
      }
      return { ...row, lane };
    });
    const laneCount = Math.max(1, laneEnds.length);
    result.push(...assigned.map(row => ({ ...row, laneCount })));
  };

  for (const row of rows) {
    if (cluster.length && row.start >= clusterEnd) {
      flushCluster();
      cluster = [];
      clusterEnd = -1;
    }
    cluster.push(row);
    clusterEnd = Math.max(clusterEnd, row.end);
  }
  flushCluster();
  return result;
}

export function BookingScheduleView({ columns, days, bookings, groupBy, density, timezone, onOpen, onCreate, onReschedule }: BookingScheduleViewProps) {
  const [dragging, setDragging] = useState<BookingOperationsItem | null>(null);
  const [dropPreview, setDropPreview] = useState<{ key: string; minute: number } | null>(null);
  const hourHeight = hourHeightByDensity[density];
  const pixelsPerMinute = hourHeight / 60;

  const visibleRange = useMemo(() => {
    if (!bookings.length) return { startMinute: defaultStartMinute, endMinute: defaultEndMinute };
    const starts = bookings.map(booking => localMinutes(booking.startTime, timezone));
    const ends = bookings.map(booking => bookingEndMinute(booking, timezone));
    return {
      startMinute: Math.max(0, Math.min(defaultStartMinute, Math.floor(Math.min(...starts) / 60) * 60)),
      endMinute: Math.min(24 * 60, Math.max(defaultEndMinute, Math.ceil(Math.max(...ends) / 60) * 60)),
    };
  }, [bookings, timezone]);

  const renderColumns = useMemo<RenderColumn[]>(() => {
    if (groupBy === 'day') {
      return columns.map(column => ({
        ...column,
        key: column.id,
        day: column.id,
        dayLabel: column.label,
        daySubtitle: column.subtitle,
      }));
    }

    return days.flatMap(day => columns.map(resource => ({
      id: resource.id,
      label: `${day.label} · ${resource.label}`,
      subtitle: resource.subtitle,
      key: `${day.id}:${resource.id}`,
      day: day.id,
      dayLabel: day.label,
      daySubtitle: day.subtitle,
      resourceLabel: resource.label,
      resourceSubtitle: resource.subtitle,
    })));
  }, [columns, days, groupBy]);

  const bookingsForColumn = (column: RenderColumn) => bookings.filter(booking => {
    if (localDayKey(booking.startTime, timezone) !== column.day) return false;
    if (groupBy === 'staff') return booking.staff.id === column.id;
    if (groupBy === 'location') return (booking.location.id || 'unassigned') === column.id;
    return true;
  });

  const totalMinutes = visibleRange.endMinute - visibleRange.startMinute;
  const gridHeight = Math.max(hourHeight, totalMinutes * pixelsPerMinute);
  const hourLabels = Array.from(
    { length: Math.floor(totalMinutes / 60) + 1 },
    (_, index) => visibleRange.startMinute + index * 60,
  );
  const today = localDayKey(new Date().toISOString(), timezone);
  const nowMinute = localMinutes(new Date().toISOString(), timezone);
  const minimumColumnWidth = groupBy === 'day' ? 160 : 180;
  const templateColumns = `64px repeat(${Math.max(1, renderColumns.length)}, minmax(${minimumColumnWidth}px, 1fr))`;

  const minuteFromDrag = (event: DragEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = clamp(event.clientY - bounds.top, 0, bounds.height);
    const raw = visibleRange.startMinute + offset / pixelsPerMinute;
    return clamp(Math.round(raw / slotMinutes) * slotMinutes, visibleRange.startMinute, visibleRange.endMinute - slotMinutes);
  };

  const beginDrag = (booking: BookingOperationsItem, event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', booking.id);
    setDragging(booking);
  };

  const finishDrag = () => {
    setDragging(null);
    setDropPreview(null);
  };

  return <section aria-label="Booking schedule" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="overflow-auto">
      <div className="min-w-max" style={{ minWidth: `calc(64px + ${Math.max(1, renderColumns.length)} * ${minimumColumnWidth}px)` }}>
        <div className="sticky top-0 z-30 grid border-b border-slate-200 bg-white/95 backdrop-blur" style={{ gridTemplateColumns: templateColumns }}>
          <div className="sticky left-0 z-40 flex min-h-16 items-end justify-end border-r border-slate-200 bg-white px-2 pb-2 text-[10px] font-black uppercase tracking-wide text-slate-400">{timezone.split('/').pop()?.replaceAll('_', ' ')}</div>
          {renderColumns.map(column => {
            const isToday = column.day === today;
            return <header key={column.key} className={`min-h-16 border-r border-slate-200 px-3 py-2 ${isToday ? 'bg-indigo-50/70' : 'bg-white'}`}>
              <p className={`text-xs font-black uppercase tracking-wide ${isToday ? 'text-indigo-700' : 'text-slate-500'}`}>{column.dayLabel}</p>
              {column.resourceLabel
                ? <><h3 className="mt-1 truncate text-sm font-black text-slate-950">{column.resourceLabel}</h3>{column.resourceSubtitle && <p className="truncate text-[11px] text-slate-500">{column.resourceSubtitle}</p>}</>
                : column.daySubtitle && <p className="truncate text-[11px] text-slate-500">{column.daySubtitle}</p>}
            </header>;
          })}
        </div>

        <div className="grid" style={{ gridTemplateColumns: templateColumns }}>
          <aside className="sticky left-0 z-20 border-r border-slate-200 bg-white" style={{ height: gridHeight }} aria-label="Calendar times">
            {hourLabels.map(minute => <span key={minute} className="absolute right-2 -translate-y-1/2 font-mono text-[11px] font-bold text-slate-500" style={{ top: (minute - visibleRange.startMinute) * pixelsPerMinute }}>{minuteLabel(minute)}</span>)}
          </aside>

          {renderColumns.map(column => {
            const columnBookings = overlappingLayout(bookingsForColumn(column), timezone);
            const canDrop = groupBy !== 'location';
            const showNow = column.day === today && nowMinute >= visibleRange.startMinute && nowMinute <= visibleRange.endMinute;
            return <div
              key={column.key}
              role="gridcell"
              aria-label={`${column.label} time grid`}
              onDragOver={event => {
                if (!dragging || !canDrop) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropPreview({ key: column.key, minute: minuteFromDrag(event) });
              }}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropPreview(current => current?.key === column.key ? null : current);
              }}
              onDrop={event => {
                if (!dragging || !canDrop) return;
                event.preventDefault();
                const minute = minuteFromDrag(event);
                onReschedule(dragging, { id: column.id, label: column.label, subtitle: column.subtitle, day: column.day, time: minuteLabel(minute) });
                finishDrag();
              }}
              className={`relative border-r border-slate-200 ${column.day === today ? 'bg-indigo-50/20' : 'bg-white'}`}
              style={{
                height: gridHeight,
                backgroundImage: `linear-gradient(to bottom, rgba(148,163,184,.30) 1px, transparent 1px), linear-gradient(to bottom, rgba(226,232,240,.70) 1px, transparent 1px)`,
                backgroundSize: `100% ${hourHeight}px, 100% ${hourHeight / 2}px`,
              }}
            >
              {showNow && <div aria-label="Current time" className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-rose-500" style={{ top: (nowMinute - visibleRange.startMinute) * pixelsPerMinute }}><span className="absolute -left-1 -top-1.5 h-3 w-3 rounded-full bg-rose-500" /></div>}

              {dropPreview?.key === column.key && dragging && <div className="pointer-events-none absolute inset-x-1 z-30 rounded-md border-2 border-dashed border-indigo-500 bg-indigo-100/80 px-2 py-1 text-[11px] font-black text-indigo-900 shadow-sm" style={{ top: (dropPreview.minute - visibleRange.startMinute) * pixelsPerMinute, height: Math.max(24, slotMinutes * pixelsPerMinute) }}>
                Move to {minuteLabel(dropPreview.minute)}
              </div>}

              {columnBookings.map(({ booking, start, end, lane, laneCount }) => {
                const clippedStart = clamp(start, visibleRange.startMinute, visibleRange.endMinute);
                const clippedEnd = clamp(end, visibleRange.startMinute + slotMinutes, visibleRange.endMinute);
                const top = (clippedStart - visibleRange.startMinute) * pixelsPerMinute + 2;
                const height = Math.max(28, (clippedEnd - clippedStart) * pixelsPerMinute - 4);
                const width = `calc(${100 / laneCount}% - 6px)`;
                const left = `calc(${(100 / laneCount) * lane}% + 3px)`;
                return <div key={booking.id} className={`absolute z-10 ${dragging?.id === booking.id ? 'opacity-40' : ''}`} style={{ top, height, width, left }}>
                  <BookingCard
                    booking={booking}
                    density={density}
                    onOpen={onOpen}
                    timeGrid
                    draggable={!['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(booking.status) && canDrop}
                    onDragStart={beginDrag}
                    onDragEnd={finishDrag}
                  />
                </div>;
              })}
            </div>;
          })}
        </div>
      </div>
    </div>

    <footer className="flex flex-col justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 sm:flex-row sm:items-center">
      <p><strong className="text-slate-800">Drag to reschedule:</strong> move a booking onto a day, team member and time. Drop positions snap to 15-minute intervals.</p>
      <button type="button" onClick={onCreate} className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 font-black text-slate-800 hover:border-indigo-300 hover:text-indigo-700">Create booking</button>
    </footer>
  </section>;
}
