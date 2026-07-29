import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { addDays, format } from 'date-fns';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  LockKeyhole,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wallet,
} from 'lucide-react';
import type { BookingHoldResponse, BookingSource, CreateBookingResponse } from '@ks-os/contracts';
import { getDataProvider } from '../../data/data-provider.js';

type BookingChannel = 'in_shop' | 'mobile';
type Catalog = {
  redirectSlug?: string | null;
  page?: {
    title: string;
    description: string;
    publicSlug: string;
    logoUrl: string | null;
    coverImageUrl: string | null;
    theme: Record<string, string>;
    paymentSettings: { mode: string; depositPercentage: number };
    cancellationSettings: { policyText: string };
    bookingRules: { allowAnyStaff: boolean; maximumFutureDays?: number; enabledBookingChannels?: BookingChannel[] };
  };
  tenant?: {
    name: string;
    timezone: string;
    currency: string;
    contactPhone?: string | null;
    contactEmail?: string | null;
    colors: { primary: string; secondary: string; accent: string };
  };
  tenantName?: string;
  services: Array<{
    id: string;
    publicReference?: string;
    name: string;
    description: string | null;
    duration: number;
    price: number;
    basePrice?: number;
    discount?: number | null;
    requiresDeposit?: boolean;
  }>;
  staff: Array<{
    id: string;
    publicReference?: string;
    name: string;
    role?: string | null;
    accountRole?: 'owner' | 'staff';
    imageUrl?: string | null;
    bio?: string | null;
    serviceIds?: string[];
  }>;
  locations?: Array<{
    id: string;
    publicReference?: string;
    name: string;
    address: string;
    postcode: string;
    timezone: string;
    isPrimary: boolean;
  }>;
  bookingChannels?: Array<{ id: BookingChannel; label: string }>;
  intakeForms?: Array<{
    id: string;
    title: string;
    description: string | null;
    required: boolean;
    completionStage: string;
    serviceId?: string | null;
    staffId?: string | null;
    locationId?: string | null;
  }>;
};

type Slot = { start: string; end: string; staffId: string; staffName: string; price: number; duration: number };
type ThemeVariables = CSSProperties & {
  '--booking-primary': string;
  '--booking-accent': string;
  '--booking-primary-soft': string;
  '--booking-primary-border': string;
  '--booking-primary-foreground': string;
};

export interface PublicBookingSuccessPayload {
  booking: CreateBookingResponse['booking'];
  customerName: string;
  customerEmail: string;
}

interface PublicBookingFlowProps {
  slug: string;
  preview?: boolean;
  pageOverride?: Record<string, any>;
  onBookingSuccess?: (payload: PublicBookingSuccessPayload) => void;
}

const steps = [
  { label: 'Service', shortLabel: 'Service' },
  { label: 'Date and time', shortLabel: 'Time' },
  { label: 'Your details', shortLabel: 'Details' },
  { label: 'Confirm', shortLabel: 'Confirm' },
] as const;
const minimumFutureDays = 42;
const dayMs = 86_400_000;
const calendarTimestamp = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const calendarText = (value: string) => value.replaceAll('\\', '\\\\').replaceAll(',', '\\,').replaceAll(';', '\\;').replaceAll('\n', '\\n');
const validatedPublicReference = (value: string | null) => value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
const localDate = (value: string) => new Date(`${value}T12:00:00`);

function trackedSource(): { source: BookingSource; sourceMedium?: string; sourceCampaign?: string } {
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get('utm_source') || '').toLowerCase();
  const sourceMap: Partial<Record<string, BookingSource>> = {
    instagram: 'INSTAGRAM', facebook: 'FACEBOOK', tiktok: 'TIKTOK', whatsapp: 'WHATSAPP', google: 'GOOGLE_BUSINESS_PROFILE', referral: 'REFERRAL',
  };
  const clean = (value: string | null, pattern: RegExp, max: number) => value && pattern.test(value) ? value.slice(0, max) : undefined;
  return {
    source: sourceMap[raw] || 'PUBLIC_BOOKING_PAGE',
    sourceMedium: clean(params.get('utm_medium'), /^[a-zA-Z0-9._-]+$/, 80),
    sourceCampaign: clean(params.get('campaign'), /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, 64) || clean(params.get('utm_campaign'), /^[a-zA-Z0-9._ -]+$/, 120),
  };
}

function normaliseHex(value: string | undefined, fallback: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}
function rgba(hex: string, alpha: number) {
  const value = normaliseHex(hex, '#111827').slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
function contrastText(hex: string) {
  const value = normaliseHex(hex, '#111827').slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.62 ? '#0f172a' : '#ffffff';
}
function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'KS';
}
function hourInTimezone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  return Number(parts.find(part => part.type === 'hour')?.value || 0);
}

function BookingButton({ children, disabled, onClick, type = 'button', primary, className = '' }: { children: ReactNode; disabled?: boolean; onClick?: () => void; type?: 'button' | 'submit'; primary: string; className?: string }) {
  return <button type={type} disabled={disabled} onClick={onClick} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-black shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 ${className}`} style={{ backgroundColor: primary, color: contrastText(primary) }}>{children}</button>;
}
function ChoiceCard({ selected, onClick, primary, ariaLabel, children, className = '' }: { selected: boolean; onClick: () => void; primary: string; ariaLabel: string; children: ReactNode; className?: string }) {
  return <button type="button" onClick={onClick} aria-label={ariaLabel} aria-pressed={selected} className={`group relative w-full rounded-2xl border bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 ${className}`} style={selected ? { borderColor: primary, backgroundColor: rgba(primary, 0.055), boxShadow: `0 0 0 1px ${rgba(primary, 0.14)}` } : undefined}>{selected && <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full" style={{ backgroundColor: primary, color: contrastText(primary) }}><Check className="h-3.5 w-3.5" /></span>}{children}</button>;
}
function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p><h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p></div>;
}
function TrustStrip({ primary }: { primary: string }) {
  const items = [{ icon: CalendarDays, label: 'Live availability' }, { icon: LockKeyhole, label: 'Secure details' }, { icon: CheckCircle2, label: 'Instant confirmation' }];
  return <div className="grid grid-cols-3 gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6">{items.map(item => <div key={item.label} className="flex items-center justify-center gap-1.5 text-center text-[10px] font-black text-slate-600 sm:text-xs"><item.icon className="h-3.5 w-3.5 shrink-0" style={{ color: primary }} /><span>{item.label}</span></div>)}</div>;
}

export function PublicBookingFlow({ slug, preview = false, pageOverride, onBookingSuccess }: PublicBookingFlowProps) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(0);
  const [bookingChannel, setBookingChannel] = useState<BookingChannel>('in_shop');
  const [locationId, setLocationId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('any');
  const [date, setDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [slot, setSlot] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [hold, setHold] = useState<BookingHoldResponse | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressPostcode, setAddressPostcode] = useState('');
  const [accessNotes, setAccessNotes] = useState('');
  const [paymentChoice, setPaymentChoice] = useState<'pay_later' | 'pay_now' | 'deposit_required'>('pay_later');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<CreateBookingResponse | null>(null);
  const analyticsSessionId = useRef(crypto.randomUUID());
  const idempotencyKey = useRef(crypto.randomUUID());
  const holdConsumed = useRef(false);

  const provider = getDataProvider();
  const tenant = catalog?.tenant || { name: catalog?.tenantName || 'Business', timezone: 'Europe/London', currency: 'GBP', contactPhone: null, contactEmail: null, colors: { primary: '#111827', secondary: '#475569', accent: '#4f46e5' } };
  const page = catalog?.page ? {
    ...catalog.page,
    ...pageOverride,
    theme: { ...catalog.page.theme, ...(pageOverride?.theme || {}) },
    paymentSettings: { ...catalog.page.paymentSettings, ...(pageOverride?.paymentSettings || {}) },
    cancellationSettings: { ...catalog.page.cancellationSettings, ...(pageOverride?.cancellationSettings || {}) },
    bookingRules: { ...catalog.page.bookingRules, ...(pageOverride?.bookingRules || {}) },
  } : catalog?.page;
  const primary = normaliseHex(page?.theme.primaryColor || tenant.colors.primary, '#111827');
  const accent = normaliseHex(page?.theme.accentColor || tenant.colors.accent, primary);
  const themeVariables: ThemeVariables = { '--booking-primary': primary, '--booking-accent': accent, '--booking-primary-soft': rgba(primary, 0.07), '--booking-primary-border': rgba(primary, 0.22), '--booking-primary-foreground': contrastText(primary) };
  const service = catalog?.services.find(item => item.id === serviceId);
  const eligibleStaff = useMemo(() => catalog?.staff.filter(member => !member.serviceIds?.length || member.serviceIds.includes(serviceId)) || [], [catalog, serviceId]);
  const location = catalog?.locations?.find(item => item.id === locationId);
  const selectedStaff = catalog?.staff.find(item => item.id === (slot?.staffId || staffId));
  const relevantIntakeForms = useMemo(() => catalog?.intakeForms?.filter(form => (!form.serviceId || form.serviceId === serviceId) && (!form.staffId || form.staffId === slot?.staffId) && (!form.locationId || form.locationId === locationId)) || [], [catalog?.intakeForms, locationId, serviceId, slot?.staffId]);
  const maximumFutureDays = Math.max(minimumFutureDays, Math.min(730, page?.bookingRules.maximumFutureDays || minimumFutureDays));
  const firstBookableDate = addDays(new Date(), 1);
  const selectedOffset = Math.max(0, Math.min(maximumFutureDays - 1, Math.round((localDate(date).getTime() - localDate(format(firstBookableDate, 'yyyy-MM-dd')).getTime()) / dayMs)));
  const weekIndex = Math.floor(selectedOffset / 7);
  const maximumWeekIndex = Math.floor((maximumFutureDays - 1) / 7);
  const weekStartOffset = weekIndex * 7;
  const dates = Array.from({ length: Math.min(7, maximumFutureDays - weekStartOffset) }, (_, index) => addDays(firstBookableDate, weekStartOffset + index));
  const dateMinimum = format(firstBookableDate, 'yyyy-MM-dd');
  const dateMaximum = format(addDays(firstBookableDate, maximumFutureDays - 1), 'yyyy-MM-dd');
  const visibleChannels = (catalog?.bookingChannels || []).filter(channel => (page?.bookingRules.enabledBookingChannels?.length ? page.bookingRules.enabledBookingChannels : ['in_shop']).includes(channel.id));
  const effectivePaymentMode = service?.requiresDeposit ? 'deposit_required' : page?.paymentSettings.mode === 'FULL' ? 'pay_now' : page?.paymentSettings.mode === 'DEPOSIT' ? 'deposit_required' : page?.paymentSettings.mode === 'CUSTOMER_CHOICE' ? paymentChoice : 'pay_later';
  const depositPercentage = Math.min(100, Math.max(0, page?.paymentSettings.depositPercentage || 0));
  const quotedPrice = slot?.price ?? service?.price ?? 0;
  const amountDueNow = effectivePaymentMode === 'deposit_required' ? Math.ceil(quotedPrice * (depositPercentage > 0 ? depositPercentage : 100) / 100) : effectivePaymentMode === 'pay_now' ? quotedPrice : 0;
  const currency = (amount: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: tenant.currency }).format(amount / 100);
  const dateTime = (value: string, dateStyle: 'medium' | 'full' = 'full') => new Intl.DateTimeFormat('en-GB', { timeZone: tenant.timezone, dateStyle, timeStyle: 'short' }).format(new Date(value));
  const timeOnly = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tenant.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  const slotGroups = useMemo(() => {
    const groups: Array<{ label: string; slots: Slot[] }> = [{ label: 'Morning', slots: [] }, { label: 'Afternoon', slots: [] }, { label: 'Evening', slots: [] }];
    slots.forEach(item => { const hour = hourInTimezone(item.start, tenant.timezone); groups[hour < 12 ? 0 : hour < 17 ? 1 : 2].slots.push(item); });
    return groups.filter(group => group.slots.length > 0);
  }, [slots, tenant.timezone]);

  const calendarHref = confirmation && service ? `data:text/calendar;charset=utf-8,${encodeURIComponent(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KS OS//Booking//EN', 'BEGIN:VEVENT', `UID:${confirmation.booking.reference}@ks-os`, `DTSTAMP:${calendarTimestamp(new Date().toISOString())}`, `DTSTART:${calendarTimestamp(confirmation.booking.startTime)}`, `DTEND:${calendarTimestamp(confirmation.booking.endTime)}`, `SUMMARY:${calendarText(`${service.name} at ${tenant.name}`)}`, `LOCATION:${calendarText(bookingChannel === 'mobile' ? `${addressLine1}, ${addressCity}, ${addressPostcode}` : `${location?.address || ''} ${location?.postcode || ''}`.trim())}`, `DESCRIPTION:${calendarText(`Booking reference ${confirmation.booking.reference}`)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'))}` : '';
  const track = (event: string, extra: Record<string, unknown> = {}) => { if (!preview && typeof provider.recordPublicBookingEvent === 'function') void provider.recordPublicBookingEvent(slug, { event, sessionId: analyticsSessionId.current, ...trackedSource(), ...extra }); };

  useEffect(() => {
    let active = true;
    setLoading(true);
    provider.getPublicCatalog(slug).then((data: Catalog) => {
      if (!active) return;
      const params = new URLSearchParams(window.location.search);
      const requestedService = validatedPublicReference(params.get('service'));
      const requestedLocation = validatedPublicReference(params.get('location'));
      const requestedStaff = validatedPublicReference(params.get('staff'));
      const preselectedService = data.services.find(item => item.publicReference === requestedService);
      const preselectedLocation = data.locations?.find(item => item.publicReference === requestedLocation);
      const preselectedStaff = data.staff.find(item => item.publicReference === requestedStaff);
      const channels = data.page?.bookingRules.enabledBookingChannels?.length ? data.page.bookingRules.enabledBookingChannels : ['in_shop'];
      setCatalog(data);
      setBookingChannel(channels[0]);
      setServiceId(preselectedService?.id || '');
      setLocationId(preselectedLocation?.id || data.locations?.find(item => item.isPrimary)?.id || data.locations?.[0]?.id || '');
      setStaffId(preselectedStaff?.id || (data.page?.bookingRules.allowAnyStaff !== false ? 'any' : data.staff.find(member => member.accountRole === 'owner')?.id || data.staff[0]?.id || ''));
      setLoadError('');
      track('PAGE_VIEW');
      const businessName = data.tenant?.name || data.tenantName || 'Business';
      document.title = `Book an appointment with ${businessName}`;
      const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]') || document.head.appendChild(document.createElement('meta'));
      meta.name = 'description';
      meta.content = `Choose a service and live appointment time with ${businessName}.`;
    }).catch(() => { if (active) setLoadError('Error loading this booking page. Please try again.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    if (!serviceId || !date) { setSlots([]); return; }
    let active = true;
    setSlotsLoading(true);
    setSlot(null);
    provider.getPublicAvailability(slug, { serviceId, staffId, date, bookingChannel, locationId: locationId || undefined }).then(result => { if (active) setSlots(result.slots); }).catch(() => { if (active) setSlots([]); }).finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [bookingChannel, date, locationId, serviceId, slug, staffId]);
  useEffect(() => { if (!hold) return; const update = () => setRemaining(Math.max(0, Math.ceil((new Date(hold.expiresAt).getTime() - Date.now()) / 1_000))); update(); const timer = window.setInterval(update, 1_000); return () => window.clearInterval(timer); }, [hold]);
  useEffect(() => () => { if (hold && !holdConsumed.current) void provider.releaseBookingHold(slug, hold.id, hold.token); }, [hold, slug]);

  const releaseCurrentHold = () => { if (hold && !holdConsumed.current) void provider.releaseBookingHold(slug, hold.id, hold.token).catch(() => undefined); setHold(null); setSlot(null); setRemaining(0); };
  const moveWeek = (direction: -1 | 1) => {
    const nextWeek = Math.max(0, Math.min(maximumWeekIndex, weekIndex + direction));
    setDate(format(addDays(firstBookableDate, nextWeek * 7), 'yyyy-MM-dd'));
    setError('');
  };
  const chooseSlot = async (nextSlot: Slot) => {
    setError('');
    if (hold) await provider.releaseBookingHold(slug, hold.id, hold.token).catch(() => undefined);
    try {
      const nextHold = preview ? { id: crypto.randomUUID(), token: 'preview-token-preview-token-preview-token', startTime: nextSlot.start, endTime: nextSlot.end, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), remainingSeconds: 600 } : await provider.createBookingHold(slug, { serviceId, staffId: nextSlot.staffId, locationId: locationId || null, startTime: nextSlot.start, bookingChannel, idempotencyKey: crypto.randomUUID() });
      setSlot(nextSlot); setHold(nextHold); setStep(2); track('TIME_SELECTED', { serviceId, staffId: nextSlot.staffId, locationId: locationId || undefined }); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch { setError('That time was just reserved by someone else. Choose another available time.'); setSlots(current => current.filter(item => item.start !== nextSlot.start || item.staffId !== nextSlot.staffId)); }
  };
  const submit = async () => {
    if (!service || !slot || !hold || !name || !email || !phone || (bookingChannel === 'mobile' && (!addressLine1 || !addressCity || !addressPostcode))) return;
    if (preview) { setError('Preview mode never creates a real booking.'); return; }
    if (remaining <= 0) { setError('Your slot reservation expired. Choose the time again.'); setStep(1); return; }
    setSubmitting(true); setError(''); track('CHECKOUT_STARTED', { serviceId, staffId: slot.staffId, locationId: locationId || undefined });
    try {
      const result = await provider.createPublicBooking(slug, { serviceId, staffId: slot.staffId, locationId: locationId || null, startTime: slot.start, client: { name, email, phone }, bookingChannel, mobileAddress: bookingChannel === 'mobile' ? { line1: addressLine1, line2: addressLine2 || null, city: addressCity, postcode: addressPostcode, accessNotes: accessNotes || null } : null, paymentMode: effectivePaymentMode, payNow: effectivePaymentMode !== 'pay_later', idempotencyKey: idempotencyKey.current, holdId: hold.id, holdToken: hold.token, source: trackedSource().source, sourceMedium: trackedSource().sourceMedium, sourceCampaign: trackedSource().sourceCampaign, intakeSubmissionIds: [], analyticsSessionId: analyticsSessionId.current, customerNotes: notes || undefined });
      holdConsumed.current = true;
      if (result.payment.required && result.payment.checkoutUrl) { track('PAYMENT_REDIRECTED', { amount: result.payment.amount, currency: tenant.currency }); window.location.assign(result.payment.checkoutUrl); return; }
      setConfirmation(result); onBookingSuccess?.({ booking: result.booking, customerName: name.trim(), customerEmail: email.trim() }); track('BOOKING_COMPLETED', { bookingReference: result.booking.reference });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      if (['SLOT_UNAVAILABLE', 'SLOT_HELD', 'HOLD_EXPIRED', 'HOLD_MISMATCH'].includes(message)) { setError('This slot is no longer available. No booking or duplicate payment was created.'); setStep(1); setHold(null); setSlot(null); }
      else setError('We could not confirm the booking. Your booking reference will only appear after a successful confirmation.');
    } finally { setSubmitting(false); }
  };

  if (loading) return <div className="mx-auto max-w-3xl rounded-[2rem] border border-white/80 bg-white/90 p-12 text-center shadow-xl shadow-slate-200/60 backdrop-blur" aria-live="polite"><div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" /><p className="mt-5 font-black text-slate-700">Loading live availability…</p></div>;
  if (loadError) return <div role="alert" className="mx-auto max-w-2xl rounded-[2rem] border border-rose-200 bg-white p-10 text-center shadow-xl"><h1 className="text-2xl font-black text-slate-950">Booking page unavailable</h1><p className="mt-3 text-slate-600">{loadError}</p></div>;
  if (!catalog || catalog.services.length === 0) return <div className="mx-auto max-w-2xl rounded-[2rem] border border-slate-200 bg-white p-10 text-center shadow-xl"><CalendarDays className="mx-auto h-10 w-10 text-slate-400" /><h1 className="mt-4 text-2xl font-black text-slate-950">No active services available</h1><p className="mt-2 text-slate-600">This business is not accepting online bookings yet.</p></div>;

  if (confirmation) return <main className="mx-auto max-w-3xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl shadow-slate-200/70" style={themeVariables}>
    <div className="px-6 py-10 text-center sm:px-10"><div className="mx-auto grid h-20 w-20 place-items-center rounded-full" style={{ backgroundColor: rgba(primary, 0.09) }}><CheckCircle2 className="h-11 w-11" style={{ color: primary }} /></div><p className="mt-5 text-xs font-black uppercase tracking-[0.18em]" style={{ color: primary }}>Booking confirmed</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">You’re all set, {name.split(' ')[0] || name}</h1><p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">A confirmation and secure reschedule or cancellation link will be sent to {email}.</p>
      <dl className="mx-auto mt-8 grid max-w-xl gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-5 text-left text-sm"><div className="flex justify-between gap-4"><dt className="text-slate-500">Reference</dt><dd className="font-mono font-black text-slate-950">{confirmation.booking.reference}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Service</dt><dd className="font-black text-slate-950">{service?.name}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Team member</dt><dd className="font-black text-slate-950">{selectedStaff?.name}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Location</dt><dd className="text-right font-black text-slate-950">{bookingChannel === 'mobile' ? `${addressLine1}, ${addressCity}, ${addressPostcode}` : location?.name || 'Primary location'}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Date and time</dt><dd className="text-right font-black text-slate-950">{dateTime(confirmation.booking.startTime)}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Payment</dt><dd className="font-black text-slate-950">{confirmation.payment.required ? `${confirmation.payment.status} · ${currency(confirmation.payment.amount)}` : 'Pay later / not required'}</dd></div></dl>
      <div className="mx-auto mt-5 grid max-w-xl gap-3 sm:grid-cols-2"><a href={calendarHref} download={`booking-${confirmation.booking.reference}.ics`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black shadow-sm" style={{ backgroundColor: primary, color: contrastText(primary) }}><CalendarPlus className="h-4 w-4" />Add to calendar</a>{tenant.contactPhone ? <a href={`tel:${tenant.contactPhone}`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800"><Phone className="h-4 w-4" />Contact {tenant.name}</a> : tenant.contactEmail ? <a href={`mailto:${tenant.contactEmail}`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800"><Mail className="h-4 w-4" />Contact {tenant.name}</a> : null}</div><p className="mx-auto mt-6 max-w-xl text-sm leading-6 text-slate-600">{page?.cancellationSettings.policyText || 'Use the secure link in your email if you need to reschedule or cancel.'}</p>
    </div><TrustStrip primary={primary} />
  </main>;

  const canContinueFromService = Boolean(serviceId && staffId && eligibleStaff.length > 0);
  const primaryActionLabel = amountDueNow > 0 ? `Continue to secure payment · ${currency(amountDueNow)}` : 'Confirm booking';

  return <main className="mx-auto w-full max-w-6xl" style={themeVariables}><div className="overflow-hidden rounded-[2rem] border border-white/90 bg-white shadow-2xl shadow-slate-300/50 ring-1 ring-slate-200/70">
    <header className="relative overflow-hidden border-b border-slate-200 bg-white px-5 py-5 sm:px-8 sm:py-6"><div className="pointer-events-none absolute -right-12 -top-20 h-44 w-44 rounded-full blur-3xl" style={{ backgroundColor: rgba(primary, 0.14) }} /><div className="relative flex flex-wrap items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3.5">{page?.logoUrl ? <img src={page.logoUrl} alt={`${tenant.name} logo`} className="h-12 w-12 shrink-0 rounded-2xl border border-slate-200 bg-white object-contain p-1.5 shadow-sm sm:h-14 sm:w-14" /> : <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-sm font-black shadow-sm sm:h-14 sm:w-14" style={{ backgroundColor: primary, color: contrastText(primary) }}>{initials(tenant.name)}</div>}<div className="min-w-0"><p className="truncate text-lg font-black tracking-tight text-slate-950 sm:text-xl">{tenant.name}</p><p className="mt-0.5 text-xs font-bold text-slate-500">Secure online booking</p></div></div><div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-600"><LockKeyhole className="h-3.5 w-3.5" style={{ color: primary }} />No account required</div></div></header>
    <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]"><section className="min-w-0 px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
      <nav aria-label="Booking progress" className="mb-8"><ol className="grid grid-cols-4 gap-2 sm:gap-4">{steps.map((item, index) => { const active = index === step; const complete = index < step; return <li key={item.label} aria-current={active ? 'step' : undefined}><div className="flex items-center gap-2 sm:gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-black transition" style={active || complete ? { borderColor: primary, backgroundColor: complete ? primary : rgba(primary, 0.09), color: complete ? contrastText(primary) : primary } : undefined}>{complete ? <Check className="h-4 w-4" /> : index + 1}</span><span className={`hidden text-xs font-black sm:block ${active ? 'text-slate-950' : complete ? 'text-slate-700' : 'text-slate-400'}`}>{item.label}</span><span className={`text-[10px] font-black sm:hidden ${active ? 'text-slate-950' : complete ? 'text-slate-700' : 'text-slate-400'}`}>{item.shortLabel}</span></div><div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full transition-all" style={{ width: index <= step ? '100%' : '0%', backgroundColor: primary }} /></div></li>; })}</ol><p className="sr-only" aria-live="polite">Step {step + 1} of {steps.length}: {steps[step].label}</p></nav>
      {service && <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:hidden"><div className="min-w-0"><p className="truncate text-sm font-black text-slate-950">{service.name}</p><p className="mt-1 text-xs text-slate-500">{slot ? dateTime(slot.start, 'medium') : `${service.duration} minutes`}</p></div><p className="shrink-0 text-sm font-black text-slate-950">{currency(quotedPrice)}</p></div>}

      {step === 0 && <div className="space-y-8"><SectionHeading eyebrow="Step 1" title={`Book with ${tenant.name}`} description="Choose what you need. You’ll see live availability before entering any personal details." />
        {visibleChannels.length > 1 && <fieldset><legend className="text-sm font-black text-slate-950">Where should the appointment happen?</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">{visibleChannels.map(channel => <ChoiceCard key={channel.id} selected={bookingChannel === channel.id} onClick={() => { releaseCurrentHold(); setBookingChannel(channel.id); }} primary={primary} ariaLabel={`${channel.label}. ${channel.id === 'mobile' ? 'The team travels to your address.' : 'Visit the business.'}`}><MapPin className="h-5 w-5" style={{ color: primary }} /><p className="mt-3 pr-7 font-black text-slate-950">{channel.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{channel.id === 'mobile' ? 'The team travels to the address you provide.' : 'Visit the business at your chosen location.'}</p></ChoiceCard>)}</div></fieldset>}
        {catalog.locations && catalog.locations.length > 1 && bookingChannel === 'in_shop' && <fieldset><legend className="text-sm font-black text-slate-950">Choose a location</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">{catalog.locations.map(item => <ChoiceCard key={item.id} selected={locationId === item.id} onClick={() => { releaseCurrentHold(); setLocationId(item.id); }} primary={primary} ariaLabel={`${item.name}, ${item.address}, ${item.postcode}`}><MapPin className="h-5 w-5" style={{ color: primary }} /><p className="mt-3 pr-7 font-black text-slate-950">{item.name}</p><p className="mt-1 text-xs leading-5 text-slate-500">{item.address}, {item.postcode}</p></ChoiceCard>)}</div></fieldset>}
        <fieldset><legend className="text-sm font-black text-slate-950">Choose a service</legend><div className="mt-3 grid gap-3">{catalog.services.map(item => { const discounted = Boolean(item.discount && item.basePrice && item.basePrice > item.price); return <ChoiceCard key={item.id} selected={serviceId === item.id} onClick={() => { releaseCurrentHold(); setServiceId(item.id); setStaffId(page?.bookingRules.allowAnyStaff !== false ? 'any' : catalog.staff.find(member => member.accountRole === 'owner' && (!member.serviceIds?.length || member.serviceIds.includes(item.id)))?.id || catalog.staff[0]?.id || ''); setPaymentChoice(item.requiresDeposit ? 'deposit_required' : 'pay_later'); track('SERVICE_SELECTED', { serviceId: item.id, locationId: locationId || undefined }); }} primary={primary} ariaLabel={`${item.name}, ${item.duration} minutes, ${currency(item.price)}`} className="sm:p-5"><div className="flex items-start justify-between gap-4 pr-7"><div className="min-w-0"><p className="font-black text-slate-950 sm:text-lg">{item.name}</p><p className="mt-1 text-sm leading-6 text-slate-500">{item.description || 'Choose this service to see available appointment times.'}</p></div><div className="shrink-0 text-right">{discounted && <p className="text-xs font-bold text-slate-400 line-through">{currency(item.basePrice || item.price)}</p>}<p className="font-black text-slate-950 sm:text-lg">{currency(item.price)}</p></div></div><div className="mt-4 flex flex-wrap gap-2 text-xs font-black text-slate-600"><span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1"><Clock3 className="h-3.5 w-3.5" />{item.duration} minutes</span>{item.requiresDeposit && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-900">Deposit required</span>}{discounted && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">Discount applied</span>}</div></ChoiceCard>; })}</div></fieldset>
        {serviceId && <fieldset><legend className="text-sm font-black text-slate-950">Choose who you book with</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">{page?.bookingRules.allowAnyStaff !== false && <ChoiceCard selected={staffId === 'any'} onClick={() => { releaseCurrentHold(); setStaffId('any'); }} primary={primary} ariaLabel="Anyone available. Show the earliest times across the eligible team."><div className="grid h-10 w-10 place-items-center rounded-full" style={{ backgroundColor: rgba(primary, 0.1) }}><Sparkles className="h-5 w-5" style={{ color: primary }} /></div><p className="mt-3 pr-7 font-black text-slate-950">Anyone available</p><p className="mt-1 text-xs leading-5 text-slate-500">Best for finding the earliest appointment.</p></ChoiceCard>}{eligibleStaff.map(member => <ChoiceCard key={member.id} selected={staffId === member.id} onClick={() => { releaseCurrentHold(); setStaffId(member.id); track('STAFF_SELECTED', { serviceId, staffId: member.id }); }} primary={primary} ariaLabel={`${member.name}, ${member.role || 'Team member'}`}><div className="flex items-center gap-3 pr-7">{member.imageUrl ? <img src={member.imageUrl} alt="" className="h-10 w-10 rounded-full object-cover" /> : <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-xs font-black text-slate-700">{initials(member.name)}</div>}<div><p className="font-black text-slate-950">{member.name}{member.accountRole === 'owner' ? ' · Owner' : ''}</p><p className="mt-0.5 text-xs text-slate-500">{member.role || 'Team member'}</p></div></div></ChoiceCard>)}</div></fieldset>}
        <div className="sticky bottom-0 z-20 -mx-5 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:-mx-8 sm:px-8 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0"><BookingButton primary={primary} disabled={!canContinueFromService} onClick={() => { setStep(1); track('BOOKING_STARTED', { serviceId, locationId: locationId || undefined }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="w-full sm:ml-auto sm:w-auto">See available times <ArrowRight className="h-4 w-4" /></BookingButton></div>
      </div>}

      {step === 1 && <div><SectionHeading eyebrow="Step 2" title="Choose a date and time" description={`Browse up to ${maximumFutureDays} days ahead. All times are live and shown in ${tenant.timezone}.`} />
        <div className="mt-6 grid items-end gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[auto_minmax(180px,1fr)_auto]"><button type="button" disabled={weekIndex === 0} onClick={() => moveWeek(-1)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border bg-white px-3 text-sm font-black disabled:opacity-35"><ChevronLeft className="h-4 w-4" />Previous week</button><label className="text-xs font-black text-slate-600">Jump to a date<input aria-label="Choose an appointment date" type="date" min={dateMinimum} max={dateMaximum} value={date} onChange={event => { setDate(event.target.value); setError(''); track('DATE_SELECTED', { serviceId, staffId: staffId === 'any' ? undefined : staffId }); }} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-950" /></label><button type="button" disabled={weekIndex >= maximumWeekIndex} onClick={() => moveWeek(1)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border bg-white px-3 text-sm font-black disabled:opacity-35">Next week<ChevronRight className="h-4 w-4" /></button></div>
        <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7">{dates.map(item => { const value = format(item, 'yyyy-MM-dd'); const selected = date === value; return <button type="button" key={value} onClick={() => { setDate(value); setError(''); track('DATE_SELECTED', { serviceId, staffId: staffId === 'any' ? undefined : staffId }); }} aria-pressed={selected} className="rounded-2xl border bg-white p-3 text-center transition hover:border-slate-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900" style={selected ? { borderColor: primary, backgroundColor: rgba(primary, 0.06), boxShadow: `0 0 0 1px ${rgba(primary, 0.14)}` } : undefined}><span className="block text-[10px] font-black uppercase tracking-wide text-slate-500">{format(item, 'EEE')}</span><span className="mt-1 block text-xl font-black text-slate-950">{format(item, 'd')}</span><span className="block text-xs font-bold text-slate-500">{format(item, 'MMM')}</span></button>; })}</div>
        {slotsLoading ? <div className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center"><div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-slate-200" style={{ borderTopColor: primary }} /><p className="mt-4 text-sm font-black text-slate-600">Checking live availability…</p></div> : slotGroups.length ? <div className="mt-7 space-y-7">{slotGroups.map(group => <section key={group.label}><h3 className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{group.label}</h3><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">{group.slots.map(item => <button type="button" key={`${item.start}-${item.staffId}`} onClick={() => void chooseSlot(item)} className="min-h-14 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-950 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900" onMouseEnter={event => { event.currentTarget.style.borderColor = primary; event.currentTarget.style.backgroundColor = rgba(primary, 0.045); }} onMouseLeave={event => { event.currentTarget.style.borderColor = ''; event.currentTarget.style.backgroundColor = ''; }}>{timeOnly(item.start)}<span className="mt-0.5 block truncate text-[10px] font-bold text-slate-500">{item.staffName}</span></button>)}</div></section>)}</div> : <div className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><CalendarDays className="mx-auto h-9 w-9 text-slate-400" /><h3 className="mt-3 font-black text-slate-950">No availability on this date</h3><p className="mt-1 text-sm text-slate-500">Try another date or choose “Anyone available” to see more options.</p></div>}
        {error && <p role="alert" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">{error}</p>}<div className="sticky bottom-0 z-20 -mx-5 mt-8 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:-mx-8 sm:px-8 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0"><button type="button" onClick={() => { setStep(0); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="inline-flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Back</button></div>
      </div>}

      {step === 2 && <form onSubmit={event => { event.preventDefault(); setStep(3); setError(''); track('DETAILS_COMPLETED', { serviceId }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><SectionHeading eyebrow="Step 3" title="Tell us who’s booking" description="We only collect the details needed to manage your appointment and send confirmation." /><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-black text-slate-800 sm:col-span-2">Full name<input required minLength={2} autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder="Your full name" className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100" /></label><label className="text-sm font-black text-slate-800">Email address<input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100" /></label><label className="text-sm font-black text-slate-800">Phone number<input required type="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="Your contact number" className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100" /></label>{bookingChannel === 'mobile' && <><label className="text-sm font-black text-slate-800 sm:col-span-2">Address line 1<input required autoComplete="address-line1" value={addressLine1} onChange={event => setAddressLine1(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm font-semibold outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100" /></label><label className="text-sm font-black text-slate-800 sm:col-span-2">Address line 2 <span className="font-medium text-slate-400">(optional)</span><input autoComplete="address-line2" value={addressLine2} onChange={event => setAddressLine2(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm font-semibold outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100" /></label><label className="text-sm font-black text-slate-800">Town or city<input required autoComplete="address-level2" value={addressCity} onChange={event => setAddressCity(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm font-semibold outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100" /></label><label className="text-sm font-black text-slate-800">Postcode<input required autoComplete="postal-code" value={addressPostcode} onChange={event => setAddressPostcode(event.target.value.toUpperCase())} className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm font-semibold uppercase outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100" /></label><label className="text-sm font-black text-slate-800 sm:col-span-2">Access or parking notes <span className="font-medium text-slate-400">(optional)</span><textarea value={accessNotes} onChange={event => setAccessNotes(event.target.value)} rows={2} className="mt-2 w-full rounded-2xl border border-slate-200 p-4 text-sm font-semibold outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100" /></label></>}<label className="text-sm font-black text-slate-800 sm:col-span-2">Notes or special requests <span className="font-medium text-slate-400">(optional)</span><textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} placeholder="Anything the team should know?" className="mt-2 w-full rounded-2xl border border-slate-200 p-4 text-sm font-semibold outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100" /></label></div>
        {relevantIntakeForms.length > 0 && <div className="mt-6 rounded-2xl border p-4" style={{ borderColor: rgba(primary, 0.2), backgroundColor: rgba(primary, 0.045) }}><div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" style={{ color: primary }} /><div><h3 className="font-black text-slate-950">Forms for this appointment</h3><ul className="mt-2 space-y-2 text-sm text-slate-700">{relevantIntakeForms.map(form => <li key={form.id}><span className="font-black">{form.title}</span>{form.required ? ' · Required before your appointment' : ' · Optional'}{form.description && <span className="block text-xs text-slate-500">{form.description}</span>}</li>)}</ul><p className="mt-3 text-xs text-slate-600">Secure form links are created with the booking and sent to your email.</p></div></div></div>}
        <div className="sticky bottom-0 z-20 -mx-5 mt-8 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:-mx-8 sm:px-8 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0"><button type="button" onClick={() => { setStep(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="inline-flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Back</button><BookingButton type="submit" primary={primary}>Review booking <ArrowRight className="h-4 w-4" /></BookingButton></div>
      </form>}

      {step === 3 && <div><SectionHeading eyebrow="Step 4" title="Review and confirm" description="Check the details below. Nothing is booked or charged until you confirm." />{page?.paymentSettings.mode === 'CUSTOMER_CHOICE' && !service?.requiresDeposit && <fieldset className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-5"><legend className="px-2 text-sm font-black text-slate-950">How would you like to pay?</legend><div className="grid gap-3 sm:grid-cols-2"><ChoiceCard selected={paymentChoice === 'pay_now'} onClick={() => setPaymentChoice('pay_now')} primary={primary} ariaLabel="Pay now securely online"><CreditCard className="h-5 w-5" style={{ color: primary }} /><p className="mt-3 pr-7 font-black text-slate-950">Pay now</p><p className="mt-1 text-xs leading-5 text-slate-500">Complete payment using Stripe’s secure checkout.</p></ChoiceCard><ChoiceCard selected={paymentChoice === 'pay_later'} onClick={() => setPaymentChoice('pay_later')} primary={primary} ariaLabel="Pay later directly to the business"><Wallet className="h-5 w-5" style={{ color: primary }} /><p className="mt-3 pr-7 font-black text-slate-950">Pay later</p><p className="mt-1 text-xs leading-5 text-slate-500">Pay directly to the business.</p></ChoiceCard>{depositPercentage > 0 && <ChoiceCard selected={paymentChoice === 'deposit_required'} onClick={() => setPaymentChoice('deposit_required')} primary={primary} ariaLabel={`Pay a ${depositPercentage}% deposit`} className="sm:col-span-2"><ShieldCheck className="h-5 w-5" style={{ color: primary }} /><p className="mt-3 pr-7 font-black text-slate-950">Pay a {depositPercentage}% deposit</p><p className="mt-1 text-xs leading-5 text-slate-500">Secure the booking now and pay the balance later.</p></ChoiceCard>}</div></fieldset>}
        <dl className="mt-6 divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200 bg-white text-sm"><div className="flex justify-between gap-4 px-5 py-4"><dt className="text-slate-500">Service</dt><dd className="text-right font-black text-slate-950">{service?.name}</dd></div><div className="flex justify-between gap-4 px-5 py-4"><dt className="text-slate-500">Team member</dt><dd className="text-right font-black text-slate-950">{selectedStaff?.name}</dd></div><div className="flex justify-between gap-4 px-5 py-4"><dt className="text-slate-500">{bookingChannel === 'mobile' ? 'Appointment address' : 'Location'}</dt><dd className="max-w-[65%] text-right font-black text-slate-950">{bookingChannel === 'mobile' ? [addressLine1, addressLine2, addressCity, addressPostcode].filter(Boolean).join(', ') : location?.name || 'Primary location'}</dd></div><div className="flex justify-between gap-4 px-5 py-4"><dt className="text-slate-500">Date and time</dt><dd className="max-w-[65%] text-right font-black text-slate-950">{slot && dateTime(slot.start)}</dd></div><div className="flex justify-between gap-4 px-5 py-4"><dt className="text-slate-500">Duration</dt><dd className="font-black text-slate-950">{slot?.duration || service?.duration} minutes</dd></div><div className="flex justify-between gap-4 px-5 py-4"><dt className="text-slate-500">Total</dt><dd className="font-black text-slate-950">{currency(quotedPrice)}</dd></div><div className="flex justify-between gap-4 bg-slate-50 px-5 py-4"><dt className="font-black text-slate-700">{effectivePaymentMode === 'deposit_required' ? `Deposit due now${depositPercentage > 0 ? ` (${depositPercentage}%)` : ''}` : 'Payment due now'}</dt><dd className="font-black text-slate-950">{amountDueNow > 0 ? currency(amountDueNow) : 'Pay later'}</dd></div></dl>
        <div role="status" className={`mt-4 flex items-center gap-3 rounded-2xl border p-4 text-sm font-black ${remaining < 60 ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}><Clock3 className="h-5 w-5 shrink-0" /><span>This time is reserved for {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}.</span></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-3 text-xs font-black text-slate-600"><ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />Server-verified availability</div><div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-3 text-xs font-black text-slate-600"><LockKeyhole className="h-4 w-4 shrink-0 text-emerald-600" />Secure personal details</div><div className="flex items-center gap-2 rounded-2xl bg-slate-50 p-3 text-xs font-black text-slate-600"><CreditCard className="h-4 w-4 shrink-0 text-emerald-600" />Stripe secure checkout</div></div>{error && <p role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">{error}</p>}<div className="sticky bottom-0 z-20 -mx-5 mt-8 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:-mx-8 sm:px-8 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0"><button type="button" onClick={() => { setStep(2); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="inline-flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Back</button><BookingButton primary={primary} disabled={submitting || remaining <= 0} onClick={() => void submit()} className="min-w-0 flex-1 sm:flex-none">{submitting ? 'Confirming safely…' : primaryActionLabel}{amountDueNow > 0 ? <CreditCard className="h-4 w-4" /> : <Check className="h-4 w-4" />}</BookingButton></div>
      </div>}
    </section>

    <aside className="border-t border-slate-200 bg-slate-50/70 p-5 sm:p-7 lg:border-l lg:border-t-0 lg:p-8"><div className="lg:sticky lg:top-8"><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Your booking</p><h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">Everything at a glance</h2><div className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="space-y-5 p-5 text-sm">{service ? <div><p className="font-black text-slate-950">{service.name}</p><p className="mt-1 text-slate-500">{slot?.duration || service.duration} minutes</p></div> : <p className="text-slate-500">Choose a service to begin.</p>}{bookingChannel === 'in_shop' && location && <p className="flex gap-2.5 text-slate-700"><MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: primary }} /><span>{location.name}</span></p>}{bookingChannel === 'mobile' && <p className="flex gap-2.5 text-slate-700"><Smartphone className="mt-0.5 h-4 w-4 shrink-0" style={{ color: primary }} /><span>Mobile appointment</span></p>}{slot && <p className="flex gap-2.5 text-slate-700"><Clock3 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: primary }} /><span>{dateTime(slot.start, 'medium')}</span></p>}{selectedStaff && <p className="flex gap-2.5 text-slate-700"><UserRound className="mt-0.5 h-4 w-4 shrink-0" style={{ color: primary }} /><span>{selectedStaff.name}</span></p>}{service && <div className="border-t border-slate-100 pt-4"><div className="flex items-end justify-between gap-4"><span className="text-xs font-black uppercase tracking-wide text-slate-500">Total</span><span className="text-xl font-black text-slate-950">{currency(quotedPrice)}</span></div><p className="mt-2 rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-600">{effectivePaymentMode === 'pay_later' ? 'Pay later' : effectivePaymentMode === 'deposit_required' ? `Deposit due now: ${currency(amountDueNow)}` : 'Secure payment due after confirmation'}</p></div>}</div><TrustStrip primary={primary} /></div><div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5"><div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" style={{ color: primary }} /><div><p className="text-sm font-black text-slate-950">Book with confidence</p><p className="mt-1 text-xs leading-5 text-slate-500">Availability, pricing and staff timing are verified by the booking system before confirmation.</p></div></div></div><div className="mt-5 text-xs leading-5 text-slate-500"><p className="font-black text-slate-700">Times shown in {tenant.timezone}</p><p className="mt-2">{page?.cancellationSettings.policyText || 'Cancellation and rescheduling rules are shown before confirmation and in your secure booking email.'}</p></div></div></aside>
    </div>
  </div></main>;
}
