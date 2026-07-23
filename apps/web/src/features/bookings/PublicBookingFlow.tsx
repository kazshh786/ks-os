import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format } from 'date-fns';
import { CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, MapPin, ShieldCheck, UserRound, Wallet } from 'lucide-react';
import type { BookingHoldResponse, BookingSource, CreateBookingResponse } from '@ks-os/contracts';
import { getDataProvider } from '../../data/data-provider.js';

type Catalog = {
  redirectSlug?: string | null;
  page?: { title: string; description: string; publicSlug: string; logoUrl: string | null; coverImageUrl: string | null; theme: Record<string, string>; paymentSettings: { mode: string; depositPercentage: number }; cancellationSettings: { policyText: string }; bookingRules: { allowAnyStaff: boolean } };
  tenant?: { name: string; timezone: string; currency: string; colors: { primary: string; secondary: string; accent: string } };
  tenantName?: string;
  services: Array<{ id: string; name: string; description: string | null; duration: number; price: number; requiresDeposit?: boolean }>;
  staff: Array<{ id: string; name: string; role?: string | null; accountRole?: 'owner' | 'staff'; imageUrl?: string | null; bio?: string | null; serviceIds?: string[] }>;
  locations?: Array<{ id: string; name: string; address: string; postcode: string; timezone: string; isPrimary: boolean }>;
  bookingChannels?: Array<{ id: 'in_shop' | 'mobile'; label: string }>;
  intakeForms?: Array<{ id: string; title: string; description: string; required: boolean; completionStage: string }>;
};

interface PublicBookingFlowProps {
  slug: string;
  preview?: boolean;
  pageOverride?: Record<string, any>;
  onBookingSuccess?: (booking: CreateBookingResponse['booking']) => void;
}

const steps = ['Choose', 'Time', 'Details', 'Review'] as const;

function trackedSource(): { source: BookingSource; sourceMedium?: string; sourceCampaign?: string } {
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get('utm_source') || '').toLowerCase();
  const sourceMap: Partial<Record<string, BookingSource>> = { instagram: 'INSTAGRAM', facebook: 'FACEBOOK', tiktok: 'TIKTOK', whatsapp: 'WHATSAPP', google: 'GOOGLE_BUSINESS_PROFILE', referral: 'REFERRAL' };
  const clean = (value: string | null, pattern: RegExp, max: number) => value && pattern.test(value) ? value.slice(0, max) : undefined;
  return { source: sourceMap[raw] || 'PUBLIC_BOOKING_PAGE', sourceMedium: clean(params.get('utm_medium'), /^[a-zA-Z0-9._-]+$/, 80), sourceCampaign: clean(params.get('utm_campaign'), /^[a-zA-Z0-9._ -]+$/, 120) };
}

export function PublicBookingFlow({ slug, preview = false, pageOverride, onBookingSuccess }: PublicBookingFlowProps) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(0);
  const [bookingChannel, setBookingChannel] = useState<'in_shop' | 'mobile'>('in_shop');
  const [locationId, setLocationId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('any');
  const [date, setDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [slot, setSlot] = useState<{ start: string; end: string; staffId: string; staffName: string; price: number; duration: number } | null>(null);
  const [slots, setSlots] = useState<Array<{ start: string; end: string; staffId: string; staffName: string; price: number; duration: number }>>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [hold, setHold] = useState<BookingHoldResponse | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressPostcode, setAddressPostcode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<CreateBookingResponse | null>(null);
  const analyticsSessionId = useRef(crypto.randomUUID());
  const idempotencyKey = useRef(crypto.randomUUID());
  const holdConsumed = useRef(false);

  const provider = getDataProvider();
  const tenant = catalog?.tenant || { name: catalog?.tenantName || 'Business', timezone: 'Europe/London', currency: 'GBP', colors: { primary: '#0f172a', secondary: '#475569', accent: '#4f46e5' } };
  const page = catalog?.page ? { ...catalog.page, ...pageOverride, theme: { ...catalog.page.theme, ...(pageOverride?.theme || {}) }, paymentSettings: { ...catalog.page.paymentSettings, ...(pageOverride?.paymentSettings || {}) }, cancellationSettings: { ...catalog.page.cancellationSettings, ...(pageOverride?.cancellationSettings || {}) }, bookingRules: { ...catalog.page.bookingRules, ...(pageOverride?.bookingRules || {}) } } : catalog?.page;
  const service = catalog?.services.find(item => item.id === serviceId);
  const eligibleStaff = useMemo(() => catalog?.staff.filter(member => !member.serviceIds?.length || member.serviceIds.includes(serviceId)) || [], [catalog, serviceId]);
  const location = catalog?.locations?.find(item => item.id === locationId);
  const selectedStaff = catalog?.staff.find(item => item.id === (slot?.staffId || staffId));
  const dates = Array.from({ length: 14 }, (_, index) => addDays(new Date(), index + 1));

  const track = (event: string, extra: Record<string, unknown> = {}) => {
    if (preview || typeof provider.recordPublicBookingEvent !== 'function') return;
    void provider.recordPublicBookingEvent(slug, { event, sessionId: analyticsSessionId.current, ...trackedSource(), ...extra });
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    provider.getPublicCatalog(slug).then((data: Catalog) => {
      if (!active) return;
      setCatalog(data);
      setLocationId(data.locations?.find(item => item.isPrimary)?.id || data.locations?.[0]?.id || '');
      setStaffId(data.staff.find(member => member.accountRole === 'owner')?.id || data.staff[0]?.id || 'any');
      setLoadError('');
      track('PAGE_VIEW');
      if (data.page) {
        document.title = data.page.title;
        const description = document.querySelector<HTMLMetaElement>('meta[name="description"]') || document.head.appendChild(document.createElement('meta'));
        description.name = 'description'; description.content = data.page.description || `Book an appointment with ${data.tenant?.name || ''}`;
      }
    }).catch(() => { if (active) setLoadError('Error loading this booking page. Please try again.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    if (!serviceId || !date) { setSlots([]); return; }
    let active = true;
    setSlotsLoading(true); setSlot(null);
    provider.getPublicAvailability(slug, { serviceId, staffId, date, bookingChannel, locationId: locationId || undefined })
      .then(result => { if (active) setSlots(result.slots); })
      .catch(() => { if (active) setSlots([]); })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [bookingChannel, date, locationId, serviceId, slug, staffId]);

  useEffect(() => {
    if (!hold) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((new Date(hold.expiresAt).getTime() - Date.now()) / 1_000)));
    update(); const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [hold]);

  useEffect(() => () => {
    if (hold && !holdConsumed.current) void provider.releaseBookingHold(slug, hold.id, hold.token);
  }, [hold, slug]);

  const chooseSlot = async (nextSlot: typeof slot) => {
    if (!nextSlot) return;
    setError('');
    if (hold) await provider.releaseBookingHold(slug, hold.id, hold.token).catch(() => undefined);
    try {
      const nextHold = preview ? { id: crypto.randomUUID(), token: 'preview-token-preview-token-preview-token', startTime: nextSlot.start, endTime: nextSlot.end, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), remainingSeconds: 600 } : await provider.createBookingHold(slug, { serviceId, staffId: nextSlot.staffId, locationId: locationId || null, startTime: nextSlot.start, bookingChannel, idempotencyKey: crypto.randomUUID() });
      setSlot(nextSlot); setHold(nextHold); setStep(2); track('TIME_SELECTED', { serviceId, staffId: nextSlot.staffId, locationId: locationId || undefined });
    } catch { setError('That time was just reserved by someone else. Choose another available time.'); setSlots(current => current.filter(item => item.start !== nextSlot.start || item.staffId !== nextSlot.staffId)); }
  };

  const submit = async () => {
    if (!service || !slot || !hold || !name || !email || !phone || (bookingChannel === 'mobile' && (!addressLine1 || !addressCity || !addressPostcode))) return;
    if (preview) { setError('Preview mode never creates a real booking.'); return; }
    if (remaining <= 0) { setError('Your slot reservation expired. Choose the time again.'); setStep(1); return; }
    setSubmitting(true); setError(''); track('CHECKOUT_STARTED', { serviceId, staffId: slot.staffId, locationId: locationId || undefined });
    try {
      const result = await provider.createPublicBooking(slug, {
        serviceId,
        staffId: slot.staffId,
        locationId: locationId || null,
        startTime: slot.start,
        client: { name, email, phone },
        bookingChannel,
        mobileAddress: bookingChannel === 'mobile' ? { line1: addressLine1, city: addressCity, postcode: addressPostcode } : null,
        paymentMode: page?.paymentSettings.mode === 'FULL' ? 'pay_now' : page?.paymentSettings.mode === 'DEPOSIT' ? 'deposit_required' : 'pay_later',
        payNow: page?.paymentSettings.mode === 'FULL' || page?.paymentSettings.mode === 'DEPOSIT',
        idempotencyKey: idempotencyKey.current,
        holdId: hold.id,
        holdToken: hold.token,
        source: trackedSource().source,
        sourceMedium: trackedSource().sourceMedium,
        sourceCampaign: trackedSource().sourceCampaign,
        intakeSubmissionIds: [],
        analyticsSessionId: analyticsSessionId.current,
        customerNotes: notes || undefined,
      });
      holdConsumed.current = true;
      if (result.payment.required && result.payment.checkoutUrl) { window.location.assign(result.payment.checkoutUrl); return; }
      setConfirmation(result); onBookingSuccess?.(result.booking);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      if (['SLOT_UNAVAILABLE','SLOT_HELD','HOLD_EXPIRED','HOLD_MISMATCH'].includes(message)) { setError('This slot is no longer available. No booking or duplicate payment was created.'); setStep(1); setHold(null); setSlot(null); }
      else setError('We could not confirm the booking. Your booking reference will only appear after a successful confirmation.');
    } finally { setSubmitting(false); }
  };

  if (loading) return <div className="mx-auto max-w-3xl rounded-3xl bg-white p-12 text-center font-bold text-slate-500" aria-live="polite">Loading booking page…</div>;
  if (loadError) return <div role="alert" className="mx-auto max-w-2xl rounded-3xl border border-rose-200 bg-white p-12 text-center"><h1 className="text-xl font-black">Booking page unavailable</h1><p className="mt-2 text-slate-600">{loadError}</p></div>;
  if (!catalog || catalog.services.length === 0) return <div className="mx-auto max-w-2xl rounded-3xl border bg-white p-12 text-center"><h1 className="text-xl font-black">No active services available</h1><p className="mt-2 text-slate-600">This business is not accepting online bookings yet.</p></div>;

  if (confirmation) return <main className="mx-auto max-w-2xl rounded-3xl border bg-white p-6 shadow-sm sm:p-10"><CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" /><h1 className="mt-4 text-center text-3xl font-black">Booking confirmed</h1><p className="mt-2 text-center text-slate-600">A confirmation and secure management link will be sent to {email}.</p><dl className="mt-8 grid gap-3 rounded-2xl bg-slate-50 p-5 text-sm"><div className="flex justify-between gap-4"><dt>Reference</dt><dd className="font-mono font-black">{confirmation.booking.reference}</dd></div><div className="flex justify-between gap-4"><dt>Service</dt><dd className="font-bold">{service?.name}</dd></div><div className="flex justify-between gap-4"><dt>Team member</dt><dd className="font-bold">{selectedStaff?.name}</dd></div><div className="flex justify-between gap-4"><dt>Date and time</dt><dd className="font-bold">{new Intl.DateTimeFormat('en-GB', { timeZone: tenant.timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(confirmation.booking.startTime))}</dd></div><div className="flex justify-between gap-4"><dt>Payment</dt><dd className="font-bold">{confirmation.payment.required ? confirmation.payment.status : 'Pay later / not required'}</dd></div></dl><p className="mt-5 text-sm text-slate-600">{page?.cancellationSettings.policyText || 'Use the secure link in your email if you need to reschedule or cancel.'}</p></main>;

  return <main className="mx-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl" style={{ '--booking-primary': page?.theme.primaryColor || tenant.colors.primary } as React.CSSProperties}>
    {page?.coverImageUrl && <img src={page.coverImageUrl} alt="" className="h-36 w-full object-cover" />}
    <header className="p-6 text-white sm:p-8" style={{ backgroundColor: page?.theme.primaryColor || tenant.colors.primary }}><div className="flex items-center gap-4">{page?.logoUrl && <img src={page.logoUrl} alt={`${tenant.name} logo`} className="h-14 w-14 rounded-xl bg-white object-contain p-1" />}<div><p className="text-xs font-bold uppercase tracking-[0.18em] opacity-80">Secure online booking</p><h1 className="mt-1 text-3xl font-black">{page?.title || tenant.name}</h1><p className="mt-1 max-w-2xl text-sm opacity-85">{page?.description || `Choose a service and time with ${tenant.name}.`}</p></div></div></header>
    <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="p-5 sm:p-8">
        <nav aria-label="Booking progress" className="mb-8"><ol className="grid grid-cols-4 gap-2">{steps.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={`border-b-4 pb-2 text-center text-xs font-black ${index <= step ? 'border-indigo-600 text-indigo-800' : 'border-slate-200 text-slate-400'}`}><span className="sr-only">Step {index + 1}: </span>{label}</li>)}</ol><p className="sr-only" aria-live="polite">Step {step + 1} of {steps.length}: {steps[step]}</p></nav>
      {step === 0 && <div className="space-y-7">{Boolean(catalog.bookingChannels && catalog.bookingChannels.length > 1) && <fieldset><legend className="text-lg font-black">Where should the appointment happen?</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">{catalog.bookingChannels!.map(channel => <button key={channel.id} onClick={() => { setBookingChannel(channel.id); setSlot(null); setHold(null); }} aria-pressed={bookingChannel === channel.id} className={`rounded-xl border p-4 text-left ${bookingChannel === channel.id ? 'border-indigo-500 bg-indigo-50' : ''}`}><MapPin className="h-5 w-5 text-indigo-600" /><p className="mt-2 font-black">{channel.label}</p><p className="text-xs text-slate-500">{channel.id === 'mobile' ? 'The team travels to the address you provide.' : 'Visit the business at your chosen location.'}</p></button>)}</div></fieldset>}{Boolean(catalog.locations?.length) && <fieldset><legend className="text-lg font-black">Choose a location</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">{catalog.locations!.map(item => <button key={item.id} onClick={() => setLocationId(item.id)} aria-pressed={locationId === item.id} className={`rounded-xl border p-4 text-left ${locationId === item.id ? 'border-indigo-500 bg-indigo-50' : ''}`}><MapPin className="h-5 w-5 text-indigo-600" /><p className="mt-2 font-black">{item.name}</p><p className="text-xs text-slate-500">{item.address}, {item.postcode}</p></button>)}</div></fieldset>}<fieldset><legend className="text-lg font-black">Choose a service</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">{catalog.services.map(item => <button key={item.id} onClick={() => { setServiceId(item.id); const owner = catalog.staff.find(member => member.accountRole === 'owner' && (!member.serviceIds?.length || member.serviceIds.includes(item.id))); setStaffId(owner?.id || catalog.staff[0]?.id || 'any'); track('SERVICE_SELECTED', { serviceId: item.id, locationId: locationId || undefined }); }} aria-pressed={serviceId === item.id} className={`rounded-xl border p-4 text-left ${serviceId === item.id ? 'border-indigo-500 bg-indigo-50' : ''}`}><div className="flex justify-between gap-3"><p className="font-black">{item.name}</p><p className="font-black">{new Intl.NumberFormat('en-GB', { style: 'currency', currency: tenant.currency }).format(item.price / 100)}</p></div><p className="mt-1 text-sm text-slate-500">{item.description}</p><p className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-slate-600"><Clock3 className="h-3.5 w-3.5" />{item.duration} minutes</p></button>)}</div></fieldset>{serviceId && <fieldset><legend className="text-lg font-black">Choose a team member</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">{eligibleStaff.map(member => <button key={member.id} onClick={() => { setStaffId(member.id); track('STAFF_SELECTED', { serviceId, staffId: member.id }); }} aria-pressed={staffId === member.id} className={`rounded-xl border p-4 text-left ${staffId === member.id ? 'border-indigo-500 bg-indigo-50' : ''}`}><p className="font-black">{member.name}{member.accountRole === 'owner' ? ' · Owner' : ''}</p><p className="text-xs text-slate-500">{member.role || 'Team member'}</p></button>)}{page?.bookingRules.allowAnyStaff !== false && <button onClick={() => setStaffId('any')} aria-pressed={staffId === 'any'} className={`rounded-xl border p-4 text-left ${staffId === 'any' ? 'border-indigo-500 bg-indigo-50' : ''}`}><UserRound className="h-5 w-5 text-indigo-600" /><p className="mt-2 font-black">Any available</p><p className="text-xs text-slate-500">Show the earliest times across the team.</p></button>}</div></fieldset>}<div className="flex justify-end"><button disabled={!serviceId || (!staffId && eligibleStaff.length > 0)} onClick={() => { setStep(1); track('BOOKING_STARTED', { serviceId, locationId: locationId || undefined }); }} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-black text-white disabled:opacity-40">Choose a time<ChevronRight className="h-4 w-4" /></button></div></div>}
        {step === 1 && <div><h2 className="text-2xl font-black">Choose a date and time</h2><p className="mt-1 text-sm text-slate-500">Times are shown in {tenant.timezone}. Your selection will be reserved briefly while you finish.</p><div className="mt-5 flex gap-2 overflow-x-auto pb-2">{dates.map(item => { const value = format(item, 'yyyy-MM-dd'); return <button key={value} onClick={() => { setDate(value); track('DATE_SELECTED', { serviceId, staffId: staffId === 'any' ? undefined : staffId }); }} aria-pressed={date === value} className={`min-w-20 rounded-xl border p-3 text-center ${date === value ? 'border-indigo-500 bg-indigo-50' : ''}`}><span className="block text-xs font-bold uppercase text-slate-500">{format(item, 'EEE')}</span><span className="mt-1 block text-xl font-black">{format(item, 'd')}</span><span className="block text-xs">{format(item, 'MMM')}</span></button>; })}</div>{slotsLoading ? <p className="mt-8 text-center text-sm font-bold text-slate-500">Checking live availability…</p> : slots.length ? <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">{slots.map(item => <button key={`${item.start}-${item.staffId}`} onClick={() => void chooseSlot(item)} className="min-h-12 rounded-xl border text-sm font-black hover:border-indigo-500 hover:bg-indigo-50">{new Intl.DateTimeFormat('en-GB', { timeZone: tenant.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(item.start))}<span className="block text-[10px] font-semibold text-slate-500">{item.staffName}</span></button>)}</div> : <div className="mt-8 rounded-2xl border border-dashed p-8 text-center"><CalendarDays className="mx-auto h-8 w-8 text-slate-400" /><h3 className="mt-3 font-black">No availability on this date</h3><p className="mt-1 text-sm text-slate-500">Try another date or choose “Any available” to see more options.</p></div>}<div className="mt-8"><button onClick={() => setStep(0)} className="inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-sm font-bold"><ChevronLeft className="h-4 w-4" />Back</button></div></div>}
        {step === 2 && <form onSubmit={event => { event.preventDefault(); setStep(3); }}><h2 className="text-2xl font-black">Your details</h2><p className="mt-1 text-sm text-slate-500">We only collect the details needed to manage this booking.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold sm:col-span-2">Full name<input required minLength={2} autoComplete="name" value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label><label className="text-sm font-bold">Email<input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label><label className="text-sm font-bold">Phone<input required type="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label>{bookingChannel === 'mobile' && <><label className="text-sm font-bold sm:col-span-2">Appointment address<input required autoComplete="address-line1" value={addressLine1} onChange={event => setAddressLine1(event.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label><label className="text-sm font-bold">Town or city<input required autoComplete="address-level2" value={addressCity} onChange={event => setAddressCity(event.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label><label className="text-sm font-bold">Postcode<input required autoComplete="postal-code" value={addressPostcode} onChange={event => setAddressPostcode(event.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label></>}<label className="text-sm font-bold sm:col-span-2">Notes for the business <span className="font-normal text-slate-500">(optional)</span><textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border p-3" /></label></div>{catalog.intakeForms?.length ? <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50 p-4"><h3 className="font-black">Intake forms</h3><p className="mt-1 text-sm text-slate-600">{catalog.intakeForms.map(form => form.title).join(', ')} will be sent securely after confirmation{catalog.intakeForms.some(form => form.required) ? ' and must be completed before the appointment' : ''}.</p></div> : null}<div className="mt-8 flex justify-between"><button type="button" onClick={() => setStep(1)} className="inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-sm font-bold"><ChevronLeft className="h-4 w-4" />Back</button><button className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-black text-white">Review booking<ChevronRight className="h-4 w-4" /></button></div></form>}
        {step === 3 && <div><h2 className="text-2xl font-black">Review and confirm</h2><dl className="mt-5 divide-y rounded-2xl border p-5 text-sm"><div className="flex justify-between gap-4 py-3"><dt>Service</dt><dd className="font-black">{service?.name}</dd></div><div className="flex justify-between gap-4 py-3"><dt>Team member</dt><dd className="font-black">{selectedStaff?.name}</dd></div><div className="flex justify-between gap-4 py-3"><dt>{bookingChannel === 'mobile' ? 'Appointment address' : 'Location'}</dt><dd className="text-right font-black">{bookingChannel === 'mobile' ? `${addressLine1}, ${addressCity}, ${addressPostcode}` : location?.name || 'Primary location'}</dd></div><div className="flex justify-between gap-4 py-3"><dt>Date and time</dt><dd className="text-right font-black">{slot && new Intl.DateTimeFormat('en-GB', { timeZone: tenant.timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(slot.start))}</dd></div><div className="flex justify-between gap-4 py-3"><dt>Duration</dt><dd className="font-black">{service?.duration} minutes</dd></div><div className="flex justify-between gap-4 py-3"><dt>Price</dt><dd className="font-black">{service && new Intl.NumberFormat('en-GB', { style: 'currency', currency: tenant.currency }).format(service.price / 100)}</dd></div></dl><div role="status" className={`mt-4 rounded-xl border p-3 text-sm font-bold ${remaining < 60 ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>This time is reserved for {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}.</div><div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" /><p>Price and availability are verified by the server. Repeated clicks use the same idempotency key and cannot create a duplicate booking.</p></div>{error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</p>}<div className="mt-8 flex justify-between"><button onClick={() => setStep(2)} className="inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-sm font-bold"><ChevronLeft className="h-4 w-4" />Back</button><button onClick={() => void submit()} disabled={submitting || remaining <= 0} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 font-black text-white disabled:opacity-40">{submitting ? 'Confirming safely…' : page?.paymentSettings.mode === 'FULL' || page?.paymentSettings.mode === 'DEPOSIT' ? 'Continue to payment' : 'Confirm booking'}<Check className="h-4 w-4" /></button></div></div>}
        {error && step !== 3 && <p role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</p>}
      </section>
      <aside className="border-t bg-slate-50 p-5 lg:border-l lg:border-t-0 sm:p-7"><h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Your booking</h2><div className="mt-4 space-y-4 text-sm">{service ? <div><p className="font-black">{service.name}</p><p className="text-slate-500">{service.duration} minutes</p></div> : <p className="text-slate-500">Choose a service to begin.</p>}{location && <p className="flex gap-2"><MapPin className="h-4 w-4 shrink-0 text-indigo-600" />{location.name}</p>}{slot && <p className="flex gap-2"><Clock3 className="h-4 w-4 shrink-0 text-indigo-600" />{new Intl.DateTimeFormat('en-GB', { timeZone: tenant.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(slot.start))}</p>}{selectedStaff && <p className="flex gap-2"><UserRound className="h-4 w-4 shrink-0 text-indigo-600" />{selectedStaff.name}</p>}{service && <p className="flex gap-2"><Wallet className="h-4 w-4 shrink-0 text-indigo-600" />{new Intl.NumberFormat('en-GB', { style: 'currency', currency: tenant.currency }).format(service.price / 100)}</p>}</div><div className="mt-8 border-t pt-5 text-xs text-slate-500"><p className="font-bold text-slate-700">Times shown in {tenant.timezone}</p><p className="mt-2">{page?.cancellationSettings.policyText || 'Cancellation and rescheduling rules are shown before confirmation and in your secure booking email.'}</p></div></aside>
    </div>
  </main>;
}
