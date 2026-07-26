import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import type {
  CustomerBookingManagementPolicy,
  CustomerCancellationRequest,
  CustomerRescheduleAvailabilityResponse,
} from '@ks-os/contracts';
import { customerPortalProvider } from './customer-portal-provider.js';

type Slot = CustomerRescheduleAvailabilityResponse['slots'][number];

const when = (value: string, timeZone?: string) => new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone,
}).format(new Date(value));
const money = (minor: number, currency = 'GBP') => new Intl.NumberFormat('en-GB', {
  style: 'currency', currency,
}).format(minor / 100);
const localDate = (value: string, timeZone: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value));

function Notice({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success'; children: React.ReactNode }) {
  const styles = kind === 'error' ? 'border-red-200 bg-red-50 text-red-800'
    : kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-sky-200 bg-sky-50 text-sky-800';
  return <div role="alert" className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

function Loading() {
  return <div role="status" className="py-12 text-center text-sm text-slate-500">Loading booking details...</div>;
}

function PolicyDetails({ policy, timezone }: { policy: CustomerBookingManagementPolicy; timezone: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm shadow-sm">
    <h2 className="font-bold text-slate-900">Online booking policy</h2>
    <dl className="mt-3 space-y-2 text-slate-600">
      <div><dt className="font-medium text-slate-800">Cancellation deadline</dt><dd>{policy.cancellationDeadline ? when(policy.cancellationDeadline, timezone) : 'Not available'}</dd></div>
      <div><dt className="font-medium text-slate-800">Rescheduling deadline</dt><dd>{policy.rescheduleDeadline ? when(policy.rescheduleDeadline, timezone) : 'Not available'}</dd></div>
      <div><dt className="font-medium text-slate-800">Online reschedules remaining</dt><dd>{policy.reschedulesRemaining ?? 'No fixed limit'}</dd></div>
    </dl>
    <p className="mt-3 text-slate-600">{policy.depositPolicyMessage}</p>
    {policy.blockedReasons.length > 0 && <ul className="mt-3 space-y-1 text-amber-700">{policy.blockedReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
  </div>;
}

export function CustomerBookingPolicyActions({ bookingReference, appointment }: { bookingReference: string; appointment: any }) {
  const [policy, setPolicy] = useState<CustomerBookingManagementPolicy>();
  useEffect(() => {
    customerPortalProvider.getManagementPolicy(bookingReference).then(setPolicy).catch(() => undefined);
  }, [bookingReference]);
  if (!policy) return <Loading />;
  return <div className="space-y-4">
    <PolicyDetails policy={policy} timezone={appointment.timezone} />
    {(policy.canCancel || policy.canReschedule) && <div className="grid gap-3 sm:grid-cols-2">
      {policy.canReschedule && <Link className="rounded-xl bg-slate-900 px-5 py-3 text-center font-bold text-white" to={`/customer/appointments/${bookingReference}/reschedule`}>Reschedule booking</Link>}
      {policy.canCancel && <Link className="rounded-xl border border-red-300 bg-white px-5 py-3 text-center font-bold text-red-700" to={`/customer/appointments/${bookingReference}/cancel`}>Cancel booking</Link>}
    </div>}
  </div>;
}

function useBooking(guest: boolean) {
  const params = useParams();
  const identifier = guest ? params.token : params.bookingReference;
  const [appointment, setAppointment] = useState<any>();
  const [policy, setPolicy] = useState<CustomerBookingManagementPolicy>();
  const [error, setError] = useState('');
  const reload = async () => {
    if (!identifier) return;
    setError('');
    try {
      if (guest) {
        const booking = await customerPortalProvider.getGuestAppointment(identifier);
        setAppointment(booking);
        setPolicy(booking.policy);
      } else {
        const [booking, currentPolicy] = await Promise.all([
          customerPortalProvider.getAppointment(identifier),
          customerPortalProvider.getManagementPolicy(identifier),
        ]);
        setAppointment(booking);
        setPolicy(currentPolicy);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'CUSTOMER_BOOKING_NOT_FOUND');
    }
  };
  useEffect(() => { void reload(); }, [identifier, guest]);
  return { identifier, appointment, policy, error, reload };
}

export function GuestBookingManagementPage() {
  const { identifier, appointment, policy, error } = useBooking(true);
  if (error) return <GuestShell><Notice kind="error">This secure booking link is invalid or has expired.</Notice></GuestShell>;
  if (!appointment || !policy || !identifier) return <GuestShell><Loading /></GuestShell>;
  return <GuestShell color={appointment.salon.primaryColor}>
    <p className="text-sm font-semibold" style={{ color: appointment.salon.primaryColor }}>{appointment.salon.displayName}</p>
    <h1 className="mt-1 text-3xl font-black text-slate-900">Manage your booking</h1>
    <BookingCard appointment={appointment} />
    <PolicyDetails policy={policy} timezone={appointment.timezone} />
    <div className="grid gap-3 sm:grid-cols-2">
      {policy.canReschedule && <Link className="rounded-xl bg-slate-900 px-5 py-3 text-center font-bold text-white" to={`/manage/${identifier}/reschedule`}>Reschedule booking</Link>}
      {policy.canCancel && <Link className="rounded-xl border border-red-300 bg-white px-5 py-3 text-center font-bold text-red-700" to={`/manage/${identifier}/cancel`}>Cancel booking</Link>}
    </div>
    {!policy.canCancel && !policy.canReschedule && <Notice>{policy.blockedReasons[0] || 'Online changes are unavailable. Please contact the salon.'}</Notice>}
    <ContactSalon appointment={appointment} />
  </GuestShell>;
}

function GuestShell({ children, color }: { children: React.ReactNode; color?: string }) {
  return <main className="min-h-screen bg-slate-50 px-4 py-8"><section className="mx-auto max-w-2xl space-y-5 rounded-3xl bg-white p-5 shadow-sm sm:p-8" style={{ borderTop: `5px solid ${color || '#0f172a'}` }}>{children}</section></main>;
}

function BookingCard({ appointment }: { appointment: any }) {
  return <article className="rounded-2xl bg-slate-50 p-5">
    <h2 className="text-xl font-bold text-slate-900">{appointment.serviceName}</h2>
    <p className="mt-2 text-slate-700">{when(appointment.startTime, appointment.timezone)}</p>
    <p className="text-sm text-slate-500">{appointment.staffName} · {appointment.location}</p>
    <p className="mt-3 text-sm text-slate-600">Payment: {appointment.payment?.status}</p>
  </article>;
}

function ContactSalon({ appointment }: { appointment: any }) {
  const phone = appointment.salon?.contactPhone;
  return <p className="text-sm text-slate-600">Need help? {phone
    ? <>Call the salon on <a className="font-semibold text-violet-700 underline" href={`tel:${phone}`}>{phone}</a>.</>
    : 'Please contact the salon directly.'}</p>;
}

function ReschedulePage({ guest }: { guest: boolean }) {
  const { identifier, appointment, policy, error: loadError, reload } = useBooking(guest);
  const [date, setDate] = useState('');
  const [availability, setAvailability] = useState<CustomerRescheduleAvailabilityResponse>();
  const [selected, setSelected] = useState<Slot>();
  const [review, setReview] = useState(false);
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [availabilityError, setAvailabilityError] = useState('');
  const [success, setSuccess] = useState<any>();
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    if (appointment && !date) setDate(localDate(appointment.startTime, appointment.timezone));
  }, [appointment, date]);
  useEffect(() => {
    if (!identifier || !date || !policy?.canReschedule) return;
    setAvailability(undefined); setSelected(undefined); setReview(false); setError(''); setAvailabilityError('');
    const request = guest
      ? customerPortalProvider.getGuestRescheduleAvailability(identifier, date)
      : customerPortalProvider.getRescheduleAvailability(identifier, date);
    request.then(setAvailability).catch(() => setAvailabilityError('CUSTOMER_PORTAL_UNAVAILABLE'));
  }, [identifier, date, policy?.canReschedule, guest, availabilityAttempt]);

  if (loadError) return <PageShell guest={guest}><Notice kind="error">This booking is unavailable.</Notice></PageShell>;
  if (!appointment || !policy || !identifier) return <PageShell guest={guest}><Loading /></PageShell>;
  if (success) return <PageShell guest={guest}><Notice kind="success"><strong>Booking rescheduled.</strong><br />Your new appointment is {when(success.appointment.startTime, appointment.timezone)}.</Notice><BackLink guest={guest} identifier={identifier} /></PageShell>;
  if (!policy.canReschedule) return <PageShell guest={guest}><Notice>{policy.blockedReasons[0] || 'Online rescheduling is unavailable. Please contact the salon.'}</Notice><BackLink guest={guest} identifier={identifier} /></PageShell>;

  const confirm = async () => {
    if (!selected) return;
    setSubmitting(true); setError('');
    try {
      const input = { expectedAppointmentVersion: appointment.appointmentVersion, newStartTime: selected.startTime, staffReference: selected.staffReference, idempotencyKey };
      const result = guest
        ? await customerPortalProvider.rescheduleGuest(identifier, input)
        : await customerPortalProvider.reschedule(identifier, input);
      setSuccess(result);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : 'CUSTOMER_BOOKING_UPDATE_FAILED';
      if (code === 'CUSTOMER_BOOKING_STATE_CHANGED') await reload();
      if (code === 'CUSTOMER_BOOKING_SLOT_UNAVAILABLE') setAvailabilityAttempt((attempt) => attempt + 1);
      setError(code === 'CUSTOMER_BOOKING_STATE_CHANGED' ? 'The booking changed while you were viewing it. Details have been refreshed.'
        : code === 'CUSTOMER_BOOKING_SLOT_UNAVAILABLE' ? 'That time was just taken. Please select another slot.'
          : 'The booking could not be rescheduled. Please try again or contact the salon.');
      setReview(false);
    } finally { setSubmitting(false); }
  };

  return <PageShell guest={guest}>
    <h1 className="text-3xl font-black text-slate-900">Reschedule booking</h1>
    {!review ? <>
      <BookingCard appointment={appointment} />
      <label className="block text-sm font-semibold text-slate-700">Choose a date
        <input type="date" value={date} min={localDate(new Date().toISOString(), appointment.timezone)} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" />
      </label>
      {!availability && !availabilityError && <Loading />}
      {availability && availability.slots.length === 0 && <Notice>No available times were found for this date. Try another date or contact the salon.</Notice>}
      {availability && availability.slots.length > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {availability.slots.map((slot) => <button key={`${slot.startTime}-${slot.staffReference}`} onClick={() => setSelected(slot)} className={`rounded-xl border px-3 py-3 text-left text-sm ${selected === slot ? 'border-violet-600 bg-violet-50' : 'border-slate-200 bg-white'}`}>
          <span className="block font-bold">{new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: appointment.timezone }).format(new Date(slot.startTime))}</span>
          <span className="text-xs text-slate-500">{slot.staffName}{slot.isCurrentStaff ? ' · current' : ''}</span>
        </button>)}
      </div>}
      {availabilityError && <><Notice kind="error">The available times could not be loaded. No substitute availability has been shown.</Notice><button onClick={() => setAvailabilityAttempt((attempt) => attempt + 1)} className="w-full rounded-xl border px-5 py-3 font-bold">Retry availability</button></>}
      {error && <Notice kind="error">{error}</Notice>}
      <button disabled={!selected} onClick={() => setReview(true)} className="w-full rounded-xl bg-slate-900 px-5 py-3 font-bold text-white disabled:opacity-40">Review new time</button>
      <ContactSalon appointment={appointment} />
    </> : <>
      <h2 className="text-xl font-bold">Review your change</h2>
      <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-slate-500">Current</p><p className="mt-1">{when(appointment.startTime, appointment.timezone)}</p></div><div className="rounded-xl bg-violet-50 p-4"><p className="text-xs font-bold uppercase text-violet-600">Proposed</p><p className="mt-1">{when(selected!.startTime, appointment.timezone)}</p><p className="text-sm text-slate-600">{selected!.staffName}</p></div></div>
      <p className="text-sm text-slate-600">{appointment.serviceName} · Payment remains {appointment.payment.status}. {policy.depositPolicyMessage}</p>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid gap-2 sm:grid-cols-2"><button onClick={() => setReview(false)} className="rounded-xl border px-5 py-3 font-bold">Choose another time</button><button disabled={submitting} onClick={confirm} className="rounded-xl bg-violet-600 px-5 py-3 font-bold text-white disabled:opacity-50">{submitting ? 'Confirming...' : 'Confirm reschedule'}</button></div>
      <ContactSalon appointment={appointment} />
    </>}
  </PageShell>;
}

type ReasonCode = NonNullable<CustomerCancellationRequest['reasonCode']>;
const reasons: Array<{ value: ReasonCode; label: string }> = [
  { value: 'NO_LONGER_NEEDED', label: 'No longer needed' },
  { value: 'SCHEDULE_CONFLICT', label: 'Schedule conflict' },
  { value: 'UNWELL', label: 'Unwell' },
  { value: 'BOOKED_BY_MISTAKE', label: 'Booked by mistake' },
  { value: 'OTHER', label: 'Other' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' },
];

function CancellationPage({ guest }: { guest: boolean }) {
  const { identifier, appointment, policy, error: loadError, reload } = useBooking(guest);
  const [reasonCode, setReasonCode] = useState<ReasonCode | ''>('');
  const [reasonText, setReasonText] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<any>();
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  if (loadError) return <PageShell guest={guest}><Notice kind="error">This booking is unavailable.</Notice></PageShell>;
  if (!appointment || !policy || !identifier) return <PageShell guest={guest}><Loading /></PageShell>;
  if (success) return <PageShell guest={guest}><Notice kind="success"><strong>Booking cancelled.</strong><br />{success.paymentImpact.message}</Notice><BackLink guest={guest} identifier={identifier} /></PageShell>;
  if (!policy.canCancel) return <PageShell guest={guest}><Notice>{policy.blockedReasons[0] || 'Online cancellation is unavailable. Please contact the salon.'}</Notice><BackLink guest={guest} identifier={identifier} /></PageShell>;
  const submit = async () => {
    setSubmitting(true); setError('');
    try {
      const input = { expectedAppointmentVersion: appointment.appointmentVersion, reasonCode: reasonCode || undefined, reasonText: reasonCode === 'OTHER' && reasonText.trim() ? reasonText.trim() : undefined, idempotencyKey };
      const result = guest ? await customerPortalProvider.cancelGuest(identifier, input) : await customerPortalProvider.cancel(identifier, input);
      setSuccess(result);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : 'CUSTOMER_BOOKING_UPDATE_FAILED';
      if (code === 'CUSTOMER_BOOKING_STATE_CHANGED') await reload();
      setError(code === 'CUSTOMER_BOOKING_STATE_CHANGED' ? 'The booking changed while you were viewing it. Details have been refreshed.' : 'The booking could not be cancelled. Please try again or contact the salon.');
    } finally { setSubmitting(false); }
  };
  const reasonMissing = policy.requireCancellationReason && !reasonCode;
  return <PageShell guest={guest}>
    <h1 className="text-3xl font-black text-slate-900">Cancel booking</h1>
    <BookingCard appointment={appointment} />
    <Notice>{policy.paymentImpact.message}</Notice>
    <p className="text-sm text-slate-600">{policy.cancellationPolicyMessage}</p>
    <label className="block text-sm font-semibold text-slate-700">Reason {policy.requireCancellationReason ? '(required)' : '(optional)'}
      <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value as ReasonCode | '')} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3"><option value="">Select a reason</option>{reasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select>
    </label>
    {reasonCode === 'OTHER' && <label className="block text-sm font-semibold text-slate-700">Brief reason (optional)<textarea value={reasonText} maxLength={500} onChange={(event) => setReasonText(event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>}
    <label className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" /><span>I understand this will cancel the appointment and does not automatically issue a refund.</span></label>
    {error && <Notice kind="error">{error}</Notice>}
    <button disabled={!confirmed || reasonMissing || submitting} onClick={submit} className="w-full rounded-xl bg-red-700 px-5 py-3 font-bold text-white disabled:opacity-40">{submitting ? 'Cancelling...' : 'Confirm cancellation'}</button>
    <ContactSalon appointment={appointment} />
    <BackLink guest={guest} identifier={identifier} />
  </PageShell>;
}

function PageShell({ guest, children }: { guest: boolean; children: React.ReactNode }) {
  return guest ? <GuestShell>{children}</GuestShell> : <section className="mx-auto max-w-2xl space-y-5">{children}</section>;
}
function BackLink({ guest, identifier }: { guest: boolean; identifier: string }) {
  return <Link className="inline-block text-sm font-semibold text-violet-700 hover:underline" to={guest ? `/manage/${identifier}` : `/customer/appointments/${identifier}`}>Back to booking</Link>;
}

export function CustomerReschedulePage() { return <ReschedulePage guest={false} />; }
export function GuestReschedulePage() { return <ReschedulePage guest />; }
export function CustomerCancellationPage() { return <CancellationPage guest={false} />; }
export function GuestCancellationPage() { return <CancellationPage guest />; }
