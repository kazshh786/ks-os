import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { fromZonedTime } from 'date-fns-tz';
import type { Service, Staff } from '../../data/types.js';
import { getDataProvider } from '../../data/data-provider.js';

interface CreateBookingDialogProps {
  open: boolean;
  timezone: string;
  services: Service[];
  staff: Staff[];
  initialDate: string;
  onClose: () => void;
  onCreated: () => void;
}
export function CreateBookingDialog({ open, timezone, services, staff, initialDate, onClose, onCreated }: CreateBookingDialogProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState('09:00');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDate(initialDate);
    setServiceId(current => current || services[0]?.id || '');
    setStaffId(current => current || staff[0]?.id || '');
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [initialDate, onClose, open, services, staff]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await getDataProvider().createStaffBooking({
        serviceId,
        staffId,
        startTime: fromZonedTime(`${date}T${time}:00`, timezone).toISOString(),
        client: { name, email, phone },
        bookingChannel: 'in_shop',
        paymentMode: 'pay_later',
        payNow: false,
        internalNote: notes || null,
        intakeFormIds: [],
        notifyCustomer: true,
      });
      onCreated();
      onClose();
      setName(''); setEmail(''); setPhone(''); setNotes('');
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'SLOT_UNAVAILABLE' ? 'That time is no longer available. Choose another time.' : cause instanceof Error ? cause.message : 'The booking could not be created.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="create-booking-title" className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl">
      <header className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Calendar booking</p><h2 id="create-booking-title" className="mt-1 text-2xl font-black text-slate-950">Create booking</h2><p className="mt-1 text-sm text-slate-500">Availability is checked again by the server before this is saved.</p></div>
        <button ref={closeButton} type="button" onClick={onClose} aria-label="Close create booking" className="rounded-lg border p-2 text-slate-600 hover:bg-slate-50"><X className="h-5 w-5" /></button>
      </header>
      <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">Service<select required value={serviceId} onChange={event => setServiceId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3">{services.map(service => <option key={service.id} value={service.id}>{service.name} · {service.durationMin} min</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">Team member<select required value={staffId} onChange={event => setStaffId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3">{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">Date<input required type="date" value={date} onChange={event => setDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        <label className="text-sm font-semibold text-slate-700">Start time<input required type="time" value={time} onChange={event => setTime(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Customer name<input required minLength={2} value={name} onChange={event => setName(event.target.value)} autoComplete="name" className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        <label className="text-sm font-semibold text-slate-700">Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        <label className="text-sm font-semibold text-slate-700">Phone<input required type="tel" value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Internal notes<textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800 sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-3 sm:col-span-2"><button type="button" onClick={onClose} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={saving || !services.length || !staff.length} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Checking availability…' : 'Create booking'}</button></div>
      </form>
    </section>
  </div>;
}
