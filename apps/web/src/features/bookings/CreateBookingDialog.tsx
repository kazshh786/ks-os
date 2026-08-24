import { useEffect, useState } from 'react';
import { Link2, X } from 'lucide-react';
import { fromZonedTime } from 'date-fns-tz';
import type { Service, Staff } from '../../data/types.js';
import { getClientProfile, latestApiErrorNotice } from '../../api/client.js';
import { getDataProvider } from '../../data/data-provider.js';
import { useModalDialog } from '../../components/overlays/useModalDialog.js';

interface CreateBookingDialogProps {
  open: boolean;
  timezone: string;
  services: Service[];
  staff: Staff[];
  initialDate: string;
  initialClientId?: string | null;
  onClose: () => void;
  onCreated: () => void;
  mode?: 'booking' | 'walk-in';
}

const walkInRecentWindowMs = 30 * 60_000;
const calendarVisibilityFilterKeys = ['staff', 'service', 'location', 'status', 'payment', 'intake', 'attention'] as const;

function errorMessage(message: string, code: string, reference?: string) {
  return `${message} Error code: ${code}.${reference ? ` Reference: ${reference}.` : ''}`;
}

function localDateTime(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

function revealCreatedBooking(startTime: Date, timezone: string) {
  if (typeof window === 'undefined') return;
  const createdDate = localDateTime(startTime, timezone).date;
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('date', createdDate);
  for (const key of calendarVisibilityFilterKeys) nextUrl.searchParams.delete(key);
  window.history.replaceState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
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

export function CreateBookingDialog({ open, timezone, services, staff, initialDate, initialClientId = null, onClose, onCreated, mode = 'booking' }: CreateBookingDialogProps) {
  const dialogRef = useModalDialog<HTMLElement>(open, onClose);
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
  const [loadingClient, setLoadingClient] = useState(false);
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
  }, [initialDate, mode, onClose, open, services, staff, timezone]);

  useEffect(() => {
    if (!open || !initialClientId) return;
    let active = true;
    setLoadingClient(true);
    setError('');
    getClientProfile(initialClientId).then(result => {
      if (!active) return;
      const profile = result.data.profile;
      setName(profile.name || '');
      setEmail(profile.email || '');
      setPhone(profile.phone || '');
    }).catch(cause => {
      if (!active) return;
      const notice = latestApiErrorNotice();
      const causeMessage = cause instanceof Error ? cause.message : '';
      const matchingNotice = notice && (!causeMessage || causeMessage === notice.message || causeMessage === notice.code) ? notice : null;
      setError(matchingNotice
        ? errorMessage(matchingNotice.message, matchingNotice.code, matchingNotice.requestId)
        : errorMessage(causeMessage || 'The selected customer could not be prefilled. You can still enter their details manually.', 'CLIENT_PREFILL_FAILED'));
    }).finally(() => { if (active) setLoadingClient(false); });
    return () => { active = false; };
  }, [initialClientId, open]);

  if (!open) return null;
  const selectedStart = date && time ? fromZonedTime(`${date}T${time}:00`, timezone) : null;
  const historicalCutoff = Date.now() - (mode === 'walk-in' ? walkInRecentWindowMs : 0);
  const isPastBooking = selectedStart ? selectedStart.getTime() < historicalCutoff : false;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    const cleanedName = name.trim();
    const cleanedEmail = email.trim();
    const cleanedPhone = phone.trim();
    const fail = (code: string, message: string) => {
      setError(errorMessage(message, code));
      return false;
    };

    if (!serviceId) return void fail('SERVICE_REQUIRED', 'Choose a service before creating the booking.');
    if (!staffId) return void fail('STAFF_REQUIRED', 'Choose a team member before creating the booking.');
    if (!date) return void fail('BOOKING_DATE_REQUIRED', 'Choose a booking date.');
    if (!time) return void fail('BOOKING_TIME_REQUIRED', 'Choose a start time.');
    if (cleanedName.length < 2) return void fail('CUSTOMER_NAME_INVALID', 'Enter the customer’s name using at least two characters.');
    if (cleanedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) return void fail('CUSTOMER_EMAIL_INVALID', 'Enter a valid customer email address or leave email blank and use a phone number.');
    if (cleanedPhone && cleanedPhone.length < 7) return void fail('CUSTOMER_PHONE_INVALID', 'Enter a valid customer phone number with at least seven characters.');
    if (mode !== 'walk-in' && !cleanedEmail && !cleanedPhone) return void fail('CUSTOMER_CONTACT_REQUIRED', 'Add either an email address or a phone number for this booking.');

    setSaving(true);
    try {
      const selected = fromZonedTime(`${date}T${time}:00`, timezone);
      const startTime = mode === 'walk-in' ? normalizeWalkInStart(selected) : selected;
      if (startTime.getTime() < Date.now() && !confirmPastBooking) {
        setError(errorMessage('Confirm that this is a historical booking before saving it.', 'PAST_BOOKING_CONFIRMATION_REQUIRED'));
        return;
      }
      if (mode !== 'walk-in' && startTime.getTime() >= Date.now() && startTime.getTime() < Date.now() + 5 * 60_000) {
        setError(errorMessage('Choose a time at least five minutes from now.', 'INVALID_BOOKING_TIME'));
        return;
      }
      await getDataProvider().createStaffBooking({
        serviceId,
        staffId,
        startTime: startTime.toISOString(),
        client: { name: cleanedName, email: cleanedEmail, phone: cleanedPhone },
        bookingChannel: 'in_shop',
        paymentMode: 'pay_later',
        payNow: false,
        internalNote: notes || null,
        intakeFormIds,
        notifyCustomer: mode === 'booking',
        confirmPastBooking,
        walkIn: mode === 'walk-in',
      });
      revealCreatedBooking(startTime, timezone);
      onCreated();
      onClose();
      setName(''); setEmail(''); setPhone(''); setNotes(''); setConfirmPastBooking(false); setIntakeFormIds([]);
    } catch (cause) {
      const notice = latestApiErrorNotice();
      const causeMessage = cause instanceof Error ? cause.message : '';
      const matchingNotice = notice && (
        !causeMessage ||
        causeMessage === notice.message ||
        causeMessage === notice.code ||
        (causeMessage === 'SLOT_UNAVAILABLE' && notice.code === 'SLOT_UNAVAILABLE')
      ) ? notice : null;
      if (matchingNotice) {
        setError(errorMessage(matchingNotice.message, matchingNotice.code, matchingNotice.requestId));
      } else if (causeMessage === 'SLOT_UNAVAILABLE') {
        setError(errorMessage('That time is no longer available. Choose another time.', 'SLOT_UNAVAILABLE'));
      } else {
        setError(errorMessage(causeMessage || 'The booking could not be created.', 'BOOKING_CREATION_FAILED'));
      }
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6" role="presentation" data-calendar-dialog-layer="true" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="create-booking-title" tabIndex={-1} className="flex max-h-dvh w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[90dvh] sm:rounded-3xl">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b p-4 sm:p-6">
        <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">{mode === 'walk-in' ? 'Walk-in desk' : 'Calendar booking'}</p><h2 id="create-booking-title" className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">{mode === 'walk-in' ? 'Add walk-in' : 'Create booking'}</h2><p className="mt-1 text-sm text-slate-500">{mode === 'walk-in' ? 'The customer will be added to the calendar as checked in and ready for service.' : 'Availability is checked again by the server before this is saved.'}</p>{initialClientId && <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-700"><Link2 className="h-3.5 w-3.5" />{loadingClient ? 'Loading customer…' : 'Linked from customer inbox'}</p>}</div>
        <button data-dialog-initial-focus type="button" onClick={onClose} aria-label="Close create booking" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-slate-600 hover:bg-slate-50"><X className="h-5 w-5" /></button>
      </header>
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2 sm:p-6">
        <label className="text-sm font-semibold text-slate-700">Service<select value={serviceId} onChange={event => setServiceId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3">{services.map(service => <option key={service.id} value={service.id}>{service.name} · {service.durationMin} min</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">Team member<select value={staffId} onChange={event => setStaffId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3">{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">{mode === 'walk-in' ? 'Arrival date' : 'Date'}<input type="date" value={date} onChange={event => setDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        <label className="text-sm font-semibold text-slate-700">Start time<input type="time" value={time} onChange={event => setTime(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Customer name<input minLength={2} value={name} onChange={event => setName(event.target.value)} autoComplete="name" className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        <p className="-mb-1 text-xs text-slate-500 sm:col-span-2">{mode === 'walk-in' ? 'Contact details are optional for walk-ins. Add either one when available so the customer record can be recognised on a future visit.' : 'Add an email address or phone number. You do not need both.'}</p>
        <label className="text-sm font-semibold text-slate-700">Email<span className="ml-1 text-xs font-medium text-slate-400">{mode === 'walk-in' ? 'Optional' : 'Email or phone required'}</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        <label className="text-sm font-semibold text-slate-700">Phone<span className="ml-1 text-xs font-medium text-slate-400">{mode === 'walk-in' ? 'Optional' : 'Email or phone required'}</span><input minLength={phone ? 7 : undefined} maxLength={30} type="tel" value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Internal notes<textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
        {forms.length > 0 && <fieldset className="rounded-xl border border-slate-200 p-4 sm:col-span-2"><legend className="px-1 text-sm font-black text-slate-800">Intake forms</legend><p className="mb-3 text-xs text-slate-500">Selected forms will be assigned to the customer and linked to this booking.</p><div className="space-y-2">{forms.map(form => <label key={form.id} className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={intakeFormIds.includes(form.id)} onChange={event => setIntakeFormIds(current => event.target.checked ? [...current, form.id] : current.filter(id => id !== form.id))} />{form.title}</label>)}</div></fieldset>}
        {isPastBooking && <label className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 sm:col-span-2"><input type="checkbox" checked={confirmPastBooking} onChange={event => setConfirmPastBooking(event.target.checked)} className="mt-0.5" /><span><strong className="block">Confirm historical booking</strong>This appointment is in the past. Save it as a completed booking in the customer and business history.</span></label>}
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800 sm:col-span-2">{error}</p>}
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-3 border-t bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex sm:justify-end sm:px-6"><button type="button" onClick={onClose} className="min-h-11 rounded-xl border px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={saving || loadingClient || !services.length || !staff.length} className="min-h-11 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Checking availability…' : mode === 'walk-in' ? 'Check in walk-in' : 'Create booking'}</button></div>
      </form>
    </section>
  </div>;
}
