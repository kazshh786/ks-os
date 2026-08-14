import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { addDays } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { AlertTriangle, CalendarDays, Clipboard, ExternalLink, Plus, SlidersHorizontal } from 'lucide-react';
import type { BookingOperationsResponse, BookingPageResponse } from '@ks-os/contracts';
import { getDataProvider } from '../../data/data-provider.js';
import { useWorkspace } from '../../context/WorkspaceContext.js';
import { BookingStatusBadge } from '../bookings/BookingStatusBadge.js';

const empty: BookingOperationsResponse = { items: [], meta: { page: 1, limit: 100, total: 0, hasMore: false }, summary: { total: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0, awaitingPayment: 0, incompleteForms: 0, requiresAttention: 0 } };

export function BookingOperationsSummary() {
  const { activeTenant } = useWorkspace();
  const [data, setData] = useState(empty);
  const [page, setPage] = useState<BookingPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!activeTenant) return;
    if (!silent) setLoading(true);
    setError('');
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: activeTenant.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const from = fromZonedTime(`${localDate}T00:00:00`, activeTenant.timezone);
    const to = fromZonedTime(`${new Intl.DateTimeFormat('en-CA', { timeZone: activeTenant.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(addDays(from, 1))}T00:00:00`, activeTenant.timezone);
    try {
      const bookings = await getDataProvider().getBookingOperations({ from: from.toISOString(), to: to.toISOString(), page: 1, limit: 100, sort: 'START_ASC' });
      setData(bookings);
      const bookingPage = await getDataProvider().getBookingPageSettings().catch(() => null);
      setPage(bookingPage);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Today’s booking operations could not be loaded.'); }
    finally { if (!silent) setLoading(false); }
  }, [activeTenant]);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(true), 30_000); return () => window.clearInterval(timer); }, [load]);
  if (!activeTenant) return null;
  const next = data.items.filter(item => new Date(item.endTime) > new Date() && !['CANCELLED','NO_SHOW'].includes(item.status)).slice(0, 6);
  const attention = data.items.filter(item => item.attentionReasons.length > 0).slice(0, 5);
  const pending = data.items.filter(item => item.status === 'PENDING').length;
  const unpaid = data.items.filter(item => ['PENDING','FAILED','PARTIALLY_PAID'].includes(item.paymentStatus)).length;
  const metrics = [
    ['Today', data.summary.total, '/app/calendar?view=day'], ['Completed', data.summary.completed, '/app/bookings?view=agenda&status=COMPLETED'], ['Cancelled', data.summary.cancelled, '/app/bookings?view=agenda&status=CANCELLED'], ['No-shows', data.summary.noShow, '/app/bookings?view=agenda&status=NO_SHOW'], ['Pending', pending, '/app/bookings?view=agenda&status=PENDING'], ['Unpaid', unpaid, '/app/bookings?view=agenda&payment=PENDING'], ['Forms outstanding', data.summary.incompleteForms, '/app/bookings?view=agenda&intake=PENDING'], ['Needs attention', data.summary.requiresAttention, '/app/bookings?view=agenda&attention=true'],
  ] as const;

  return <section aria-labelledby="booking-operations-title" className="space-y-4">
    <header className="rounded-3xl bg-gradient-to-br from-indigo-700 to-slate-950 p-4 text-white sm:p-6"><div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end"><div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-200">Today’s operations</p><h1 id="booking-operations-title" className="mt-2 break-words text-2xl font-black sm:text-3xl">Bookings at the centre of your day</h1><p className="mt-2 break-words text-sm text-slate-300">Live schedule and attention queue in {activeTenant.timezone}.</p></div><div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-2 sm:flex sm:flex-wrap"><Link to="/app/calendar?create=1" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-slate-950"><Plus className="h-4 w-4" />Create booking</Link><Link to="/app/calendar?view=day" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold"><CalendarDays className="h-4 w-4" />Open calendar</Link>{page && <><button onClick={() => navigator.clipboard.writeText(page.publicUrl).then(() => setMessage('Booking link copied.'))} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold"><Clipboard className="h-4 w-4" />Copy booking link</button><a href={page.publicUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold"><ExternalLink className="h-4 w-4" />Open booking page</a></>}</div></div></header>
    {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{message}</p>}
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error} <button onClick={() => void load()} className="underline">Retry</button></p>}
    {loading ? <div className="h-48 animate-pulse rounded-2xl bg-slate-200"><span className="sr-only">Loading today’s booking operations</span></div> : <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">{metrics.map(([label, value, href]) => <Link key={label} to={href} className="rounded-xl border bg-white p-3 hover:border-indigo-300"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></Link>)}</div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]"><section className="rounded-2xl border bg-white p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-black">Next bookings</h2><p className="text-xs text-slate-500">Current time: {new Intl.DateTimeFormat('en-GB', { timeZone: activeTenant.timezone, timeStyle: 'short' }).format(new Date())}</p></div><Link to="/app/calendar?view=day" className="inline-flex min-h-11 items-center text-xs font-black text-indigo-700">Full day</Link></div>{next.length ? <ol className="mt-4 space-y-2">{next.map(item => <li key={item.id}><Link to={`/app/calendar?view=day&date=${new Intl.DateTimeFormat('en-CA', { timeZone: item.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(item.startTime))}`} className="grid min-h-11 grid-cols-[64px_minmax(0,1fr)] items-center gap-3 rounded-xl border p-3 hover:border-indigo-300 sm:grid-cols-[72px_minmax(0,1fr)_auto]"><span className="font-mono text-sm font-black">{new Intl.DateTimeFormat('en-GB', { timeZone: item.timezone, timeStyle: 'short' }).format(new Date(item.startTime))}</span><span className="min-w-0"><span className="block line-clamp-2 break-words font-black">{item.customer.name}</span><span className="block line-clamp-2 break-words text-xs text-slate-500">{item.service.name} · {item.staff.name}{item.location.name ? ` · ${item.location.name}` : ''}</span></span><span className="col-span-2 sm:col-span-1"><BookingStatusBadge status={item.status} compact /></span></Link></li>)}</ol> : <div className="mt-4 rounded-xl border border-dashed p-6 text-center sm:p-8"><p className="font-black">No more bookings today</p><p className="mt-1 text-sm text-slate-500">Create a booking or share the public page to fill availability.</p></div>}</section>
        <section className="rounded-2xl border bg-white p-4 sm:p-5"><div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /><h2 className="text-lg font-black">Requires attention</h2></div>{attention.length ? <ul className="mt-4 space-y-2">{attention.map(item => <li key={item.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="break-words font-black text-amber-950">{item.customer.name} · {new Intl.DateTimeFormat('en-GB', { timeZone: item.timezone, timeStyle: 'short' }).format(new Date(item.startTime))}</p><p className="mt-1 break-words text-xs text-amber-800">{item.attentionReasons.join(' · ')}</p><Link to="/app/calendar?view=day&attention=true" className="mt-2 inline-flex min-h-11 items-center text-xs font-black text-amber-950 underline">Open and resolve</Link></li>)}</ul> : <div className="mt-4 rounded-xl bg-emerald-50 p-5 text-sm text-emerald-800"><p className="font-black">Nothing urgent right now</p><p className="mt-1">Payment, form and scheduling checks are clear for today’s loaded bookings.</p></div>}<Link to="/app/settings/availability" className="mt-4 inline-flex min-h-11 items-center gap-2 text-xs font-black text-indigo-700"><SlidersHorizontal className="h-4 w-4" />Manage availability</Link></section></div>
    </>}
  </section>;
}
