import { useEffect, useRef, useState } from 'react';
import { CalendarClock, CreditCard, FileText, MapPin, UserRound, X } from 'lucide-react';
import type { BookingOperationsItem, OperationalBookingStatus } from '@ks-os/contracts';
import { fromZonedTime } from 'date-fns-tz';
import type { Staff } from '../../data/types.js';
import { getDataProvider } from '../../data/data-provider.js';
import { BookingStatusBadge } from './BookingStatusBadge.js';

interface BookingQuickViewProps {
  booking: BookingOperationsItem | null;
  staff: Staff[];
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

export function BookingQuickView({ booking, staff, onClose, onChanged, onCheckout }: BookingQuickViewProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [staffId, setStaffId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!booking) return;
    const start = new Date(booking.startTime);
    setDate(new Intl.DateTimeFormat('en-CA', { timeZone: booking.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(start));
    setTime(new Intl.DateTimeFormat('en-GB', { timeZone: booking.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(start));
    setStaffId(booking.staff.id);
    setRescheduling(false);
    setError('');
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [booking, onClose]);

  if (!booking) return null;
  const formatDateTime = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: booking.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

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
    event.preventDefault(); setSaving(true); setError('');
    try {
      const startTime = fromZonedTime(`${date}T${time}:00`, booking.timezone).toISOString();
      await getDataProvider().rescheduleBooking(booking.id, { startTime, staffId, notifyCustomer: true, reason: 'Changed from calendar quick view' });
      onChanged(); onClose();
    } catch (cause) { setError(cause instanceof Error && cause.message === 'SLOT_UNAVAILABLE' ? 'That time is unavailable. No change was saved.' : cause instanceof Error ? cause.message : 'The booking could not be rescheduled.'); }
    finally { setSaving(false); }
  };

  return <div className="fixed inset-0 z-40 bg-slate-950/30" role="presentation">
    <aside role="dialog" aria-modal="true" aria-labelledby="booking-quick-view-title" className="ml-auto flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl">
      <header className="sticky top-0 z-10 flex items-start justify-between border-b bg-white p-5"><div><p className="font-mono text-xs font-bold uppercase tracking-wider text-slate-500">{booking.reference}</p><h2 id="booking-quick-view-title" className="mt-1 text-2xl font-black">{booking.customer.name}</h2><div className="mt-2"><BookingStatusBadge status={booking.status} /></div></div><button ref={closeButton} onClick={onClose} aria-label="Close booking details" className="rounded-lg border p-2"><X className="h-5 w-5" /></button></header>
      <div className="flex-1 space-y-5 p-5">
        <section className="grid gap-3 rounded-2xl border bg-slate-50 p-4 text-sm">
          <p className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-indigo-600" /><strong>{formatDateTime(booking.startTime)}</strong> – {formatDateTime(booking.endTime)} <span className="text-slate-500">({booking.timezone})</span></p>
          <p className="flex items-center gap-2"><UserRound className="h-4 w-4 text-indigo-600" />{booking.service.name} with {booking.staff.name}</p>
          <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-indigo-600" />{booking.location.name || (booking.bookingChannel === 'mobile' ? 'Mobile appointment' : 'Primary location')}</p>
          <p className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-indigo-600" />{booking.paymentStatus} · {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(booking.quotedAmount / 100)}</p>
          <p className="flex items-center gap-2"><FileText className="h-4 w-4 text-indigo-600" />Intake: {booking.intakeStatus.replaceAll('_', ' ').toLowerCase()}</p>
        </section>
        {booking.status !== 'BLOCKED' && <section><h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Customer</h3><div className="mt-2 rounded-xl border p-4 text-sm"><p>{booking.customer.email || 'No email'}</p><p>{booking.customer.phone || 'No phone'}</p></div></section>}
        {booking.notes && <section><h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Internal notes</h3><p className="mt-2 whitespace-pre-wrap rounded-xl border p-4 text-sm">{booking.notes}</p></section>}
        {booking.customerNotes && <section><h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Customer notes</h3><p className="mt-2 whitespace-pre-wrap rounded-xl border p-4 text-sm">{booking.customerNotes}</p></section>}
        {booking.attentionReasons.length > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-black text-amber-950">Requires attention</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">{booking.attentionReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></section>}
        {rescheduling && <form onSubmit={saveReschedule} className="grid gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 sm:grid-cols-2"><h3 className="font-black text-indigo-950 sm:col-span-2">Reschedule with keyboard-accessible controls</h3><label className="text-sm font-semibold">Date<input required type="date" value={date} onChange={event => setDate(event.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label><label className="text-sm font-semibold">Time<input required type="time" value={time} onChange={event => setTime(event.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label><label className="text-sm font-semibold sm:col-span-2">Team member<select value={staffId} onChange={event => setStaffId(event.target.value)} className="mt-1 w-full rounded-lg border bg-white p-2">{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><div className="flex gap-2 sm:col-span-2"><button disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Confirm new time</button><button type="button" onClick={() => setRescheduling(false)} className="rounded-lg border bg-white px-4 py-2 text-sm font-bold">Keep current time</button></div></form>}
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
      </div>
      <footer className="sticky bottom-0 flex flex-wrap gap-2 border-t bg-white p-4">
        {booking.status !== 'BLOCKED' && <button onClick={() => setRescheduling(true)} disabled={saving || ['COMPLETED','CANCELLED','NO_SHOW'].includes(booking.status)} className="rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-40">Reschedule</button>}
        {booking.status === 'BLOCKED' && <button onClick={() => void removeBlock()} disabled={saving} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700">Remove block</button>}
        {nextActions[booking.status]?.map(action => <button key={action.status} onClick={() => void updateStatus(action.status)} disabled={saving} className={`rounded-lg px-3 py-2 text-sm font-bold ${action.status === 'CANCELLED' ? 'border border-rose-200 text-rose-700' : 'bg-slate-900 text-white'}`}>{action.label}</button>)}
        {booking.status === 'AWAITING_PAYMENT' && <button onClick={() => onCheckout(booking)} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white">Open checkout</button>}
      </footer>
    </aside>
  </div>;
}
