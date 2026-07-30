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
  mode?: 'booking' | 'walk-in';
}

const walkInRecentWindowMs = 30 * 60_000;

function localDateTime(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

function nextBookableTime(timezone: string) {
  const next = new Date(Date.now() + 30 * 60_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(next);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  const minutes = Number(value('minute'));
  const roundedMinutes = minutes < 30 ? '30' : '00';
  const hour = String((Number(value('hour')) + (minutes >= 30 ? 1 : 0)) % 24).padStart(2, '0');
  const roundedDate = new Date(next);
  if (minutes >= 30 && Number(value('hour')) === 23) roundedDate.setUTCDate(roundedDate.getUTCDate() + 1);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(roundedDate);
  return { date, time: `${hour}:${roundedMinutes}` };
}

function nextWalkInTime(timezone: string) {
  return localDateTime(new Date(Date.now() + 5 * 60_000), timezone);
}

function normalizeWalkInStart(selectedStart: Date) {
  const now = Date.now();
  const selectedTime = selectedStart.getTime();
  if (selectedTime >= now - walkInRecentWindowMs && selectedTime < now + 2 * 60_000) {
    return new Date(now + 60_000);
  }
  return selectedStart;
}

export function CreateBookingDialog({ open, timezone, services, staff, initialDate, onClose, onCreated, mode = 'booking' }: CreateBookingDialogProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState('09:00');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [forms, setForms] = useState<Array<{ id: string; title: string; status: string }>>([]);
  const [intakeFormIds, setIntakeFormIds] = useState<string[]>([]);
  const [confirmPastBooking, setConfirmPastBooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const next = mode === 'walk-in' ? nextWalkInTime(timezone) : nextBookableTime(timezone);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    setDate(mode === 'walk-in' ? next.date : initialDate < next.date ? next.date : initialDate);
    if (initialDate <= today || mode === 'walk-in') setTime(next.time);
    setServiceId(current => current || services[0]?.id || '');
    setStaffId(current => current || staff[0]?.id || '');
    void getDataProvider().listForms().then(rows => setForms(rows.filter((form: any) => form.status === 'PUBLISHED'))).catch(() => setForms([]));
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [initialDate, mode, onClose, open, services, staff, timezone]);

  if (!open) return null;
  const selectedStart = fromZonedTime(`${date}T${time}:00`, timezone);
  const historicalCutoff = Date.now() - (mode === 'walk-in' ? walkInRecentWindowMs : 0);
  const isPastBooking = selectedStart.getTime() < historicalCutoff;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const selected = fromZonedTime(`${date}T${time}:00`, timezone);
      const startTime = mode === 'walk-in' ? normalizeWalkInStart(selected) : selected;
      if (startTime.getTime() < Date.now() && !confirmPastBooking) {
        setError('Confirm that this is a historical booking before saving it.');
        return;
      }
      if (mode !== 'walk-in' && startTime.getTime() >= Date.now() && startTime.getTime() < Date.now() + 5 * 60_000) {
        setError('Choose a time at least five minutes from now.');
        return;
      }
      await getDataProvider().createStaffBooking({
        serviceId,
        staffId,
        startTime: startTime.toISOString(),
        client: { name, email: email.trim(), phone: phone.trim() },
        bookingChannel: 'in_shop',
        paymentMode: 'pay_later',
        payNow: false,
        internalNote: notes || null,
        intakeFormIds,
        notifyCustomer: mode === 'booking',
        confirmPastBooking,
        walkIn: mode === 'walk-in',
      });
      onCreated();
      onClose();
      setName(''); setEmail(''); setPhone(''); setNotes(''); setConfirmPastBooking(false); setIntakeFormIds([]);
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'SLOT_UNAVAILABLE' ? 'That time is no longer available. Choose another time.' : cause instanceof Error ? cause.message : 'The booking could not be created.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6" role="presentation" data-calendar-dialog-layer="true">
    <section role="dialog" aria-modal="true" aria-labelledby="create-booking-title" className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl">
      <header className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">{mode === 'walk-in' ? 'Walk-in desk' : 'Calendar booking'}</p><h2 id="create-booking-title" className="mt-1 text-2xl font-black text-slate-950">{mode === 'walk-in' ? 'Add walk-in' : 'Create booking'}</h2><p className="mt-1 text-sm text-slate-500">{mode === 'walk-in' ? 'The customer will be added to the calendar as checked in and ready for service.' : 'Availability is checked again by the server before this is saved.'}</p></div>
        <button ref={closeButton} type="button" onClick={onClose} aria-label="Close create booking" className="rounded-lg border p-2 text-slate-600 hover:bg-slate-50"><X className="h-5 w-5" /></button>
      </header>
      <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">Service<select required value={serviceId} onChange={event => setServiceId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3">{services.map(service => <option key={service.id} value={service.id}>{service.name} · {service.durationMin} min</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">Team member<select required value={staffId} onChange={event => setStaffId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3">{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">{mode === 'walk-in' ? 'Arrival date' : 'Date'}<input required type="date" value={date} onChange={event => setDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        <label className="text-sm font-semibold text-slate-700">Start time<input required type="time" value={time} onChange={event => setTime(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Customer name<input required minLength={2} value={name} onChange={event => setName(event.target.value)} autoComplete="name" className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        {mode === 'walk-in' && <p className="-mb-1 text-xs text-slate-500 sm:col-span-2">Contact details are optional for walk-ins. Add either one when available so the customer record can be recognised on a future visit.</p>}
        <label className="text-sm font-semibold text-slate-700">Email{mode === 'walk-in' && <span className="ml-1 text-xs font-medium text-slate-400">Optional</span>}<input required={mode !== 'walk-in'} type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        <label className="text-sm font-semibold text-slate-700">Phone{mode === 'walk-in' && <span className="ml-1 text-xs font-medium text-slate-400">Optional</span>}<input required={mode !== 'walk-in'} minLength={phone ? 7 : undefined} maxLength={30} type="tel" value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Internal notes<textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        {forms.length > 0 && <fieldset className="rounded-xl border border-slate-200 p-4 sm:col-span-2"><legend className="px-1 text-sm font-black text-slate-800">Intake forms</legend><p className="mb-3 text-xs text-slate-500">Selected forms will be assigned to the customer and linked to this booking.</p><div className="space-y-2">{forms.map(form => <label key={form.id} className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={intakeFormIds.includes(form.id)} onChange={event => setIntakeFormIds(current => event.target.checked ? [...current, form.id] : current.filter(id => id !== form.id))} />{form.title}</label>)}</div></fieldset>}
        {isPastBooking && <label className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 sm:col-span-2"><input required type="checkbox" checked={confirmPastBooking} onChange={event => setConfirmPastBooking(event.target.checked)} className="mt-0.5" /><span><strong className="block">Confirm historical booking</strong>This appointment is in the past. Save it as a completed booking in the customer and business history.</span></label>}
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800 sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-3 sm:col-span-2"><button type="button" onClick={onClose} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={saving || !services.length || !staff.length} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Checking availability…' : mode === 'walk-in' ? 'Check in walk-in' : 'Create booking'}</button></div>
      </form>
    </section>
  </div>;
}
