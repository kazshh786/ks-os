import { addDays, addMonths, endOfDay, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import type { OperationalBookingStatus } from '@ks-os/contracts';

export type CalendarView = 'day' | 'week' | 'work-week' | 'month' | 'agenda' | 'staff' | 'location';

export const calendarViews: Array<{ value: CalendarView; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'work-week', label: 'Work week' },
  { value: 'month', label: 'Month' },
  { value: 'agenda', label: 'Agenda' },
  { value: 'staff', label: 'Staff schedule' },
  { value: 'location', label: 'Location schedule' },
];

export const bookingStatusDisplay: Record<OperationalBookingStatus, { label: string; className: string; symbol: string }> = {
  PENDING: { label: 'Pending', className: 'border-amber-300 bg-amber-50 text-amber-900', symbol: '◷' },
  CONFIRMED: { label: 'Confirmed', className: 'border-blue-300 bg-blue-50 text-blue-900', symbol: '✓' },
  CHECKED_IN: { label: 'Checked in', className: 'border-violet-300 bg-violet-50 text-violet-900', symbol: '●' },
  IN_SERVICE: { label: 'In progress', className: 'border-indigo-300 bg-indigo-50 text-indigo-900', symbol: '▶' },
  AWAITING_PAYMENT: { label: 'Awaiting payment', className: 'border-orange-300 bg-orange-50 text-orange-900', symbol: '£' },
  COMPLETED: { label: 'Completed', className: 'border-emerald-300 bg-emerald-50 text-emerald-900', symbol: '✓' },
  CANCELLED: { label: 'Cancelled', className: 'border-slate-300 bg-slate-100 text-slate-700', symbol: '×' },
  NO_SHOW: { label: 'No-show', className: 'border-rose-300 bg-rose-50 text-rose-900', symbol: '!' },
  BLOCKED: { label: 'Blocked', className: 'border-slate-400 bg-slate-200 text-slate-900', symbol: '■' },
};

export function calendarRange(anchor: Date, view: CalendarView) {
  if (view === 'day') return { from: startOfDay(anchor), to: endOfDay(anchor) };
  if (view === 'month') return { from: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }), to: endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }) };
  if (view === 'agenda') return { from: startOfDay(anchor), to: endOfDay(addDays(anchor, 30)) };
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  if (view === 'work-week') return { from: weekStart, to: endOfDay(addDays(weekStart, 4)) };
  return { from: weekStart, to: endOfWeek(anchor, { weekStartsOn: 1 }) };
}
export function moveCalendarAnchor(anchor: Date, view: CalendarView, direction: -1 | 1) {
  if (view === 'month') return addMonths(anchor, direction);
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'agenda') return addDays(anchor, direction * 30);
  return addDays(anchor, direction * 7);
}

export function rangeLabel(from: Date, to: Date) {
  return format(from, 'd MMM yyyy') === format(to, 'd MMM yyyy')
    ? format(from, 'EEEE, d MMMM yyyy')
    : `${format(from, 'd MMM')} – ${format(to, 'd MMM yyyy')}`;
}

export function localDayKey(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function localTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
