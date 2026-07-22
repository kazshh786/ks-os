import { useEffect, useState } from 'react';
import { CheckCircle2, Clipboard, ExternalLink, Globe2, Monitor, Smartphone, Tablet, UploadCloud } from 'lucide-react';
import type { BookingPageResponse, BookingPageUpdate } from '@ks-os/contracts';
import { getDataProvider } from '../../data/data-provider.js';
import { PublicBookingFlow } from '../../features/bookings/PublicBookingFlow.js';

type PreviewWidth = 'desktop' | 'tablet' | 'mobile';
const previewWidths: Record<PreviewWidth, string> = { desktop: '100%', tablet: '768px', mobile: '390px' };

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

  const load = async () => {
    setLoading(true); setError('');
    try {
      const settings = await getDataProvider().getBookingPageSettings();
      setPage(settings); setLoadedSlug(settings.publicSlug); setCustomDomain(settings.customDomain || '');
      void getDataProvider().getBookingPageAnalytics(30).then(setAnalytics).catch(() => undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Booking-page settings could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  if (loading) return <div aria-live="polite" className="h-96 animate-pulse rounded-3xl bg-slate-200"><span className="sr-only">Loading booking-page settings</span></div>;
  if (!page) return <div role="alert" className="rounded-2xl border border-rose-200 bg-white p-8"><h1 className="text-xl font-black">Booking-page settings unavailable</h1><p className="mt-2 text-sm text-slate-600">{error}</p><button onClick={() => void load()} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">Try again</button></div>;

  const update = <K extends keyof BookingPageResponse>(key: K, value: BookingPageResponse[K]) => setPage(current => current ? { ...current, [key]: value } : current);
  const save = async () => {
    setSaving(true); setMessage(''); setError('');
    const input: BookingPageUpdate = {
      publicSlug: page.publicSlug,
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
      bookingRules: page.bookingRules,
      paymentSettings: page.paymentSettings,
      intakeFormSettings: page.intakeFormSettings,
      cancellationSettings: page.cancellationSettings,
      seoSettings: page.seoSettings,
      analyticsSettings: page.analyticsSettings,
    };
    try { const saved = await getDataProvider().updateBookingPageSettings(input); setPage(saved); setLoadedSlug(saved.publicSlug); setMessage('Booking-page settings saved.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Settings could not be saved.'); }
    finally { setSaving(false); }
  };
  const publish = async () => {
    setSaving(true); setError('');
    try { const saved = await getDataProvider().setBookingPagePublished(!page.published); setPage(saved); setMessage(saved.published ? 'Booking page published.' : 'Booking page unpublished.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Publication status could not be changed.'); }
    finally { setSaving(false); }
  };
  const saveDomain = async () => {
    setSaving(true); setError('');
    try { const result = await getDataProvider().configureBookingCustomDomain(customDomain || null); setPage(result.page); setDomainInstructions(result.verification); setMessage(customDomain ? 'Domain saved. Complete DNS verification before it can receive traffic.' : 'Custom domain removed.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Custom domain could not be saved.'); }
    finally { setSaving(false); }
  };

  const pageOverride = { title: page.title, description: page.description, logoUrl: page.logoUrl, coverImageUrl: page.coverImageUrl, theme: page.theme, paymentSettings: page.paymentSettings, cancellationSettings: page.cancellationSettings, bookingRules: page.bookingRules };

  return <main className="space-y-5">
    <header className="flex flex-col justify-between gap-4 rounded-3xl bg-slate-950 p-6 text-white lg:flex-row lg:items-end"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-300">Online booking</p><h1 className="mt-2 text-3xl font-black">Public booking page</h1><p className="mt-2 max-w-2xl text-sm text-slate-300">Every business has a platform URL automatically. Preview uses the real customer components and never creates bookings.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => navigator.clipboard.writeText(page.publicUrl).then(() => setMessage('Booking link copied.'))} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-bold"><Clipboard className="h-4 w-4" />Copy link</button><a href={page.publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-bold"><ExternalLink className="h-4 w-4" />Open page</a><button onClick={() => void publish()} disabled={saving} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-black">{page.published ? 'Unpublish' : 'Publish'}</button><button onClick={() => void save()} disabled={saving} className="rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950">{saving ? 'Saving…' : 'Save changes'}</button></div></header>
    {(message || error) && <p role={error ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{error || message}</p>}
    <section className="rounded-2xl border bg-white p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="text-xs font-black uppercase text-slate-500">Platform booking URL</p><p className="mt-1 break-all font-mono text-sm font-bold text-indigo-700">{page.publicUrl}</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-black ${page.published && page.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{page.published && page.enabled ? 'Live' : 'Not public'}</span></div></div></section>
    <div className="grid gap-5 2xl:grid-cols-[440px_minmax(0,1fr)]">
      <div className="space-y-5">
        <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-black">Page identity</h2><div className="mt-4 grid gap-4"><label className="text-sm font-bold">Page title<input value={page.title} onChange={event => update('title', event.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label><label className="text-sm font-bold">Description<textarea value={page.description} onChange={event => update('description', event.target.value)} rows={3} className="mt-1 w-full rounded-xl border p-3" /></label><label className="text-sm font-bold">Public slug<div className="mt-1 flex items-center rounded-xl border bg-slate-50"><span className="pl-3 text-xs text-slate-500">/book/</span><input value={page.publicSlug} onChange={event => update('publicSlug', event.target.value.toLowerCase())} className="min-w-0 flex-1 bg-transparent p-3 font-mono text-sm" /></div></label><label className="text-sm font-bold">Logo URL<input type="url" value={page.logoUrl || ''} onChange={event => update('logoUrl', event.target.value || null)} placeholder="https://…" className="mt-1 w-full rounded-xl border p-3" /></label><label className="text-sm font-bold">Cover image URL<input type="url" value={page.coverImageUrl || ''} onChange={event => update('coverImageUrl', event.target.value || null)} placeholder="https://…" className="mt-1 w-full rounded-xl border p-3" /></label><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={page.enabled} onChange={event => update('enabled', event.target.checked)} />Accept bookings through the platform URL</label></div></section>
        <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-black">Brand and layout</h2><div className="mt-4 grid grid-cols-2 gap-4"><label className="text-sm font-bold">Primary colour<input type="color" value={page.theme.primaryColor} onChange={event => update('theme', { ...page.theme, primaryColor: event.target.value })} className="mt-1 h-12 w-full rounded-lg border p-1" /></label><label className="text-sm font-bold">Accent colour<input type="color" value={page.theme.accentColor} onChange={event => update('theme', { ...page.theme, accentColor: event.target.value })} className="mt-1 h-12 w-full rounded-lg border p-1" /></label><label className="text-sm font-bold">Layout<select value={page.layout} onChange={event => update('layout', event.target.value as BookingPageResponse['layout'])} className="mt-1 w-full rounded-xl border bg-white p-3"><option value="STANDARD">Standard</option><option value="COMPACT">Compact</option><option value="EDITORIAL">Editorial</option></select></label><label className="text-sm font-bold">Corners<select value={page.theme.borderRadius} onChange={event => update('theme', { ...page.theme, borderRadius: event.target.value as BookingPageResponse['theme']['borderRadius'] })} className="mt-1 w-full rounded-xl border bg-white p-3"><option value="compact">Compact</option><option value="medium">Medium</option><option value="rounded">Rounded</option></select></label></div></section>
        <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-black">Booking rules</h2><div className="mt-4 grid grid-cols-2 gap-4"><label className="text-sm font-bold">Minimum notice (minutes)<input type="number" min={0} value={page.bookingRules.minimumNoticeMinutes} onChange={event => update('bookingRules', { ...page.bookingRules, minimumNoticeMinutes: Number(event.target.value) })} className="mt-1 w-full rounded-xl border p-3" /></label><label className="text-sm font-bold">Future window (days)<input type="number" min={1} max={730} value={page.bookingRules.maximumFutureDays} onChange={event => update('bookingRules', { ...page.bookingRules, maximumFutureDays: Number(event.target.value) })} className="mt-1 w-full rounded-xl border p-3" /></label><label className="text-sm font-bold">Payment requirement<select value={page.paymentSettings.mode} onChange={event => update('paymentSettings', { ...page.paymentSettings, mode: event.target.value as BookingPageResponse['paymentSettings']['mode'] })} className="mt-1 w-full rounded-xl border bg-white p-3"><option value="NONE">No payment</option><option value="PAY_LATER">Pay later</option><option value="DEPOSIT">Deposit</option><option value="FULL">Full payment</option><option value="CUSTOMER_CHOICE">Customer choice</option></select></label><label className="text-sm font-bold">Deposit %<input type="number" min={0} max={100} value={page.paymentSettings.depositPercentage} onChange={event => update('paymentSettings', { ...page.paymentSettings, depositPercentage: Number(event.target.value) })} className="mt-1 w-full rounded-xl border p-3" /></label></div><label className="mt-4 block text-sm font-bold">Cancellation policy<textarea value={page.cancellationSettings.policyText} onChange={event => update('cancellationSettings', { ...page.cancellationSettings, policyText: event.target.value })} rows={3} className="mt-1 w-full rounded-xl border p-3" /></label></section>
        <section className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-indigo-600" /><h2 className="text-lg font-black">Custom domain</h2></div><p className="mt-1 text-xs text-slate-500">The platform URL stays available. A custom domain is never activated before DNS ownership and routing are verified.</p><label className="mt-4 block text-sm font-bold">Booking domain<input value={customDomain} onChange={event => setCustomDomain(event.target.value.toLowerCase())} placeholder="book.example.com" className="mt-1 w-full rounded-xl border p-3" /></label><button onClick={() => void saveDomain()} disabled={saving} className="mt-3 rounded-lg border px-4 py-2 text-sm font-bold">Save domain</button>{domainInstructions && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs"><p className="font-black">Add this {domainInstructions.type} record</p><p className="mt-2 break-all font-mono">Name: {domainInstructions.name}</p><p className="mt-1 break-all font-mono">Value: {domainInstructions.value}</p></div>}<p className="mt-3 text-xs font-bold text-slate-500">Status: {page.customDomainStatus.replaceAll('_', ' ')}</p></section>
        {analytics && <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-black">Last 30 days</h2><div className="mt-3 grid grid-cols-3 gap-3"><div><p className="text-xs text-slate-500">Views</p><p className="text-2xl font-black">{analytics.counts.PAGE_VIEW || 0}</p></div><div><p className="text-xs text-slate-500">Bookings</p><p className="text-2xl font-black">{analytics.counts.BOOKING_COMPLETED || 0}</p></div><div><p className="text-xs text-slate-500">Conversion</p><p className="text-2xl font-black">{analytics.conversionRate}%</p></div></div></section>}
      </div>
      <section className="min-w-0 rounded-2xl border bg-slate-100 p-3"><header className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-slate-500">Live preview</p><p className="text-sm text-slate-600">Interactions are isolated from booking creation.</p></div><div className="flex rounded-lg border bg-white p-1"><button onClick={() => setPreviewWidth('desktop')} aria-label="Desktop preview" aria-pressed={previewWidth === 'desktop'} className={`rounded-md p-2 ${previewWidth === 'desktop' ? 'bg-slate-900 text-white' : ''}`}><Monitor className="h-4 w-4" /></button><button onClick={() => setPreviewWidth('tablet')} aria-label="Tablet preview" aria-pressed={previewWidth === 'tablet'} className={`rounded-md p-2 ${previewWidth === 'tablet' ? 'bg-slate-900 text-white' : ''}`}><Tablet className="h-4 w-4" /></button><button onClick={() => setPreviewWidth('mobile')} aria-label="Mobile preview" aria-pressed={previewWidth === 'mobile'} className={`rounded-md p-2 ${previewWidth === 'mobile' ? 'bg-slate-900 text-white' : ''}`}><Smartphone className="h-4 w-4" /></button></div></header><div className="mx-auto max-h-[1300px] overflow-auto transition-[width]" style={{ width: previewWidths[previewWidth], maxWidth: '100%' }}><PublicBookingFlow slug={loadedSlug} preview pageOverride={pageOverride} /></div></section>
    </div>
  </main>;
}

export default BookingPageSettings;
