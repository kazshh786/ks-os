import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { eachDayOfInterval, format } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import {
  AlertTriangle, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Copy, Download,
  ExternalLink, Filter, MoreHorizontal, Plus, RefreshCw, Search, Settings2, SlidersHorizontal, X,
} from 'lucide-react';
import type { BookingOperationsItem, BookingOperationsQuery, BookingOperationsResponse, OperationalBookingStatus } from '@ks-os/contracts';
import type { Service, Staff } from '../../data/types.js';
import { getDataProvider } from '../../data/data-provider.js';
import { fetchWithAuth } from '../../api/client.js';
import { useWorkspace } from '../../context/WorkspaceContext.js';
import { BookingAgendaView } from './BookingAgendaView.js';
import { BookingMonthView } from './BookingMonthView.js';
import { BookingQuickView, type ProposedBookingReschedule } from './BookingQuickView.js';
import { BookingScheduleView, type ScheduleDropTarget } from './BookingScheduleView.js';
import { BookingStatusBadge } from './BookingStatusBadge.js';
import { CalendarCreateMenuDialog, type CalendarCreateType } from './CalendarCreateMenuDialog.js';
import { CreateBookingDialog } from './CreateBookingDialog.js';
import { BlockTimeDialog } from './BlockTimeDialog.js';
import { bookingStatusDisplay, calendarRange, calendarViews, type CalendarView, localDayKey, moveCalendarAnchor, rangeLabel } from './booking-display.js';

interface BookingOperationsCalendarProps {
  initialView?: CalendarView;
  tenantOverride?: import('../../data/types.js').BusinessTenant | null;
}

const emptyResponse: BookingOperationsResponse = {
  items: [],
  meta: { page: 1, limit: 250, total: 0, hasMore: false },
  summary: { total: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0, awaitingPayment: 0, incompleteForms: 0, requiresAttention: 0 },
};
const validViews = new Set(calendarViews.map(view => view.value));
type BookingDensity = 'compact' | 'comfortable' | 'detailed';
type IntakeStatus = NonNullable<BookingOperationsQuery['intakeStatuses']>[number];
const validDensities = new Set<BookingDensity>(['compact', 'comfortable', 'detailed']);
const validIntakeStatuses = new Set<IntakeStatus>(['NOT_REQUIRED', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE']);
const primaryCalendarViews: Array<{ value: Extract<CalendarView, 'month' | 'week' | 'day'>; label: string }> = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];
const advancedFilterKeys = ['staff', 'service', 'location', 'status', 'payment', 'intake', 'attention'] as const;

export function BookingOperationsCalendar({ initialView = 'week', tenantOverride = null }: BookingOperationsCalendarProps) {
  const { activeTenant: workspaceTenant } = useWorkspace();
  const activeTenant = tenantOverride || workspaceTenant;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const storedView = typeof window !== 'undefined' ? window.sessionStorage.getItem('ks-calendar-view') : null;
  const paramView = params.get('view');
  const view = (validViews.has(paramView as CalendarView) ? paramView : validViews.has(storedView as CalendarView) ? storedView : initialView) as CalendarView;
  const dateValue = params.get('date') || new Intl.DateTimeFormat('en-CA', {
    timeZone: activeTenant?.timezone || 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const anchor = new Date(`${dateValue}T12:00:00`);
  const range = useMemo(() => calendarRange(anchor, view), [dateValue, view]);
  const [response, setResponse] = useState(emptyResponse);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<BookingOperationsItem | null>(null);
  const [pendingReschedule, setPendingReschedule] = useState<ProposedBookingReschedule | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(params.get('create') === '1');
  const [createOpen, setCreateOpen] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(params.get('walkin') === '1');
  const [blockOpen, setBlockOpen] = useState(params.get('block') === '1');
  const [filtersOpen, setFiltersOpen] = useState(() => advancedFilterKeys.some(key => params.has(key)));
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [searchValue, setSearchValue] = useState(params.get('search') || '');
  const [density, setDensity] = useState<BookingDensity>(() => {
    const stored = typeof window === 'undefined' ? null : window.sessionStorage.getItem('ks-calendar-density') as BookingDensity | null;
    return stored && validDensities.has(stored) ? stored : 'comfortable';
  });

  const statusFilter = params.get('status') as OperationalBookingStatus | null;
  const intakeFilter = params.get('intake') as IntakeStatus | null;

  const query = useMemo<BookingOperationsQuery>(() => ({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    page: 1,
    limit: 250,
    sort: 'START_ASC',
    search: params.get('search') || undefined,
    staffIds: params.get('staff') ? [params.get('staff')!] : undefined,
    serviceIds: params.get('service') ? [params.get('service')!] : undefined,
    locationIds: params.get('location') ? [params.get('location')!] : undefined,
    statuses: statusFilter && statusFilter in bookingStatusDisplay ? [statusFilter] : undefined,
    paymentStatuses: params.get('payment') ? [params.get('payment')!] : undefined,
    intakeStatuses: intakeFilter && validIntakeStatuses.has(intakeFilter) ? [intakeFilter] : undefined,
    requiresAttention: params.get('attention') === 'true' || undefined,
  }), [intakeFilter, params, range.from, range.to, statusFilter]);

  const load = useCallback(async (silent = false) => {
    if (!activeTenant) return;
    if (!silent) setLoading(true);
    setError('');
    try { setResponse(await getDataProvider().getBookingOperations(query)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The calendar could not be loaded.'); }
    finally { if (!silent) setLoading(false); }
  }, [activeTenant, query]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!activeTenant) return;
    let active = true;
    Promise.all([getDataProvider().getServices(activeTenant.id), getDataProvider().getStaff(activeTenant.id)])
      .then(([serviceRows, staffRows]) => { if (active) { setServices(serviceRows); setStaff(staffRows); } })
      .catch(() => undefined);
    return () => { active = false; };
  }, [activeTenant]);
  useEffect(() => {
    const refresh = () => void load(true);
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('ks-bookings-updated', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('ks-bookings-updated', refresh); };
  }, [load]);

  if (!activeTenant) return null;

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  };
  const changeView = (nextView: CalendarView) => {
    window.sessionStorage.setItem('ks-calendar-view', nextView);
    updateParams({ view: nextView });
    setViewMenuOpen(false);
  };
  const changeDensity = (nextDensity: BookingDensity) => {
    window.sessionStorage.setItem('ks-calendar-density', nextDensity);
    setDensity(nextDensity);
  };
  const openBooking = (booking: BookingOperationsItem) => {
    setPendingReschedule(null);
    setSelected(booking);
  };
  const setAnchor = (next: Date) => updateParams({ date: format(next, 'yyyy-MM-dd') });
  const clearAdvancedFilters = () => {
    const next = new URLSearchParams(params);
    advancedFilterKeys.forEach(key => next.delete(key));
    setParams(next, { replace: true });
  };
  const chooseCreateType = (type: CalendarCreateType) => {
    setCreateMenuOpen(false);
    if (params.has('create')) updateParams({ create: null });
    if (type === 'booking') setCreateOpen(true);
    if (type === 'walk-in') setWalkInOpen(true);
    if (type === 'block') setBlockOpen(true);
  };
  const filterCount = advancedFilterKeys.filter(key => params.has(key)).length;
  const locations = Array.from(new Map(response.items.filter(item => item.location.id).map(item => [item.location.id!, item.location.name || 'Location'])).entries())
    .map(([id, name]) => ({ id, name }));
  const days = eachDayOfInterval({ start: range.from, end: range.to }).map(day => ({
    id: format(day, 'yyyy-MM-dd'), label: format(day, 'EEE d'), subtitle: format(day, 'MMMM'),
  }));
  const columns = view === 'staff' ? staff.map(member => ({ id: member.id, label: member.name, subtitle: member.role }))
    : view === 'location' ? [...locations.map(location => ({ id: location.id, label: location.name })), { id: 'unassigned', label: 'No location' }]
      : days;
  const groupBy = view === 'staff' ? 'staff' : view === 'location' ? 'location' : 'day';
  const currentViewLabel = calendarViews.find(option => option.value === view)?.label || 'Week';
  const summaryItems = [
    ['Bookings', response.summary.total],
    ['Confirmed', response.summary.confirmed],
    ['Completed', response.summary.completed],
    ['Cancelled', response.summary.cancelled],
    ['No-shows', response.summary.noShow],
    ['Awaiting payment', response.summary.awaitingPayment],
    ['Forms incomplete', response.summary.incompleteForms],
    ['Needs attention', response.summary.requiresAttention],
  ] as const;

  const publicPage = async (action: 'copy' | 'open') => {
    try {
      const page = await getDataProvider().getBookingPageSettings();
      if (action === 'copy') { await navigator.clipboard.writeText(page.publicUrl); setNotice('Booking link copied.'); }
      else window.open(page.publicUrl, '_blank', 'noopener,noreferrer');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Booking page unavailable.'); }
    setActionsOpen(false);
  };

  const exportCsv = async () => {
    const exportParams = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) exportParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    const exportResponse = await fetchWithAuth(`/api/v1/bookings/export.csv?${exportParams}`);
    if (!exportResponse.ok) { setNotice('The booking export could not be created.'); return; }
    const url = URL.createObjectURL(await exportResponse.blob());
    const anchorElement = document.createElement('a');
    anchorElement.href = url;
    anchorElement.download = `bookings-${dateValue}.csv`;
    anchorElement.click();
    URL.revokeObjectURL(url);
    setActionsOpen(false);
  };

  const dragReschedule = (booking: BookingOperationsItem, target: ScheduleDropTarget) => {
    if (booking.status === 'BLOCKED') return;
    const currentDay = localDayKey(booking.startTime, booking.timezone);
    const currentTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: booking.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(booking.startTime));
    const targetStaffId = view === 'staff' ? target.id : booking.staff.id;
    const targetDay = target.day;
    const targetTime = target.time;
    if (targetStaffId === booking.staff.id && targetDay === currentDay && targetTime === currentTime) return;
    setPendingReschedule({
      startTime: fromZonedTime(`${targetDay}T${targetTime}:00`, booking.timezone).toISOString(),
      staffId: targetStaffId,
      targetLabel: `${target.label} at ${targetTime}`,
    });
    setSelected(booking);
  };

  return <main className="relative flex min-h-full flex-col bg-slate-50 pb-24" aria-busy={loading}>
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-3 py-3 shadow-sm backdrop-blur sm:px-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="min-w-0 xl:w-64">
            <h1 className="text-xl font-black text-slate-950">Booking calendar</h1>
            <p className="truncate text-sm text-slate-500">{rangeLabel(range.from, range.to)} · {activeTenant.timezone}</p>
          </div>

          <form onSubmit={event => { event.preventDefault(); updateParams({ search: searchValue || null }); }} className="flex min-w-0 flex-1 items-center rounded-xl border border-slate-300 bg-slate-50 focus-within:border-indigo-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-100">
            <Search className="ml-3 h-4 w-4 shrink-0 text-slate-400" />
            <label className="min-w-0 flex-1">
              <span className="sr-only">Search bookings</span>
              <input value={searchValue} onChange={event => setSearchValue(event.target.value)} placeholder="Search customer, email, phone or booking reference" className="min-h-11 w-full border-0 bg-transparent px-3 text-sm outline-none" />
            </label>
            {searchValue && <button type="button" onClick={() => { setSearchValue(''); updateParams({ search: null }); }} aria-label="Clear booking search" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>}
            <button type="submit" className="m-1 min-h-9 rounded-lg bg-slate-900 px-4 text-xs font-black text-white">Search</button>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setFiltersOpen(value => !value)} aria-expanded={filtersOpen} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-black ${filtersOpen || filterCount ? 'border-indigo-200 bg-indigo-50 text-indigo-800' : 'border-slate-300 bg-white text-slate-800'}`}>
              <Filter className="h-4 w-4" />Filters
              {filterCount > 0 && <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] text-white">{filterCount}</span>}
            </button>

            <div className="relative">
              <button type="button" onClick={() => { setViewMenuOpen(value => !value); setActionsOpen(false); }} aria-expanded={viewMenuOpen} aria-label="Change calendar view" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-800">
                <CalendarDays className="h-4 w-4" />{currentViewLabel}<ChevronDown className="h-4 w-4" />
              </button>
              {viewMenuOpen && <div className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                <p className="px-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Calendar view</p>
                <div role="group" aria-label="Calendar date views" className="mt-2 grid grid-cols-3 gap-2">
                  {primaryCalendarViews.map(option => <button key={option.value} type="button" aria-pressed={view === option.value} onClick={() => changeView(option.value)} className={`rounded-xl border px-3 py-3 text-sm font-black ${view === option.value ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 hover:border-indigo-200 hover:bg-slate-50'}`}>{option.label}</button>)}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {calendarViews.filter(option => !primaryCalendarViews.some(primary => primary.value === option.value)).map(option => <button key={option.value} type="button" aria-pressed={view === option.value} onClick={() => changeView(option.value)} className={`rounded-xl px-3 py-2 text-left text-xs font-bold ${view === option.value ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}`}>{option.label}</button>)}
                </div>
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <p className="px-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Display density</p>
                  <div className="mt-2 flex gap-2">{(['compact', 'comfortable', 'detailed'] as const).map(option => <button key={option} type="button" aria-pressed={density === option} onClick={() => changeDensity(option)} className={`flex-1 rounded-lg px-2 py-2 text-xs font-bold capitalize ${density === option ? 'bg-indigo-50 text-indigo-800' : 'bg-slate-50 text-slate-600'}`}>{option}</button>)}</div>
                </div>
                <Link to={view === 'agenda' ? '/app/calendar' : '/app/bookings'} onClick={() => setViewMenuOpen(false)} className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold hover:bg-slate-50"><CalendarDays className="h-4 w-4" />{view === 'agenda' ? 'Return to calendar' : 'Open list view'}</Link>
              </div>}
            </div>

            <button type="button" onClick={() => setCreateMenuOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white shadow-sm hover:bg-indigo-700"><Plus className="h-4 w-4" />New booking</button>

            <div className="relative">
              <button type="button" onClick={() => { setActionsOpen(value => !value); setViewMenuOpen(false); }} aria-expanded={actionsOpen} aria-label="More calendar actions" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700"><MoreHorizontal className="h-5 w-5" /></button>
              {actionsOpen && <div className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                <button type="button" onClick={() => void publicPage('open')} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold hover:bg-slate-50"><ExternalLink className="h-4 w-4" />Open booking page</button>
                <button type="button" onClick={() => void publicPage('copy')} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold hover:bg-slate-50"><Copy className="h-4 w-4" />Copy booking link</button>
                <Link to="/app/settings/booking-page" onClick={() => setActionsOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold hover:bg-slate-50"><Settings2 className="h-4 w-4" />Booking page settings</Link>
                <button type="button" onClick={() => void exportCsv()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold hover:bg-slate-50"><Download className="h-4 w-4" />Export calendar</button>
              </div>}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 pt-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => setAnchor(moveCalendarAnchor(anchor, view, -1))} aria-label="Previous calendar period" className="rounded-lg border border-slate-300 bg-white p-2"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => setAnchor(new Date())} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black">Today</button>
            <button onClick={() => setAnchor(moveCalendarAnchor(anchor, view, 1))} aria-label="Next calendar period" className="rounded-lg border border-slate-300 bg-white p-2"><ChevronRight className="h-4 w-4" /></button>
            <label className="ml-1 flex min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5"><span className="sr-only">Calendar date</span><input type="date" aria-label="Calendar date" value={dateValue} onChange={event => updateParams({ date: event.target.value })} className="block min-w-0 border-0 bg-transparent p-0 text-xs font-bold" /></label>
          </div>
          <button onClick={() => void load()} className="inline-flex items-center gap-2 self-start rounded-lg px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 lg:self-auto"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
        </div>

        {filtersOpen && <section aria-label="Booking filters" className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <select aria-label="Filter by staff" value={params.get('staff') || ''} onChange={event => updateParams({ staff: event.target.value || null })} className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"><option value="">All staff</option>{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
            <select aria-label="Filter by service" value={params.get('service') || ''} onChange={event => updateParams({ service: event.target.value || null })} className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"><option value="">All services</option>{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
            <select aria-label="Filter by location" value={params.get('location') || ''} onChange={event => updateParams({ location: event.target.value || null })} className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"><option value="">All locations</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select>
            <select aria-label="Filter by booking status" value={params.get('status') || ''} onChange={event => updateParams({ status: event.target.value || null })} className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"><option value="">All statuses</option>{Object.entries(bookingStatusDisplay).map(([status, display]) => <option key={status} value={status}>{display.label}</option>)}</select>
            <select aria-label="Filter by payment status" value={params.get('payment') || ''} onChange={event => updateParams({ payment: event.target.value || null })} className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"><option value="">All payments</option><option value="NOT_REQUIRED">Not required</option><option value="PENDING">Pending</option><option value="PARTIALLY_PAID">Partially paid</option><option value="COMPLETED">Paid</option><option value="FAILED">Failed</option></select>
            <select aria-label="Filter by intake status" value={params.get('intake') || ''} onChange={event => updateParams({ intake: event.target.value || null })} className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"><option value="">All form statuses</option><option value="NOT_REQUIRED">Not required</option><option value="PENDING">Pending</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option><option value="OVERDUE">Overdue</option></select>
            <button type="button" onClick={() => updateParams({ attention: params.get('attention') === 'true' ? null : 'true' })} aria-pressed={params.get('attention') === 'true'} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-bold ${params.get('attention') === 'true' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-300 bg-white text-slate-700'}`}><AlertTriangle className="h-4 w-4" />Requires attention</button>
            <button type="button" onClick={clearAdvancedFilters} disabled={filterCount === 0} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-indigo-700 disabled:text-slate-400"><SlidersHorizontal className="h-4 w-4" />Clear filters</button>
          </div>
        </section>}
      </div>
    </header>

    <div className="space-y-3 px-3 pt-3 sm:px-4">
      {notice && <p role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm font-semibold text-indigo-900">{notice}</p>}
      {error && <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"><span><strong>Bookings could not be refreshed.</strong> The calendar remains available with {response.items.length ? 'the last loaded schedule' : 'an empty schedule'}. <span className="text-amber-800">{error}</span></span><button onClick={() => void load()} className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white">Try again</button></div>}
      {loading && <p role="status" className="sr-only">Refreshing booking calendar</p>}

      <section aria-label="Calendar workspace">
        {view === 'agenda'
          ? <BookingAgendaView bookings={response.items} onOpen={openBooking} />
          : view === 'month'
            ? <BookingMonthView from={range.from} to={range.to} bookings={response.items} timezone={activeTenant.timezone} onOpen={openBooking} onSelectDay={day => { window.sessionStorage.setItem('ks-calendar-view', 'day'); updateParams({ date: format(day, 'yyyy-MM-dd'), view: 'day' }); }} />
            : <BookingScheduleView
              columns={columns}
              days={days}
              bookings={response.items}
              groupBy={groupBy}
              density={density}
              timezone={activeTenant.timezone}
              selectedDay={dateValue}
              onSelectDay={day => updateParams({ date: day })}
              onOpen={openBooking}
              onCreate={() => setCreateMenuOpen(true)}
              onReschedule={dragReschedule}
            />}
      </section>
    </div>

    <footer className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-3 py-2 shadow-[0_-8px_24px_rgba(15,23,42,0.10)] backdrop-blur lg:left-[var(--workspace-sidebar-width)]" data-anchored="viewport-bottom">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <section aria-label="Calendar summary" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {summaryItems.map(([label, value]) => <article key={label} className="flex items-baseline gap-1.5"><span className="text-base font-black text-slate-950">{value}</span><span className="text-[9px] font-black uppercase tracking-wide text-slate-500">{label}</span></article>)}
        </section>
        <section aria-label="Calendar legend" className="flex flex-wrap gap-1.5">{Object.entries(bookingStatusDisplay).map(([status]) => <BookingStatusBadge key={status} status={status as OperationalBookingStatus} compact />)}</section>
      </div>
    </footer>

    <CalendarCreateMenuDialog
      open={createMenuOpen}
      onClose={() => { setCreateMenuOpen(false); if (params.has('create')) updateParams({ create: null }); }}
      onChoose={chooseCreateType}
    />
    <CreateBookingDialog open={createOpen} timezone={activeTenant.timezone} services={services} staff={staff} initialDate={dateValue} onClose={() => setCreateOpen(false)} onCreated={() => { window.dispatchEvent(new CustomEvent('ks-bookings-updated')); void load(); }} />
    <CreateBookingDialog mode="walk-in" open={walkInOpen} timezone={activeTenant.timezone} services={services} staff={staff} initialDate={dateValue} onClose={() => { setWalkInOpen(false); if (params.has('walkin')) updateParams({ walkin: null }); }} onCreated={() => { setNotice('Walk-in checked in and added to the calendar.'); window.dispatchEvent(new CustomEvent('ks-bookings-updated')); void load(); }} />
    <BlockTimeDialog open={blockOpen} timezone={activeTenant.timezone} staff={staff} initialDate={dateValue} onClose={() => { setBlockOpen(false); if (params.has('block')) updateParams({ block: null }); }} onCreated={() => { setNotice('Time blocked successfully.'); window.dispatchEvent(new CustomEvent('ks-bookings-updated')); void load(); }} />
    <BookingQuickView
      booking={selected}
      staff={staff}
      initialReschedule={pendingReschedule}
      onClose={() => { setSelected(null); setPendingReschedule(null); }}
      onChanged={() => { window.dispatchEvent(new CustomEvent('ks-bookings-updated')); void load(); }}
      onCheckout={booking => navigate('/app/pos', { state: { booking } })}
    />
  </main>;
}
