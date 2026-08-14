import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock, CheckCircle2, CircleUserRound, CreditCard, FileText, HeartPulse,
  History, Mail, MapPin, Megaphone, Phone, Repeat2, Sparkles, UserRound, X,
} from 'lucide-react';
import type { BookingDetail, BookingOperationsItem, OperationalBookingStatus } from '@ks-os/contracts';
import { fromZonedTime } from 'date-fns-tz';
import type { Staff } from '../../data/types.js';
import { fetchWithAuth } from '../../api/client.js';
import { getDataProvider } from '../../data/data-provider.js';
import { useModalDialog } from '../../components/overlays/useModalDialog.js';
import { BookingStatusBadge } from './BookingStatusBadge.js';

export interface ProposedBookingReschedule {
  startTime: string;
  staffId: string;
  targetLabel: string;
}

interface BookingQuickViewProps {
  booking: BookingOperationsItem | null;
  staff: Staff[];
  initialReschedule?: ProposedBookingReschedule | null;
  onClose: () => void;
  onChanged: () => void;
  onCheckout: (booking: BookingOperationsItem) => void;
}

const nextActions: Partial<Record<OperationalBookingStatus, Array<{ status: OperationalBookingStatus; label: string }>>> = {
  PENDING: [{ status: 'CONFIRMED', label: 'Confirm' }, { status: 'CANCELLED', label: 'Cancel' }],
  CONFIRMED: [{ status: 'CHECKED_IN', label: 'Check in' }, { status: 'NO_SHOW', label: 'Mark no-show' }, { status: 'CANCELLED', label: 'Cancel' }],
  CHECKED_IN: [{ status: 'IN_SERVICE', label: 'Start service' }, { status: 'CANCELLED', label: 'Cancel' }],
  IN_SERVICE: [{ status: 'AWAITING_PAYMENT', label: 'Take payment' }, { status: 'COMPLETED', label: 'Complete' }],
  AWAITING_PAYMENT: [{ status: 'COMPLETED', label: 'Complete' }],
};

const sourceLabels: Record<string, string> = {
  PUBLIC_BOOKING_PAGE: 'Public booking page', EMBEDDED_WIDGET: 'Embedded booking widget', STAFF_CREATED: 'Created by staff',
  ADMIN_CREATED: 'Created by owner', CUSTOMER_PORTAL: 'Customer portal', GOOGLE_BUSINESS_PROFILE: 'Google Business Profile',
  INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook', TIKTOK: 'TikTok', WHATSAPP: 'WhatsApp', REFERRAL: 'Referral',
  API: 'API', ZAPIER: 'Zapier', MAKE: 'Make', IMPORTED: 'Imported', OTHER: 'Other',
};

const money = (value: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value / 100);
const humanize = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/^./, letter => letter.toUpperCase());
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'C';

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
    <h3 className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{title}</h3>
    <div className="mt-3">{children}</div>
  </section>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
    <p className="text-xl font-black text-slate-950">{value}</p>
    <p className="mt-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p>
  </div>;
}

function addressText(value: Record<string, unknown> | null | undefined) {
  if (!value) return null;
  return Object.values(value).filter(item => item !== null && item !== undefined && item !== '').map(String).join(', ') || null;
}

export function BookingQuickView({ booking, staff, initialReschedule = null, onClose, onChanged, onCheckout }: BookingQuickViewProps) {
  const dialogRef = useModalDialog<HTMLElement>(Boolean(booking), onClose);
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [staffId, setStaffId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!booking) return;
    const proposed = initialReschedule?.startTime || booking.startTime;
    const proposedDate = new Date(proposed);
    setDate(new Intl.DateTimeFormat('en-CA', { timeZone: booking.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(proposedDate));
    setTime(new Intl.DateTimeFormat('en-GB', { timeZone: booking.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(proposedDate));
    setStaffId(initialReschedule?.staffId || booking.staff.id);
    setRescheduling(Boolean(initialReschedule));
    setError('');
  }, [booking, initialReschedule, onClose]);

  useEffect(() => {
    if (!booking || booking.status === 'BLOCKED') { setDetail(null); return; }
    let active = true;
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    fetchWithAuth(`/api/v1/bookings/${encodeURIComponent(booking.id)}`)
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error?.message || 'Appointment details could not be loaded.');
        if (active) setDetail(body.data as BookingDetail);
      })
      .catch(cause => { if (active) setDetailError(cause instanceof Error ? cause.message : 'Appointment details could not be loaded.'); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [booking]);

  const selectedStaffName = useMemo(() => staff.find(member => member.id === staffId)?.name || booking?.staff.name || 'Team member', [booking?.staff.name, staff, staffId]);
  if (!booking) return null;
  const record = detail || booking;
  const formatDateTime = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: booking.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const formatDate = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('en-GB', { timeZone: booking.timezone, dateStyle: 'medium' }).format(new Date(value)) : 'Not recorded';
  const proposedStart = date && time ? fromZonedTime(`${date}T${time}:00`, booking.timezone).toISOString() : booking.startTime;
  const breakdown = detail?.customerBreakdown;
  const acquisition = detail?.acquisition;
  const mobileAddress = addressText(detail?.mobileAddress);

  const updateStatus = async (status: OperationalBookingStatus) => {
    if (status === 'CANCELLED' && !window.confirm('Cancel this booking? This action is recorded in the audit trail.')) return;
    setSaving(true); setError('');
    try {
      if (status === 'CANCELLED') await getDataProvider().cancelBooking(booking.id);
      else await getDataProvider().updateBookingStatus(booking.id, status);
      onChanged(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The booking could not be updated.'); }
    finally { setSaving(false); }
  };

  const removeBlock = async () => {
    if (!window.confirm('Remove this blocked period and make the time available again?')) return;
    setSaving(true); setError('');
    try { await getDataProvider().removeBlockedTime(booking.id); onChanged(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The blocked time could not be removed.'); }
    finally { setSaving(false); }
  };

  const saveReschedule = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      await getDataProvider().rescheduleBooking(booking.id, {
        startTime: proposedStart,
        staffId,
        notifyCustomer: true,
        reason: initialReschedule ? 'Confirmed after calendar drag and drop' : 'Changed from appointment details modal',
      });
      onChanged(); onClose();
    } catch (cause) { setError(cause instanceof Error && cause.message === 'SLOT_UNAVAILABLE' ? 'That time is unavailable. No change was saved.' : cause instanceof Error ? cause.message : 'The booking could not be rescheduled.'); }
    finally { setSaving(false); }
  };

  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 backdrop-blur-sm sm:p-5" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="booking-quick-view-title" tabIndex={-1} className="flex max-h-dvh w-full max-w-6xl flex-col overflow-hidden border border-white/20 bg-slate-50 shadow-2xl sm:max-h-[calc(100dvh-2.5rem)] sm:rounded-3xl">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3 sm:gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-100 text-base font-black text-indigo-800 sm:h-14 sm:w-14">{initials(record.customer.name)}</div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-[10px] font-black uppercase tracking-wider text-slate-500">{record.reference}</p>
              <BookingStatusBadge status={record.status} />
              {breakdown && <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${breakdown.repeatCustomer ? 'bg-violet-100 text-violet-800' : 'bg-emerald-100 text-emerald-800'}`}>{breakdown.repeatCustomer ? <Repeat2 className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}{breakdown.repeatCustomer ? 'Repeat customer' : 'New customer'}</span>}
            </div>
            <h2 id="booking-quick-view-title" className="mt-1 line-clamp-2 break-words text-xl font-black text-slate-950 sm:text-2xl">{record.customer.name}</h2>
            <p className="mt-1 line-clamp-2 break-words text-sm font-semibold text-slate-600">{record.service.name} with {record.staff.name}</p>
          </div>
        </div>
        <button data-dialog-initial-focus onClick={onClose} aria-label="Close appointment details" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"><X className="h-5 w-5" /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
        {detailError && <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{detailError} Basic appointment details are still shown below.</p>}
        {detailLoading && <p role="status" className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm font-semibold text-indigo-900">Loading customer history, source and booking-form answers…</p>}

        {rescheduling && <form onSubmit={saveReschedule} className="mb-4 rounded-2xl border-2 border-indigo-300 bg-indigo-50 p-4 shadow-sm">
          <div className="flex items-start gap-3"><CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-indigo-700" /><div><h3 className="font-black text-indigo-950">Are you sure you want to reschedule?</h3><p className="mt-1 text-sm text-indigo-900">The customer will be notified after you confirm the new date and time.</p>{initialReschedule && <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-xs font-bold text-indigo-950">Dragged to {initialReschedule.targetLabel}. Review the exact details before confirming.</p>}</div></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-bold text-slate-800">New date<input required type="date" value={date} onChange={event => setDate(event.target.value)} className="mt-1 w-full rounded-xl border border-indigo-200 bg-white p-2.5" /></label>
            <label className="text-sm font-bold text-slate-800">New time<input required type="time" value={time} onChange={event => setTime(event.target.value)} className="mt-1 w-full rounded-xl border border-indigo-200 bg-white p-2.5" /></label>
            <label className="text-sm font-bold text-slate-800">Team member<select value={staffId} onChange={event => setStaffId(event.target.value)} className="mt-1 w-full rounded-xl border border-indigo-200 bg-white p-2.5">{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          </div>
          <div className="mt-4 grid gap-2 rounded-xl border border-indigo-200 bg-white p-3 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div><span className="block text-[10px] font-black uppercase tracking-wide text-slate-400">Current</span><strong>{formatDateTime(booking.startTime)}</strong><span className="block text-xs text-slate-500">{booking.staff.name}</span></div><span className="hidden text-indigo-500 sm:block">→</span><div><span className="block text-[10px] font-black uppercase tracking-wide text-indigo-500">Proposed</span><strong className="text-indigo-950">{formatDateTime(proposedStart)}</strong><span className="block text-xs text-indigo-700">{selectedStaffName}</span></div>
          </div>
          <div className="mt-4 grid gap-2 min-[380px]:grid-cols-2 sm:flex sm:flex-wrap"><button disabled={saving} className="min-h-11 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">Yes, reschedule appointment</button><button type="button" onClick={() => setRescheduling(false)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700">Keep current appointment</button></div>
        </form>}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title="Appointment details"><div className="grid gap-3 text-sm sm:grid-cols-2">
              <p className="flex items-start gap-2"><CalendarClock className="mt-0.5 h-4 w-4 text-indigo-600" /><span><strong className="block text-slate-950">{formatDateTime(record.startTime)}</strong><span className="text-slate-500">Ends {formatDateTime(record.endTime)} · {record.timezone}</span></span></p>
              <p className="flex items-start gap-2"><UserRound className="mt-0.5 h-4 w-4 text-indigo-600" /><span><strong className="block text-slate-950">{record.service.name}</strong><span className="text-slate-500">{record.staff.name} · {record.service.durationMinutes} minutes</span></span></p>
              <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 text-indigo-600" /><span><strong className="block text-slate-950">{record.location.name || (record.bookingChannel === 'mobile' ? 'Mobile appointment' : 'Primary location')}</strong><span className="text-slate-500">{mobileAddress || humanize(record.bookingChannel)}</span></span></p>
              <p className="flex items-start gap-2"><CreditCard className="mt-0.5 h-4 w-4 text-indigo-600" /><span><strong className="block text-slate-950">{money(record.quotedAmount)}</strong><span className="text-slate-500">{humanize(record.paymentStatus)}</span></span></p>
            </div></Card>

            {breakdown && <Card title="Customer history">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Completed visits" value={breakdown.completedVisits} /><Stat label="Total bookings" value={breakdown.totalBookings} /><Stat label="Upcoming" value={breakdown.upcomingBookings} /><Stat label="Loyalty points" value={breakdown.loyaltyPoints} /></div>
              <div className="mt-3 grid gap-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2"><p><span className="block text-[10px] font-black uppercase tracking-wide text-slate-400">First completed visit</span><strong>{formatDate(breakdown.firstVisitAt)}</strong></p><p><span className="block text-[10px] font-black uppercase tracking-wide text-slate-400">Last completed visit</span><strong>{formatDate(breakdown.lastVisitAt)}</strong></p><p><span className="block text-[10px] font-black uppercase tracking-wide text-slate-400">Cancellations</span><strong>{breakdown.cancellations}</strong></p><p><span className="block text-[10px] font-black uppercase tracking-wide text-slate-400">No-shows</span><strong>{breakdown.noShows}</strong></p></div>
            </Card>}

            <Card title="Booking forms and answers">
              {detail?.formResponses.length ? <div className="space-y-3">{detail.formResponses.map(form => <article key={form.assignmentId} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-black text-slate-950">{form.formTitle}</h4><p className="text-xs text-slate-500">{form.submittedAt ? `Submitted ${formatDateTime(form.submittedAt)}` : humanize(form.status)}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${form.status === 'SUBMITTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{humanize(form.status)}</span></div>{form.answers.length ? <dl className="mt-3 grid gap-2 sm:grid-cols-2">{form.answers.map(answer => <div key={answer.key} className="rounded-lg border border-slate-200 bg-white p-3"><dt className="text-[10px] font-black uppercase tracking-wide text-slate-400">{answer.label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-800">{answer.displayValue}</dd></div>)}</dl> : <p className="mt-3 text-sm text-slate-500">No submitted answers are available for this form yet.</p>}</article>)}</div> : <p className="text-sm text-slate-500">No booking forms are attached to this appointment.</p>}
            </Card>

            {(record.notes || record.customerNotes || breakdown?.medicalNotes) && <div className="grid gap-4 sm:grid-cols-2">{record.notes && <Card title="Internal notes"><p className="whitespace-pre-wrap text-sm text-slate-800">{record.notes}</p></Card>}{record.customerNotes && <Card title="Customer booking notes"><p className="whitespace-pre-wrap text-sm text-slate-800">{record.customerNotes}</p></Card>}{breakdown?.medicalNotes && <Card title="Medical notes" className="border-rose-200 bg-rose-50 sm:col-span-2"><p className="flex items-start gap-2 whitespace-pre-wrap text-sm text-rose-950"><HeartPulse className="mt-0.5 h-4 w-4 shrink-0" />{breakdown.medicalNotes}</p></Card>}</div>}
          </div>

          <aside className="space-y-4">
            <Card title="Customer contact"><div className="space-y-3 text-sm"><p className="flex items-center gap-2"><CircleUserRound className="h-4 w-4 text-indigo-600" /><strong>{record.customer.name}</strong></p>{record.customer.email ? <a href={`mailto:${record.customer.email}`} className="flex items-center gap-2 break-all font-semibold text-indigo-700 hover:underline"><Mail className="h-4 w-4 shrink-0" />{record.customer.email}</a> : <p className="flex items-center gap-2 text-slate-500"><Mail className="h-4 w-4" />No email</p>}{record.customer.phone ? <a href={`tel:${record.customer.phone}`} className="flex items-center gap-2 font-semibold text-indigo-700 hover:underline"><Phone className="h-4 w-4" />{record.customer.phone}</a> : <p className="flex items-center gap-2 text-slate-500"><Phone className="h-4 w-4" />No phone</p>}{breakdown && <p className="flex items-center gap-2 text-slate-600"><History className="h-4 w-4" />Customer since {formatDate(breakdown.memberSince)}</p>}{breakdown?.patchTestDate && <p className="flex items-center gap-2 text-slate-600"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Patch test {formatDate(breakdown.patchTestDate)}</p>}</div></Card>
            <Card title="Source and attribution"><div className="space-y-3 text-sm"><p className="flex items-start gap-2"><Megaphone className="mt-0.5 h-4 w-4 text-indigo-600" /><span><strong className="block text-slate-950">{sourceLabels[acquisition?.source || record.source] || humanize(acquisition?.source || record.source)}</strong><span className="text-slate-500">Booked {formatDateTime(acquisition?.bookedAt || record.createdAt)}</span></span></p>{acquisition?.medium && <p><span className="block text-[10px] font-black uppercase tracking-wide text-slate-400">Medium</span><strong>{acquisition.medium}</strong></p>}{acquisition?.campaign && <p><span className="block text-[10px] font-black uppercase tracking-wide text-slate-400">Campaign</span><strong>{acquisition.campaign}</strong></p>}{acquisition?.referrerHost && <p><span className="block text-[10px] font-black uppercase tracking-wide text-slate-400">Referrer</span><strong className="break-all">{acquisition.referrerHost}</strong></p>}</div></Card>
            <Card title="Operational status"><div className="space-y-2 text-sm"><p className="flex items-center justify-between gap-3"><span className="text-slate-500">Payment</span><strong>{humanize(record.paymentStatus)}</strong></p><p className="flex items-center justify-between gap-3"><span className="text-slate-500">Forms</span><strong>{humanize(record.intakeStatus)}</strong></p><p className="flex items-center justify-between gap-3"><span className="text-slate-500">Channel</span><strong>{humanize(record.bookingChannel)}</strong></p></div></Card>
            {record.attentionReasons.length > 0 && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-black text-amber-950">Requires attention</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">{record.attentionReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></section>}
          </aside>
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
      </div>

      <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex sm:flex-wrap sm:px-6">
        {booking.status !== 'BLOCKED' && <button onClick={() => setRescheduling(true)} disabled={saving || ['COMPLETED','CANCELLED','NO_SHOW'].includes(booking.status)} className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-black disabled:opacity-40">Reschedule</button>}
        {booking.status === 'BLOCKED' && <button onClick={() => void removeBlock()} disabled={saving} className="min-h-11 rounded-xl border border-rose-200 px-3 py-2 text-sm font-black text-rose-700">Remove block</button>}
        {nextActions[booking.status]?.map(action => <button key={action.status} onClick={() => void updateStatus(action.status)} disabled={saving} className={`min-h-11 rounded-xl px-3 py-2 text-sm font-black ${action.status === 'CANCELLED' ? 'border border-rose-200 text-rose-700' : 'bg-slate-900 text-white'}`}>{action.label}</button>)}
        {booking.status === 'AWAITING_PAYMENT' && <button onClick={() => onCheckout(booking)} className="min-h-11 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-black text-white">Open checkout</button>}
      </footer>
    </section>
  </div>;
}
