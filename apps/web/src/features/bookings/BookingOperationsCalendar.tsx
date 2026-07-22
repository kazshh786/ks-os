import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { eachDayOfInterval, format } from 'date-fns';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Filter, MoreHorizontal, Plus, RefreshCw, Search, Settings2, Share2, SlidersHorizontal } from 'lucide-react';
import type { BookingOperationsItem, BookingOperationsQuery, BookingOperationsResponse, OperationalBookingStatus } from '@ks-os/contracts';
import type { Service, Staff } from '../../data/types.js';
import { getDataProvider } from '../../data/data-provider.js';
import { fetchWithAuth } from '../../api/client.js';
import { useWorkspace } from '../../context/WorkspaceContext.js';
import { BookingAgendaView } from './BookingAgendaView.js';
import { BookingMonthView } from './BookingMonthView.js';
import { BookingQuickView } from './BookingQuickView.js';
import { BookingScheduleView } from './BookingScheduleView.js';
import { BookingStatusBadge } from './BookingStatusBadge.js';
import { CreateBookingDialog } from './CreateBookingDialog.js';
import { bookingStatusDisplay, calendarRange, calendarViews, type CalendarView, moveCalendarAnchor, rangeLabel } from './booking-display.js';

interface BookingOperationsCalendarProps {
  initialView?: CalendarView;
}

const emptyResponse: BookingOperationsResponse = { items: [], meta: { page: 1, limit: 250, total: 0, hasMore: false }, summary: { total: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0, awaitingPayment: 0, incompleteForms: 0, requiresAttention: 0 } };
const validViews = new Set(calendarViews.map(view => view.value));
type BookingDensity = 'compact' | 'comfortable' | 'detailed';
type IntakeStatus = NonNullable<BookingOperationsQuery['intakeStatuses']>[number];
const validDensities = new Set<BookingDensity>(['compact', 'comfortable', 'detailed']);
const validIntakeStatuses = new Set<IntakeStatus>(['NOT_REQUIRED', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE']);

export function BookingOperationsCalendar({ initialView = 'week' }: BookingOperationsCalendarProps) {
  const { activeTenant } = useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const storedView = typeof window !== 'undefined' ? window.sessionStorage.getItem('ks-calendar-view') : null;
  const paramView = params.get('view');
  const view = (validViews.has(paramView as CalendarView) ? paramView : validViews.has(storedView as CalendarView) ? storedView : initialView) as CalendarView;
  const dateValue = params.get('date') || new Intl.DateTimeFormat('en-CA', { timeZone: activeTenant?.timezone || 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const anchor = new Date(`${dateValue}T12:00:00`);
  const range = useMemo(() => calendarRange(anchor, view), [dateValue, view]);
  const [response, setResponse] = useState(emptyResponse);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<BookingOperationsItem | null>(null);
  const [createOpen, setCreateOpen] = useState(params.get('create') === '1');
  const [publicMenu, setPublicMenu] = useState(false);
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
    Promise.all([getDataProvider().getServices(activeTenant.id), getDataProvider().getStaff(activeTenant.id)]).then(([serviceRows, staffRows]) => { if (active) { setServices(serviceRows); setStaff(staffRows); } }).catch(() => undefined);
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
  const changeView = (nextView: CalendarView) => { window.sessionStorage.setItem('ks-calendar-view', nextView); updateParams({ view: nextView }); };
  const changeDensity = (nextDensity: typeof density) => { window.sessionStorage.setItem('ks-calendar-density', nextDensity); setDensity(nextDensity); };
  const setAnchor = (next: Date) => updateParams({ date: format(next, 'yyyy-MM-dd') });
  const filterCount = ['search','staff','service','location','status','payment','intake','attention'].filter(key => params.has(key)).length;
  const locations = Array.from(new Map(response.items.filter(item => item.location.id).map(item => [item.location.id!, item.location.name || 'Location'])).entries()).map(([id, name]) => ({ id, name }));
  const days = eachDayOfInterval({ start: range.from, end: range.to }).map(day => ({ id: format(day, 'yyyy-MM-dd'), label: format(day, 'EEE d'), subtitle: format(day, 'MMMM') }));
  const columns = view === 'staff' ? staff.map(member => ({ id: member.id, label: member.name, subtitle: member.role }))
    : view === 'location' ? [...locations.map(location => ({ id: location.id, label: location.name })), { id: 'unassigned', label: 'No location' }]
      : days;
  const groupBy = view === 'staff' ? 'staff' : view === 'location' ? 'location' : 'day';

  const publicPage = async (action: 'copy' | 'open') => {
    try {
      const page = await getDataProvider().getBookingPageSettings();
      if (action === 'copy') { await navigator.clipboard.writeText(page.publicUrl); setNotice('Booking link copied.'); }
      else window.open(page.publicUrl, '_blank', 'noopener,noreferrer');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Booking page unavailable.'); }
    setPublicMenu(false);
  };

  const exportCsv = async () => {
    const exportParams = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) exportParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    const response = await fetchWithAuth(`/api/v1/bookings/export.csv?${exportParams}`);
    if (!response.ok) { setNotice('The booking export could not be created.'); return; }
    const url = URL.createObjectURL(await response.blob());
    const anchorElement = document.createElement('a'); anchorElement.href = url; anchorElement.download = `bookings-${dateValue}.csv`; anchorElement.click(); URL.revokeObjectURL(url);
  };

  return <main className="space-y-4" aria-busy={loading}>
    <header className="rounded-3xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">Booking operations</p><h1 className="mt-1 text-3xl font-black text-slate-950">Booking calendar</h1><p className="mt-1 text-sm text-slate-500">{rangeLabel(range.from, range.to)} · {activeTenant.timezone}</p></div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setCreateOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white shadow-sm"><Plus className="h-4 w-4" />Create booking</button>
          <div className="relative"><button onClick={() => setPublicMenu(value => !value)} aria-expanded={publicMenu} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black"><Share2 className="h-4 w-4" />Public booking page</button>{publicMenu && <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border bg-white p-2 shadow-xl"><button onClick={() => void publicPage('open')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50"><ExternalLink className="h-4 w-4" />Open booking page</button><button onClick={() => void publicPage('copy')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50"><Copy className="h-4 w-4" />Copy booking link</button><Link to="/app/settings/booking-page" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-50"><Settings2 className="h-4 w-4" />Page settings</Link></div>}</div>
          <button onClick={() => void exportCsv()} title="Export this filtered range as CSV" className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-bold"><Download className="h-4 w-4" />Export</button>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-3 border-t pt-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-1"><button onClick={() => setAnchor(moveCalendarAnchor(anchor, view, -1))} aria-label="Previous calendar period" className="rounded-lg border p-2"><ChevronLeft className="h-4 w-4" /></button><button onClick={() => setAnchor(new Date())} className="rounded-lg border px-3 py-2 text-xs font-black">Today</button><button onClick={() => setAnchor(moveCalendarAnchor(anchor, view, 1))} aria-label="Next calendar period" className="rounded-lg border p-2"><ChevronRight className="h-4 w-4" /></button><input type="date" aria-label="Calendar date" value={dateValue} onChange={event => updateParams({ date: event.target.value })} className="ml-1 rounded-lg border p-2 text-xs font-bold" /></div>
        <div className="flex flex-wrap items-center gap-2"><select aria-label="Calendar view" value={view} onChange={event => changeView(event.target.value as CalendarView)} className="min-h-10 rounded-lg border bg-white px-3 text-xs font-bold">{calendarViews.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><select aria-label="Display density" value={density} onChange={event => changeDensity(event.target.value as typeof density)} className="min-h-10 rounded-lg border bg-white px-3 text-xs font-bold"><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="detailed">Detailed</option></select><Link to={view === 'agenda' ? '/app/calendar' : '/app/bookings'} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold"><CalendarDays className="h-4 w-4" />{view === 'agenda' ? 'Calendar view' : 'List view'}</Link></div>
      </div>
      <form onSubmit={event => { event.preventDefault(); updateParams({ search: searchValue || null }); }} className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_repeat(6,minmax(120px,auto))]">
        <label className="relative"><span className="sr-only">Search bookings</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={searchValue} onChange={event => setSearchValue(event.target.value)} placeholder="Customer, email, phone, reference…" className="min-h-10 w-full rounded-lg border pl-9 pr-3 text-sm" /></label>
        <select aria-label="Filter by staff" value={params.get('staff') || ''} onChange={event => updateParams({ staff: event.target.value || null })} className="rounded-lg border bg-white px-2 text-xs font-bold"><option value="">All staff</option>{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
        <select aria-label="Filter by service" value={params.get('service') || ''} onChange={event => updateParams({ service: event.target.value || null })} className="rounded-lg border bg-white px-2 text-xs font-bold"><option value="">All services</option>{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
        <select aria-label="Filter by location" value={params.get('location') || ''} onChange={event => updateParams({ location: event.target.value || null })} className="rounded-lg border bg-white px-2 text-xs font-bold"><option value="">All locations</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select>
        <select aria-label="Filter by booking status" value={params.get('status') || ''} onChange={event => updateParams({ status: event.target.value || null })} className="rounded-lg border bg-white px-2 text-xs font-bold"><option value="">All statuses</option>{Object.entries(bookingStatusDisplay).map(([status, display]) => <option key={status} value={status}>{display.label}</option>)}</select>
        <select aria-label="Filter by payment status" value={params.get('payment') || ''} onChange={event => updateParams({ payment: event.target.value || null })} className="rounded-lg border bg-white px-2 text-xs font-bold"><option value="">All payments</option><option value="NOT_REQUIRED">Not required</option><option value="PENDING">Pending</option><option value="PARTIALLY_PAID">Partially paid</option><option value="COMPLETED">Paid</option><option value="FAILED">Failed</option></select>
        <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white"><Filter className="h-4 w-4" />Apply</button>
      </form>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><div className="flex items-center gap-2"><button onClick={() => updateParams({ attention: params.get('attention') === 'true' ? null : 'true' })} aria-pressed={params.get('attention') === 'true'} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 font-bold ${params.get('attention') === 'true' ? 'border-amber-300 bg-amber-50 text-amber-900' : ''}`}><AlertTriangle className="h-3.5 w-3.5" />Requires attention</button><span className="inline-flex items-center gap-1 text-slate-500"><SlidersHorizontal className="h-3.5 w-3.5" />{filterCount} active filters</span>{filterCount > 0 && <button onClick={() => { setSearchValue(''); setParams(new URLSearchParams({ view, date: dateValue }), { replace: true }); }} className="font-bold text-indigo-700">Clear all</button>}</div><button onClick={() => void load()} className="inline-flex items-center gap-1 font-bold text-slate-600"><RefreshCw className="h-3.5 w-3.5" />Refresh</button></div>
    </header>

    <section aria-label="Calendar summary" className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">{[
      ['Bookings', response.summary.total], ['Confirmed', response.summary.confirmed], ['Completed', response.summary.completed], ['Cancelled', response.summary.cancelled], ['No-shows', response.summary.noShow], ['Awaiting payment', response.summary.awaitingPayment], ['Forms incomplete', response.summary.incompleteForms], ['Needs attention', response.summary.requiresAttention],
    ].map(([label, value]) => <article key={String(label)} className="rounded-xl border bg-white p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></article>)}</section>

    {notice && <p role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm font-semibold text-indigo-900">{notice}</p>}
    {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-white p-8 text-center"><p className="font-black text-rose-800">Calendar failed to load</p><p className="mt-1 text-sm text-slate-600">{error}</p><button onClick={() => void load()} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">Try again</button></div>}
    {loading && !error ? <div aria-live="polite" className="h-96 animate-pulse rounded-2xl bg-slate-200"><span className="sr-only">Loading booking calendar</span></div> : !error && (view === 'agenda'
      ? <BookingAgendaView bookings={response.items} onOpen={setSelected} />
      : view === 'month' ? <BookingMonthView from={range.from} to={range.to} bookings={response.items} timezone={activeTenant.timezone} onOpen={setSelected} onSelectDay={day => { window.sessionStorage.setItem('ks-calendar-view', 'day'); updateParams({ date: format(day, 'yyyy-MM-dd'), view: 'day' }); }} />
        : <BookingScheduleView columns={columns} bookings={response.items} groupBy={groupBy} density={density} timezone={activeTenant.timezone} onOpen={setSelected} onCreate={() => setCreateOpen(true)} />)}
    <section aria-label="Calendar legend" className="flex flex-wrap gap-2 rounded-2xl border bg-white p-3">{Object.entries(bookingStatusDisplay).map(([status]) => <BookingStatusBadge key={status} status={status as OperationalBookingStatus} compact />)}</section>

    <CreateBookingDialog open={createOpen} timezone={activeTenant.timezone} services={services} staff={staff} initialDate={dateValue} onClose={() => { setCreateOpen(false); if (params.has('create')) updateParams({ create: null }); }} onCreated={() => { window.dispatchEvent(new CustomEvent('ks-bookings-updated')); void load(); }} />
    <BookingQuickView booking={selected} staff={staff} onClose={() => setSelected(null)} onChanged={() => { window.dispatchEvent(new CustomEvent('ks-bookings-updated')); void load(); }} onCheckout={booking => navigate('/app/pos', { state: { booking } })} />
  </main>;
}
