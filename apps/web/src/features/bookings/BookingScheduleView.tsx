import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { BookingOperationsItem } from '@ks-os/contracts';
import { fetchWithAuth } from '../../api/client.js';
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
  selectedDay?: string;
  onSelectDay?: (day: string) => void;
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

type BookingChannel = 'in_shop' | 'mobile';
type AvailabilitySource = 'weekly' | 'override';
type TeamScheduleRow = { dayOfWeek: number; startTime: string; endTime: string };
type TeamChannelScheduleRow = TeamScheduleRow & { bookingChannel: BookingChannel };
type TeamOverride = {
  date: string;
  channel: BookingChannel;
  enabled: boolean;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
};
type AvailabilityMember = {
  id: string;
  name: string;
  role: string;
  schedule: TeamScheduleRow[];
  bookingChannels: TeamChannelScheduleRow[];
  bookingOverrides: TeamOverride[];
};
type AvailabilityWindow = {
  channel: BookingChannel;
  startMinute: number;
  endMinute: number;
  source: AvailabilitySource;
  notes: string[];
};
type ColumnAvailability = {
  windows: AvailabilityWindow[];
  overrides: TeamOverride[];
  memberCount: number;
};

const slotMinutes = 15;
const dayStartMinute = 0;
const dayEndMinute = 24 * 60;
const hourHeightByDensity = { compact: 42, comfortable: 54, detailed: 68 } as const;

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

function scheduleMinute(value: string | null | undefined) {
  if (!value) return null;
  const [hour, minute] = value.slice(0, 5).split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
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

function mergeAvailabilityWindows(windows: AvailabilityWindow[]) {
  const merged: AvailabilityWindow[] = [];
  for (const channel of ['in_shop', 'mobile'] as const) {
    const channelWindows = windows.filter(window => window.channel === channel)
      .sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
    for (const window of channelWindows) {
      const previous = merged.at(-1);
      if (previous?.channel === channel && window.startMinute <= previous.endMinute) {
        previous.endMinute = Math.max(previous.endMinute, window.endMinute);
        if (window.source === 'override') previous.source = 'override';
        previous.notes = Array.from(new Set([...previous.notes, ...window.notes]));
      } else {
        merged.push({ ...window, notes: [...window.notes] });
      }
    }
  }
  return merged.sort((left, right) => left.startMinute - right.startMinute || left.channel.localeCompare(right.channel));
}

function memberAvailability(member: AvailabilityMember, date: string) {
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
  const windows: AvailabilityWindow[] = [];
  const overrides: TeamOverride[] = [];

  for (const channel of ['in_shop', 'mobile'] as const) {
    const override = member.bookingOverrides.find(item => item.date === date && item.channel === channel);
    if (override) {
      overrides.push(override);
      const startMinute = scheduleMinute(override.startTime);
      const endMinute = scheduleMinute(override.endTime);
      if (override.enabled && startMinute !== null && endMinute !== null && endMinute > startMinute) {
        windows.push({
          channel,
          startMinute,
          endMinute,
          source: 'override',
          notes: override.note ? [override.note] : [],
        });
      }
      continue;
    }

    const channelRows = member.bookingChannels.filter(item => item.bookingChannel === channel);
    const rows = channelRows.length ? channelRows : channel === 'in_shop' ? member.schedule : [];
    const row = rows.find(item => item.dayOfWeek === dayOfWeek);
    const startMinute = scheduleMinute(row?.startTime);
    const endMinute = scheduleMinute(row?.endTime);
    if (row && startMinute !== null && endMinute !== null && endMinute > startMinute) {
      windows.push({ channel, startMinute, endMinute, source: 'weekly', notes: [] });
    }
  }

  return { windows, overrides };
}

function channelName(channel: BookingChannel, compact = false) {
  if (channel === 'mobile') return compact ? 'Mobile' : 'Mobile availability';
  return compact ? 'Shop' : 'At-business availability';
}

export function BookingScheduleView({
  columns, days, bookings, groupBy, density, timezone, selectedDay, onSelectDay, onOpen, onCreate, onReschedule,
}: BookingScheduleViewProps) {
  const [dragging, setDragging] = useState<BookingOperationsItem | null>(null);
  const [dropPreview, setDropPreview] = useState<{ key: string; minute: number } | null>(null);
  const [availabilityMembers, setAvailabilityMembers] = useState<AvailabilityMember[]>([]);
  const [mobileColumnKey, setMobileColumnKey] = useState('');
  const focusAnchor = useRef<HTMLDivElement>(null);
  const hourHeight = hourHeightByDensity[density];
  const pixelsPerMinute = hourHeight / 60;
  const visibleRange = { startMinute: dayStartMinute, endMinute: dayEndMinute };

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

  const loadAvailability = useCallback(async () => {
    try {
      const listResponse = await fetchWithAuth('/api/v1/team');
      if (!listResponse.ok) throw new Error('Availability is not accessible for this role.');
      const listBody = await listResponse.json();
      const activeMembers = (listBody.data?.members || []).filter((member: { accountStatus: string }) => member.accountStatus === 'ACTIVE');
      const details = await Promise.all(activeMembers.map(async (summary: { userId: string }) => {
        const response = await fetchWithAuth(`/api/v1/team/${summary.userId}`);
        if (!response.ok) return null;
        const body = await response.json();
        return body.data as AvailabilityMember;
      }));
      setAvailabilityMembers(details.filter((member): member is AvailabilityMember => Boolean(member)));
    } catch {
      setAvailabilityMembers([]);
    }
  }, []);

  useEffect(() => {
    void loadAvailability();
    window.addEventListener('ks-availability-updated', loadAvailability);
    return () => window.removeEventListener('ks-availability-updated', loadAvailability);
  }, [loadAvailability]);

  const availabilityForColumn = useCallback((column: RenderColumn): ColumnAvailability => {
    const relevantMembers = groupBy === 'staff'
      ? availabilityMembers.filter(member => member.name === column.resourceLabel)
      : availabilityMembers;
    const resolved = relevantMembers.map(member => memberAvailability(member, column.day));
    return {
      windows: mergeAvailabilityWindows(resolved.flatMap(item => item.windows)),
      overrides: resolved.flatMap(item => item.overrides),
      memberCount: relevantMembers.length,
    };
  }, [availabilityMembers, groupBy]);

  const selectedFocusMinute = useMemo(() => {
    const starts = renderColumns
      .filter(column => !selectedDay || column.day === selectedDay)
      .flatMap(column => availabilityForColumn(column).windows.map(window => window.startMinute));
    return starts.length ? Math.min(...starts) : 9 * 60;
  }, [availabilityForColumn, renderColumns, selectedDay]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const anchor = focusAnchor.current;
      const scroller = anchor?.closest('#main-content') as HTMLElement | null;
      if (!anchor || !scroller || typeof scroller.scrollTo !== 'function') return;
      const delta = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + delta - 112), behavior: 'auto' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [groupBy, selectedDay, selectedFocusMinute]);

  const bookingsForColumn = (column: RenderColumn) => bookings.filter(booking => {
    if (localDayKey(booking.startTime, timezone) !== column.day) return false;
    if (groupBy === 'staff') return booking.staff.id === column.id;
    if (groupBy === 'location') return (booking.location.id || 'unassigned') === column.id;
    return true;
  });

  useEffect(() => {
    if (renderColumns.some(column => column.key === mobileColumnKey)) return;
    setMobileColumnKey(renderColumns.find(column => column.day === selectedDay)?.key || renderColumns[0]?.key || '');
  }, [mobileColumnKey, renderColumns, selectedDay]);

  const mobileColumn = renderColumns.find(column => column.key === mobileColumnKey) || renderColumns[0];

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
  const focusTop = (selectedFocusMinute - visibleRange.startMinute) * pixelsPerMinute;

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

  return <>
    <section aria-label="Mobile booking schedule" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:hidden">
      {renderColumns.length > 0 ? <>
        <label className="block border-b bg-slate-50 p-3 text-xs font-black uppercase tracking-wide text-slate-500">Schedule column
          <select aria-label="Choose schedule column" value={mobileColumn?.key || ''} onChange={event => {
            const next = renderColumns.find(column => column.key === event.target.value);
            setMobileColumnKey(event.target.value);
            if (next) onSelectDay?.(next.day);
          }} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-bold normal-case text-slate-900">
            {renderColumns.map(column => <option key={column.key} value={column.key}>{column.label}{column.subtitle ? ` · ${column.subtitle}` : ''}</option>)}
          </select>
        </label>
        {mobileColumn && <section aria-labelledby={`mobile-column-${mobileColumn.key}`}>
          <header className="border-b bg-white p-4"><h3 id={`mobile-column-${mobileColumn.key}`} className="break-words text-base font-black text-slate-900">{mobileColumn.label}</h3>{mobileColumn.subtitle && <p className="break-words text-sm text-slate-500">{mobileColumn.subtitle}</p>}</header>
          <div className="space-y-3 p-3">{bookingsForColumn(mobileColumn).map(booking => <BookingCard key={booking.id} booking={booking} density={density} onOpen={onOpen} />)}{bookingsForColumn(mobileColumn).length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center"><p className="text-sm font-semibold text-slate-500">No bookings in this column.</p><button type="button" onClick={onCreate} className="mt-3 min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white">Create booking</button></div>}</div>
        </section>}
      </> : <div className="p-8 text-center text-sm text-slate-500">No schedule columns are available.</div>}
    </section>

    <section aria-label="Booking schedule" className="hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
    <div className="overflow-x-auto">
      <div className="min-w-max" style={{ minWidth: `calc(64px + ${Math.max(1, renderColumns.length)} * ${minimumColumnWidth}px)` }}>
        <div className="sticky top-0 z-40 grid border-b border-slate-200 bg-white shadow-[0_8px_18px_rgba(15,23,42,0.08)]" style={{ gridTemplateColumns: templateColumns }}>
          <div className="sticky left-0 z-50 flex min-h-16 items-end justify-end border-r border-slate-200 bg-white px-2 pb-2 text-[10px] font-black uppercase tracking-wide text-slate-400">{timezone.split('/').pop()?.replaceAll('_', ' ')}</div>
          {renderColumns.map(column => {
            const isToday = column.day === today;
            const isSelected = column.day === selectedDay;
            const availability = availabilityForColumn(column);
            const enabledOverrides = availability.overrides.filter(item => item.enabled);
            const offOverrides = availability.overrides.filter(item => !item.enabled);
            const availabilitySummary = availability.windows
              .map(window => `${channelName(window.channel, true)} ${minuteLabel(window.startMinute)}–${minuteLabel(window.endMinute)}`)
              .join(' · ');
            const badges = groupBy === 'staff'
              ? availability.overrides.map(item => `${channelName(item.channel, true)} ${item.enabled ? 'custom' : 'off'}`)
              : [
                ...(enabledOverrides.length ? [`${enabledOverrides.length} override${enabledOverrides.length === 1 ? '' : 's'}`] : []),
                ...(offOverrides.length ? [`${offOverrides.length} off`] : []),
              ];
            return <header key={column.key} className={`min-h-16 border-r bg-white px-3 py-2 transition ${isSelected ? 'border-indigo-300 shadow-[inset_0_-3px_0_0_rgb(99_102_241)]' : 'border-slate-200'}`}>
              <button type="button" onClick={() => onSelectDay?.(column.day)} aria-pressed={isSelected} className="w-full text-left">
                <span className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-black uppercase tracking-wide ${isSelected || isToday ? 'text-indigo-700' : 'text-slate-600'}`}>{column.dayLabel}</span>
                  {isSelected && <span className="rounded-full border border-indigo-200 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-indigo-700">Selected</span>}
                </span>
                {column.resourceLabel
                  ? <><span className="mt-1 block truncate text-sm font-black text-slate-950">{column.resourceLabel}</span>{column.resourceSubtitle && <span className="block truncate text-[11px] text-slate-500">{column.resourceSubtitle}</span>}</>
                  : column.daySubtitle && <span className="block truncate text-[11px] text-slate-500">{column.daySubtitle}</span>}
                {availabilitySummary && <span className="mt-1 block truncate text-[10px] font-bold text-slate-600">{availabilitySummary}</span>}
                {badges.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{badges.slice(0, 3).map(label => <span key={label} className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${label.endsWith('off') || label.includes(' off') ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>{label}</span>)}</span>}
              </button>
            </header>;
          })}
        </div>

        <div className="grid" style={{ gridTemplateColumns: templateColumns }}>
          <aside className="sticky left-0 z-20 border-r border-slate-200 bg-white" style={{ height: gridHeight }} aria-label="Calendar times">
            <div ref={focusAnchor} aria-hidden="true" className="absolute inset-x-0 h-px" style={{ top: focusTop }} />
            {hourLabels.map(minute => <span key={minute} className="absolute right-2 -translate-y-1/2 font-mono text-[11px] font-bold text-slate-500" style={{ top: (minute - visibleRange.startMinute) * pixelsPerMinute }}>{minuteLabel(minute)}</span>)}
          </aside>

          {renderColumns.map(column => {
            const columnBookings = overlappingLayout(bookingsForColumn(column), timezone);
            const canDrop = groupBy !== 'location';
            const showNow = column.day === today && nowMinute >= visibleRange.startMinute && nowMinute <= visibleRange.endMinute;
            const isSelected = column.day === selectedDay;
            const availability = availabilityForColumn(column);
            const disabledOverrides = availability.overrides.filter(item => !item.enabled);
            const showDayOffReminder = disabledOverrides.length > 0 && availability.windows.length === 0;
            return <div
              key={column.key}
              role="gridcell"
              aria-label={`${column.label} time grid`}
              aria-selected={isSelected}
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
              className={`relative border-r bg-slate-100/70 ${isSelected ? 'border-indigo-300' : 'border-slate-200'}`}
              style={{
                height: gridHeight,
                backgroundImage: `linear-gradient(to bottom, rgba(148,163,184,.30) 1px, transparent 1px), linear-gradient(to bottom, rgba(226,232,240,.75) 1px, transparent 1px)`,
                backgroundSize: `100% ${hourHeight}px, 100% ${hourHeight / 2}px`,
              }}
            >
              <div aria-label={isSelected ? 'Selected day focused availability hours' : undefined} className="pointer-events-none absolute inset-0">
                {availability.windows.map((window, index) => {
                  const top = (window.startMinute - visibleRange.startMinute) * pixelsPerMinute;
                  const height = Math.max(4, (window.endMinute - window.startMinute) * pixelsPerMinute);
                  const isMobile = window.channel === 'mobile';
                  return <div
                    key={`${window.channel}-${window.startMinute}-${window.endMinute}-${index}`}
                    aria-label={`${channelName(window.channel)} ${minuteLabel(window.startMinute)} to ${minuteLabel(window.endMinute)}${window.source === 'override' ? ', date override' : ''}`}
                    title={window.notes.join(' · ') || undefined}
                    className={`absolute inset-x-0 overflow-hidden border-y ${isMobile ? 'border-dashed border-amber-400/90 bg-amber-100/75 text-amber-900' : 'border-indigo-200/90 bg-indigo-100/75 text-indigo-900'} ${window.source === 'override' ? 'ring-2 ring-inset ring-emerald-300/80' : ''}`}
                    style={{ top, height }}
                  >
                    {height >= 24 && <span className="sticky top-1 inline-flex rounded-r-md bg-white/85 px-2 py-1 text-[9px] font-black uppercase tracking-wide shadow-sm">{channelName(window.channel, true)} {minuteLabel(window.startMinute)}–{minuteLabel(window.endMinute)}{window.source === 'override' ? ' · Override' : ''}</span>}
                  </div>;
                })}
              </div>

              {showDayOffReminder && <div className="pointer-events-none absolute inset-x-3 top-6 z-[1] rounded-xl border border-rose-200 bg-white/90 p-3 text-center shadow-sm">
                <p className="text-xs font-black uppercase tracking-wide text-rose-800">Day off</p>
                <p className="mt-1 text-[10px] text-rose-700">{disabledOverrides.map(item => `${channelName(item.channel, true)}${item.note ? ` · ${item.note}` : ''}`).join(' · ')}</p>
              </div>}

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
      <p><strong className="text-slate-800">Availability:</strong> indigo shows at-business hours, amber shows mobile hours, and a green outline marks a date override. Drag bookings to reschedule in 15-minute intervals.</p>
      <button type="button" onClick={onCreate} className="min-h-11 shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 font-black text-slate-800 hover:border-indigo-300 hover:text-indigo-700">Add to calendar</button>
    </footer>
    </section>
  </>;
}
