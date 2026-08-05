import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  CheckCircle2,
  Clipboard,
  ExternalLink,
  Globe2,
  LockKeyhole,
  MapPin,
  Monitor,
  Palette,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  Tablet,
} from 'lucide-react';
import { BookingPageSlugSchema, type BookingChannel, type BookingPageResponse, type BookingPageUpdate } from '@ks-os/contracts';
import { getDataProvider } from '../../data/data-provider.js';
import { PublicBookingFlow } from '../../features/bookings/PublicBookingFlow.js';
import { BookingPoliciesModal } from './BookingPoliciesModal.js';

type PreviewWidth = 'desktop' | 'tablet' | 'mobile';
const previewWidths: Record<PreviewWidth, string> = { desktop: '100%', tablet: '768px', mobile: '390px' };
const minimumCustomerWindowDays = 42;

function sanitiseBookingSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+/, '').slice(0, 63);
}

function normalisePage(settings: BookingPageResponse): BookingPageResponse {
  const percentage = Number(settings.paymentSettings.depositPercentage);
  const fixedAmount = Number(settings.paymentSettings.depositFixedAmount);
  return {
    ...settings,
    bookingRules: {
      ...settings.bookingRules,
      maximumFutureDays: Math.max(minimumCustomerWindowDays, settings.bookingRules.maximumFutureDays || minimumCustomerWindowDays),
      enabledBookingChannels: settings.bookingRules.enabledBookingChannels?.length ? settings.bookingRules.enabledBookingChannels : ['in_shop'],
    },
    paymentSettings: {
      ...settings.paymentSettings,
      mode: settings.paymentSettings.mode === 'FULL' ? 'FULL' : 'DEPOSIT',
      depositType: settings.paymentSettings.depositType === 'FIXED' ? 'FIXED' : 'PERCENTAGE',
      depositPercentage: Number.isFinite(percentage) && percentage >= 1 && percentage <= 99 ? Math.round(percentage) : 20,
      depositFixedAmount: Number.isFinite(fixedAmount) && fixedAmount >= 1 ? Math.round(fixedAmount) : 1_000,
    },
  };
}

export function BookingPageSettings() {
  const [page, setPage] = useState<BookingPageResponse | null>(null);
  const [loadedSlug, setLoadedSlug] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [previewWidth, setPreviewWidth] = useState<PreviewWidth>('desktop');
  const [customDomain, setCustomDomain] = useState('');
  const [domainInstructions, setDomainInstructions] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [policiesOpen, setPoliciesOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const settings = normalisePage(await getDataProvider().getBookingPageSettings());
      setPage(settings);
      setLoadedSlug(settings.publicSlug);
      setCustomDomain(settings.customDomain || '');
      void getDataProvider().getBookingPageAnalytics(30).then(setAnalytics).catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Booking-page settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  if (loading) return <div aria-live="polite" className="h-96 animate-pulse rounded-3xl bg-slate-200"><span className="sr-only">Loading booking-page settings</span></div>;
  if (!page) return <div role="alert" className="rounded-2xl border border-rose-200 bg-white p-8"><h1 className="text-xl font-black">Booking-page settings unavailable</h1><p className="mt-2 text-sm text-slate-600">{error}</p><button onClick={() => void load()} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">Try again</button></div>;

  const update = <K extends keyof BookingPageResponse>(key: K, value: BookingPageResponse[K]) => setPage(current => current ? { ...current, [key]: value } : current);
  const slugResult = BookingPageSlugSchema.safeParse(page.publicSlug);
  const slugIsValid = slugResult.success;
  const slugChanged = page.publicSlug !== loadedSlug;
  const editableBookingUrl = `https://${page.publicSlug}.kasimshah.com/book`;
  const enabledChannels = page.bookingRules.enabledBookingChannels || ['in_shop'];

  const toggleChannel = (channel: BookingChannel, enabled: boolean) => {
    const next = enabled
      ? [...new Set([...enabledChannels, channel])]
      : enabledChannels.filter(item => item !== channel);
    if (!next.length) {
      setError('Keep at least one appointment type available.');
      return;
    }
    setError('');
    update('bookingRules', { ...page.bookingRules, enabledBookingChannels: next });
  };

  const save = async () => {
    setMessage('');
    setError('');
    const validatedSlug = BookingPageSlugSchema.safeParse(page.publicSlug);
    if (!validatedSlug.success) {
      setError(validatedSlug.error.issues[0]?.message || 'Enter a valid booking address.');
      return;
    }
    setSaving(true);
    const input: BookingPageUpdate = {
      publicSlug: validatedSlug.data,
      title: page.title,
      description: page.description,
      enabled: page.enabled,
      logoUrl: page.logoUrl,
      coverImageUrl: page.coverImageUrl,
      layout: page.layout,
      theme: page.theme,
      defaultLanguage: page.defaultLanguage,
      supportedLanguages: page.supportedLanguages,
      defaultLocationId: page.defaultLocationId,
      allowedLocationIds: page.allowedLocationIds,
      allowedServiceIds: page.allowedServiceIds,
      allowedStaffIds: page.allowedStaffIds,
      bookingRules: {
        ...page.bookingRules,
        maximumFutureDays: Math.max(minimumCustomerWindowDays, page.bookingRules.maximumFutureDays),
        enabledBookingChannels: enabledChannels.length ? enabledChannels : ['in_shop'],
      },
      paymentSettings: page.paymentSettings,
      intakeFormSettings: page.intakeFormSettings,
      cancellationSettings: page.cancellationSettings,
      seoSettings: page.seoSettings,
      analyticsSettings: page.analyticsSettings,
    };
    try {
      const saved = normalisePage(await getDataProvider().updateBookingPageSettings(input));
      setPage(saved);
      setLoadedSlug(saved.publicSlug);
      setMessage(slugChanged ? 'Booking address and settings saved.' : 'Booking-page settings saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = normalisePage(await getDataProvider().setBookingPagePublished(!page.published));
      setPage(saved);
      setMessage(saved.published ? 'Booking page published.' : 'Booking page unpublished.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Publication status could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  const saveDomain = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await getDataProvider().configureBookingCustomDomain(customDomain || null);
      setPage(normalisePage(result.page));
      setDomainInstructions(result.verification);
      setMessage(customDomain ? 'Domain saved. Complete DNS verification before it can receive traffic.' : 'Custom domain removed.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Custom domain could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const pageOverride = {
    logoUrl: page.logoUrl,
    theme: page.theme,
    paymentSettings: page.paymentSettings,
    cancellationSettings: page.cancellationSettings,
    bookingRules: page.bookingRules,
  };

  return <main className="space-y-5">
    <header className="flex flex-col justify-between gap-4 rounded-3xl bg-slate-950 p-6 text-white lg:flex-row lg:items-end">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-300">Online booking</p>
        <h1 className="mt-2 text-3xl font-black">Booking page and customer choices</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Control the public address, branding, appointment types, booking window and payment rules from one place.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setPoliciesOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-bold"><ReceiptText className="h-4 w-4" />Booking policies</button>
        <button onClick={() => navigator.clipboard.writeText(page.publicUrl).then(() => setMessage('Booking link copied.'))} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-bold"><Clipboard className="h-4 w-4" />Copy link</button>
        <a href={page.publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-bold"><ExternalLink className="h-4 w-4" />Open page</a>
        <button onClick={() => void publish()} disabled={saving} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-black">{page.published ? 'Unpublish' : 'Publish'}</button>
        <button onClick={() => void save()} disabled={saving || !slugIsValid} className="rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </header>

    {(message || error) && <p role={error ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{error || message}</p>}

    <section className="rounded-2xl border bg-white p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><p className="text-xs font-black uppercase text-slate-500">Platform booking URL</p>{slugChanged && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800">Unsaved change</span>}</div>
          <label htmlFor="booking-url-slug" className="sr-only">Booking address</label>
          <div className={`mt-2 flex flex-col overflow-hidden rounded-xl border bg-slate-50 font-mono text-sm font-bold focus-within:ring-2 sm:flex-row ${slugIsValid ? 'border-slate-300 focus-within:border-indigo-500 focus-within:ring-indigo-100' : 'border-rose-300 focus-within:ring-rose-100'}`}>
            <span className="px-3 pt-3 text-slate-500 sm:py-3 sm:pr-0">https://</span>
            <input id="booking-url-slug" value={page.publicSlug} onChange={event => update('publicSlug', sanitiseBookingSlug(event.target.value))} onBlur={() => update('publicSlug', page.publicSlug.replace(/-+$/, ''))} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" maxLength={63} aria-invalid={!slugIsValid} aria-describedby="booking-url-help" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-indigo-700 outline-none sm:px-1 sm:py-3" />
            <span className="break-all px-3 pb-3 text-slate-500 sm:py-3 sm:pl-0">.kasimshah.com/book</span>
          </div>
          <p id="booking-url-help" className={`mt-2 text-xs leading-5 ${slugIsValid ? 'text-slate-500' : 'font-bold text-rose-700'}`}>{slugIsValid ? 'Use lower-case letters, numbers and hyphens. Saving a new address keeps the previous booking link available for 12 months.' : slugResult.error?.issues[0]?.message || 'Enter a valid booking address.'}</p>
          {slugChanged && slugIsValid && <p className="mt-2 break-all text-xs font-bold text-indigo-700">New address: {editableBookingUrl}</p>}
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${page.published && page.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{page.published && page.enabled ? 'Live' : 'Not public'}</span>
      </div>
    </section>

    <div className="grid gap-5 2xl:grid-cols-[440px_minmax(0,1fr)]">
      <div className="space-y-5">
        <section className="rounded-2xl border bg-white p-5">
          <div className="flex items-start gap-3"><Palette className="mt-0.5 h-5 w-5 text-indigo-600" /><div><h2 className="text-lg font-black">Brand controls</h2><p className="mt-1 text-xs leading-5 text-slate-500">Logo and colour controls apply immediately to the live preview.</p></div></div>
          <div className="mt-5 grid gap-4">
            <label className="text-sm font-bold">Logo URL<input type="url" value={page.logoUrl || ''} onChange={event => update('logoUrl', event.target.value || null)} placeholder="https://…" className="mt-1 w-full rounded-xl border p-3" /></label>
            <div className="grid grid-cols-2 gap-4"><label className="text-sm font-bold">Primary colour<input type="color" value={page.theme.primaryColor} onChange={event => update('theme', { ...page.theme, primaryColor: event.target.value })} className="mt-1 h-12 w-full rounded-lg border p-1" /></label><label className="text-sm font-bold">Accent colour<input type="color" value={page.theme.accentColor} onChange={event => update('theme', { ...page.theme, accentColor: event.target.value })} className="mt-1 h-12 w-full rounded-lg border p-1" /></label></div>
            <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={page.enabled} onChange={event => update('enabled', event.target.checked)} />Accept bookings through the platform URL</label>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <div className="flex items-start gap-3"><MapPin className="mt-0.5 h-5 w-5 text-indigo-600" /><div><h2 className="text-lg font-black">Appointment types</h2><p className="mt-1 text-xs leading-5 text-slate-500">Only enabled appointment types appear to customers. When one type is enabled, the customer skips this choice entirely.</p></div></div>
          <div className="mt-4 grid gap-3">
            <ChannelToggle title="At the business" description="Customers visit one of your active locations." checked={enabledChannels.includes('in_shop')} onChange={checked => toggleChannel('in_shop', checked)} />
            <ChannelToggle title="Mobile appointments" description="Your team travels to the address supplied by the customer." checked={enabledChannels.includes('mobile')} onChange={checked => toggleChannel('mobile', checked)} />
          </div>
          <Link to="/app/settings/availability" className="mt-4 inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-black text-indigo-800">Set separate hours for each appointment type</Link>
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 text-indigo-600" /><div><h2 className="text-lg font-black">Booking and payment rules</h2><p className="mt-1 text-xs leading-5 text-slate-500">Customers can always browse at least six weeks of dates.</p></div></div>
          <div className="mt-5 grid grid-cols-2 gap-4">
            <label className="text-sm font-bold">Minimum notice (minutes)<input type="number" min={0} value={page.bookingRules.minimumNoticeMinutes} onChange={event => update('bookingRules', { ...page.bookingRules, minimumNoticeMinutes: Number(event.target.value) })} className="mt-1 w-full rounded-xl border p-3" /></label>
            <label className="text-sm font-bold">Future booking window (days)<input type="number" min={minimumCustomerWindowDays} max={730} value={page.bookingRules.maximumFutureDays} onChange={event => update('bookingRules', { ...page.bookingRules, maximumFutureDays: Math.max(minimumCustomerWindowDays, Number(event.target.value)) })} className="mt-1 w-full rounded-xl border p-3" /><span className="mt-1 block text-xs font-normal text-slate-500">Minimum 42 days.</span></label>
            <label className="text-sm font-bold">Payment for paid services<select value={page.paymentSettings.mode} onChange={event => update('paymentSettings', { ...page.paymentSettings, mode: event.target.value as BookingPageResponse['paymentSettings']['mode'] })} className="mt-1 w-full rounded-xl border bg-white p-3"><option value="DEPOSIT">Deposit first</option><option value="FULL">Full payment upfront</option></select><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Free services skip payment automatically. Paid services use Stripe before confirmation.</span></label>
            {page.paymentSettings.mode === 'DEPOSIT' && <>
              <label className="text-sm font-bold">Deposit calculation<select value={page.paymentSettings.depositType || 'PERCENTAGE'} onChange={event => update('paymentSettings', { ...page.paymentSettings, depositType: event.target.value as 'PERCENTAGE' | 'FIXED' })} className="mt-1 w-full rounded-xl border bg-white p-3"><option value="PERCENTAGE">Percentage of service price</option><option value="FIXED">Fixed amount in pounds</option></select><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Choose whether every service uses the same percentage or the same pound amount.</span></label>
              {(page.paymentSettings.depositType || 'PERCENTAGE') === 'PERCENTAGE'
                ? <label className="text-sm font-bold">Deposit percentage<input type="number" min={1} max={99} step={1} value={page.paymentSettings.depositPercentage} onChange={event => update('paymentSettings', { ...page.paymentSettings, depositPercentage: Number(event.target.value) })} className="mt-1 w-full rounded-xl border p-3" /><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Customers pay this percentage online and the balance at the appointment.</span></label>
                : <label className="text-sm font-bold">Fixed deposit (£)<input type="number" min={0.01} step={0.01} value={(page.paymentSettings.depositFixedAmount ?? 1_000) / 100} onChange={event => update('paymentSettings', { ...page.paymentSettings, depositFixedAmount: Math.max(1, Math.round(Number(event.target.value) * 100)) })} className="mt-1 w-full rounded-xl border p-3" /><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">For example, enter 10 for a £10 deposit. Cheaper services are capped at their full price.</span></label>}
            </>}
          </div>
          <label className="mt-4 block text-sm font-bold">Cancellation policy<textarea value={page.cancellationSettings.policyText} onChange={event => update('cancellationSettings', { ...page.cancellationSettings, policyText: event.target.value })} rows={3} className="mt-1 w-full rounded-xl border p-3" /></label>
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><div><p>Customer cancellation and rescheduling approval rules are managed here with the booking page.</p><button type="button" onClick={() => setPoliciesOpen(true)} className="mt-2 font-black text-indigo-700 underline">Open customer booking policies</button></div></div>
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <div className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-indigo-600" /><h2 className="text-lg font-black">Custom domain</h2></div>
          <p className="mt-1 text-xs text-slate-500">The platform URL stays available. A custom domain is never activated before DNS ownership and routing are verified.</p>
          <label className="mt-4 block text-sm font-bold">Booking domain<input value={customDomain} onChange={event => setCustomDomain(event.target.value.toLowerCase())} placeholder="book.example.com" className="mt-1 w-full rounded-xl border p-3" /></label>
          <button onClick={() => void saveDomain()} disabled={saving} className="mt-3 rounded-lg border px-4 py-2 text-sm font-bold">Save domain</button>
          {domainInstructions && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs"><p className="font-black">Add this {domainInstructions.type} record</p><p className="mt-2 break-all font-mono">Name: {domainInstructions.name}</p><p className="mt-1 break-all font-mono">Value: {domainInstructions.value}</p></div>}
          <p className="mt-3 text-xs font-bold text-slate-500">Status: {page.customDomainStatus.replaceAll('_', ' ')}</p>
        </section>

        {analytics && <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-black">Last 30 days</h2><div className="mt-3 grid grid-cols-3 gap-3"><div><p className="text-xs text-slate-500">Views</p><p className="text-2xl font-black">{analytics.counts.PAGE_VIEW || 0}</p></div><div><p className="text-xs text-slate-500">Bookings</p><p className="text-2xl font-black">{analytics.counts.BOOKING_COMPLETED || 0}</p></div><div><p className="text-xs text-slate-500">Conversion</p><p className="text-2xl font-black">{analytics.conversionRate}%</p></div></div></section>}
      </div>

      <section className="min-w-0 rounded-2xl border bg-slate-100 p-3">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-slate-500">Universal live preview</p><p className="text-sm text-slate-600">Interactions are isolated from booking creation.</p></div><div className="flex rounded-lg border bg-white p-1"><button onClick={() => setPreviewWidth('desktop')} aria-label="Desktop preview" aria-pressed={previewWidth === 'desktop'} className={`rounded-md p-2 ${previewWidth === 'desktop' ? 'bg-slate-900 text-white' : ''}`}><Monitor className="h-4 w-4" /></button><button onClick={() => setPreviewWidth('tablet')} aria-label="Tablet preview" aria-pressed={previewWidth === 'tablet'} className={`rounded-md p-2 ${previewWidth === 'tablet' ? 'bg-slate-900 text-white' : ''}`}><Tablet className="h-4 w-4" /></button><button onClick={() => setPreviewWidth('mobile')} aria-label="Mobile preview" aria-pressed={previewWidth === 'mobile'} className={`rounded-md p-2 ${previewWidth === 'mobile' ? 'bg-slate-900 text-white' : ''}`}><Smartphone className="h-4 w-4" /></button></div></header>
        <div className="mx-auto overflow-auto rounded-xl bg-slate-50 p-2 transition-all" style={{ maxWidth: previewWidths[previewWidth] }}><PublicBookingFlow slug={loadedSlug} preview pageOverride={pageOverride} /></div>
      </section>
    </div>

    <BookingPoliciesModal open={policiesOpen} onClose={() => setPoliciesOpen(false)} />
  </main>;
}

function ChannelToggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className={`flex cursor-pointer items-start justify-between gap-4 rounded-2xl border p-4 transition ${checked ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'}`}><span><span className="block text-sm font-black text-slate-950">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="mt-1 h-5 w-5 rounded" /></label>;
}

export default BookingPageSettings;
