import { useEffect, useState, type FormEvent } from 'react';
import type {
  AutomatedEmailTemplates,
  CommunicationsSettingsResponse,
  EmailAutomationOptions,
  EmailBranding,
  EmailDesignStyle,
  UpdateCommunicationsSettingsRequest,
} from '@ks-os/contracts';
import { Check, CheckCircle2, ExternalLink, Mail, Palette, Save, Send, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { getDataProvider } from '../../data/data-provider.js';
import { AutomatedEmailPreview } from './AutomatedEmailPreview.js';
import { EmailMarketingTabs } from './EmailMarketingTabs.js';

type TemplateKey = keyof AutomatedEmailTemplates;
type BrandingKey = keyof EmailBranding;
type AutomationKey = keyof EmailAutomationOptions;

const templateMeta: Array<{ key: TemplateKey; label: string; detail: string; audience: string }> = [
  { key: 'customerBookingConfirmation', label: 'Booking confirmed', detail: 'Sent immediately after a booking becomes confirmed.', audience: 'Customer' },
  { key: 'businessBookingConfirmation', label: 'New booking', detail: 'Sent to the owner and assigned team member.', audience: 'Business' },
  { key: 'reminderThreeDays', label: '3-day reminder', detail: 'Scheduled for 72 hours before the appointment.', audience: 'Customer' },
  { key: 'reminderOneDay', label: '1-day reminder', detail: 'Scheduled for 24 hours before the appointment.', audience: 'Customer' },
  { key: 'customerThankYouGoogle', label: 'First-visit thank you', detail: 'Asks a first-time customer for an honest Google review.', audience: 'Customer' },
  { key: 'customerThankYouTrustpilot', label: 'Returning-customer thank you', detail: 'Asks a returning customer for an honest Trustpilot review.', audience: 'Customer' },
  { key: 'businessPaymentReceived', label: 'Payment received', detail: 'Sent after a successful booking payment.', audience: 'Business' },
];

const automationMeta: Array<{ key: AutomationKey; label: string; detail: string }> = [
  { key: 'businessBookingConfirmationEnabled', label: 'Notify the business about confirmed bookings', detail: 'Email active owners and the assigned team member.' },
  { key: 'reminderThreeDaysEnabled', label: 'Send a 3-day reminder', detail: 'Queue a customer email 72 hours before the appointment.' },
  { key: 'reminderOneDayEnabled', label: 'Send a 1-day reminder', detail: 'Queue a customer email 24 hours before the appointment.' },
  { key: 'customerThankYouEnabled', label: 'Send post-visit thank-you and review email', detail: 'Google for a first completed visit, Trustpilot for a returning customer.' },
  { key: 'businessPaymentReceivedEnabled', label: 'Notify the business when payment is received', detail: 'Email active owners and the assigned team member.' },
];

const brandingFields: Array<{ key: BrandingKey; label: string; type?: string; placeholder: string }> = [
  { key: 'businessName', label: 'Business name', placeholder: 'Your business name' },
  { key: 'businessEmail', label: 'Business email shown in emails', type: 'email', placeholder: 'hello@yourbusiness.co.uk' },
  { key: 'businessPhone', label: 'Business phone', placeholder: '020 0000 0000' },
  { key: 'businessAddress', label: 'Business address', placeholder: 'Street, town, postcode' },
  { key: 'websiteUrl', label: 'Website', type: 'url', placeholder: 'https://yourbusiness.co.uk' },
  { key: 'logoUrl', label: 'Logo URL', type: 'url', placeholder: 'https://…/logo.png' },
  { key: 'instagramUrl', label: 'Instagram URL', type: 'url', placeholder: 'https://instagram.com/…' },
  { key: 'facebookUrl', label: 'Facebook URL', type: 'url', placeholder: 'https://facebook.com/…' },
  { key: 'tiktokUrl', label: 'TikTok URL', type: 'url', placeholder: 'https://tiktok.com/@…' },
];

const designMeta: Array<{ style: EmailDesignStyle; name: string; description: string }> = [
  { style: 'CLEAN', name: 'Clean', description: 'Premium, minimal and versatile.' },
  { style: 'EDITORIAL', name: 'Editorial', description: 'Elegant spacing and refined type.' },
  { style: 'STUDIO', name: 'Studio', description: 'Energetic floating-card treatment.' },
  { style: 'CONTRAST', name: 'Contrast', description: 'Bold, high-impact hierarchy.' },
];

function EmailStyleCard({
  style,
  name,
  description,
  selected,
  palette,
  onSelect,
}: {
  style: EmailDesignStyle;
  name: string;
  description: string;
  selected: boolean;
  palette: { primaryColor: string; secondaryColor: string; accentColor: string };
  onSelect: () => void;
}) {
  const dark = style === 'CONTRAST';
  const editorial = style === 'EDITORIAL';
  const studio = style === 'STUDIO';
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={selected
        ? 'group relative rounded-3xl border-2 border-violet-500 bg-violet-50 p-3 text-left ring-4 ring-violet-100'
        : 'group relative rounded-3xl border-2 border-slate-200 bg-white p-3 text-left hover:border-violet-300 hover:bg-violet-50/30'}
    >
      {selected ? <span className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-white"><Check className="h-4 w-4" /></span> : null}
      <span className="block overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 p-2">
        <span className="block rounded-lg bg-white px-3 py-2 text-[9px] font-black text-slate-800">YOUR LOGO</span>
        <span className={dark ? 'mt-2 block bg-slate-950 p-3' : studio ? 'mt-2 block rounded-xl p-3 shadow-sm' : editorial ? 'mt-2 block border-t-2 bg-white p-3' : 'mt-2 block rounded-lg border-t-4 bg-white p-3'} style={{ borderColor: palette.primaryColor, backgroundColor: dark ? palette.secondaryColor : studio ? palette.accentColor + '22' : '#ffffff' }}>
          <span className="block h-2 w-16 rounded-full" style={{ backgroundColor: dark ? '#ffffff' : palette.primaryColor }} />
          <span className="mt-2 block h-1.5 w-full rounded-full bg-slate-300" />
          <span className="mt-1 block h-1.5 w-3/4 rounded-full bg-slate-200" />
          <span className="mt-3 block h-5 w-24 rounded-md" style={{ backgroundColor: palette.primaryColor }} />
        </span>
      </span>
      <span className="mt-3 block pr-9 text-sm font-black text-slate-950">{name}</span>
      <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
    </button>
  );
}

function Toggle({ checked, label, detail, onChange }: { checked: boolean; label: string; detail: string; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-slate-200 p-4 hover:border-violet-200 hover:bg-violet-50/30"><span><span className="block text-sm font-black text-slate-900">{label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{detail}</span></span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="mt-1 h-5 w-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500" /></label>;
}

export function AutomatedEmailsPage() {
  const [settings, setSettings] = useState<CommunicationsSettingsResponse | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateKey>('customerBookingConfirmation');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    getDataProvider().getCommunicationsSettings()
      .then(value => { if (active) setSettings(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Automated email settings could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return <div className="mx-auto max-w-7xl space-y-5"><div className="h-24 animate-pulse rounded-3xl bg-slate-200" /><div className="h-96 animate-pulse rounded-3xl bg-slate-100" /></div>;
  if (!settings) return <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-800">{error || 'Automated email settings are unavailable.'}</div>;

  const updateBranding = (key: BrandingKey, value: string) => setSettings(current => current ? {
    ...current,
    branding: { ...current.branding, [key]: key === 'businessName' ? value : value.trim() || null },
  } : current);
  const updateAutomation = (key: AutomationKey, value: boolean) => setSettings(current => current ? {
    ...current,
    automations: { ...current.automations, [key]: value },
  } : current);
  const updateTemplate = (field: 'subject' | 'preview' | 'heading' | 'body', value: string) => setSettings(current => current ? {
    ...current,
    templates: { ...current.templates, [selectedTemplate]: { ...current.templates[selectedTemplate], [field]: value } },
  } : current);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    const update: UpdateCommunicationsSettingsRequest = {
      replyToEmail: settings.replyToEmail,
      senderDisplayName: settings.senderDisplayName,
      bookingConfirmationEnabled: settings.bookingConfirmationEnabled,
      bookingCancellationEnabled: settings.bookingCancellationEnabled,
      bookingRescheduleEnabled: settings.bookingRescheduleEnabled,
      appointmentRemindersEnabled: settings.appointmentRemindersEnabled,
      formDeliveryEnabled: settings.formDeliveryEnabled,
      formRemindersEnabled: settings.formRemindersEnabled,
      paymentConfirmationEnabled: settings.paymentConfirmationEnabled,
      formReminderTiming: settings.formReminderTiming as UpdateCommunicationsSettingsRequest['formReminderTiming'],
      branding: settings.branding,
      automations: settings.automations,
      templates: settings.templates,
      design: settings.design,
    };
    try {
      await getDataProvider().updateCommunicationsSettings(update);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Automated email settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const activeMeta = templateMeta.find(item => item.key === selectedTemplate)!;
  const activeTemplate = settings.templates[selectedTemplate];

  return <form onSubmit={save} className="mx-auto max-w-7xl space-y-6">
    <header className="overflow-hidden rounded-[32px] bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950 p-6 text-white shadow-xl sm:p-8">
      <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-violet-200"><Mail className="h-3.5 w-3.5" />Email marketing</div>
      <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Automated emails</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Shape every booking, reminder, payment and post-visit email in your own voice. Emails use your business name, contact details and social links while delivery stays securely managed by KS OS and Resend.</p></div><button type="submit" disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 text-sm font-black text-white hover:bg-violet-400 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save automated emails'}</button></div>
    </header>

    <EmailMarketingTabs />
    {error && <div role="alert" className="flex gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800"><TriangleAlert className="h-5 w-5 shrink-0" />{error}</div>}
    {saved && <div role="status" className="flex gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800"><CheckCircle2 className="h-5 w-5 shrink-0" />Automated email settings saved.</div>}

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <h2 className="text-xl font-black text-slate-950">Sender and business information</h2>
      <p className="mt-1 text-sm text-slate-500">These details appear in customer emails. Replies go directly to the address below.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="text-sm font-black text-slate-800">Sender display name<input value={settings.senderDisplayName || ''} onChange={event => setSettings({ ...settings, senderDisplayName: event.target.value || null })} placeholder={settings.branding.businessName} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" /></label>
        <label className="text-sm font-black text-slate-800">Reply-to email<input type="email" value={settings.replyToEmail || ''} onChange={event => setSettings({ ...settings, replyToEmail: event.target.value || null })} placeholder="hello@yourbusiness.co.uk" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" /></label>
        {brandingFields.map(field => <label key={field.key} className="text-sm font-black text-slate-800">{field.label}<input type={field.type || 'text'} value={settings.branding[field.key] || ''} onChange={event => updateBranding(field.key, event.target.value)} placeholder={field.placeholder} required={field.key === 'businessName'} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" /></label>)}
      </div>
    </section>

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><Palette className="h-5 w-5" /></span><div><h2 className="text-xl font-black text-slate-950">Choose your email style</h2><p className="text-sm text-slate-500">Your email design automatically uses the colours and logo from your customer-facing brand.</p></div></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {designMeta.map(item => <EmailStyleCard key={item.style} {...item} selected={settings.design.style === item.style} palette={settings.theme} onSelect={() => setSettings({ ...settings, design: { style: item.style } })} />)}
      </div>
      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-black text-slate-900">Colours synced from your booking page</p><p className="mt-1 text-xs text-slate-500">Email shares the same canonical brand palette. There is no second colour editor.</p></div>
        <div className="flex items-center gap-2" aria-label="Booking-page palette">
          {[settings.theme.primaryColor, settings.theme.secondaryColor, settings.theme.accentColor].map((colour, index) => <span key={colour + index} title={['Primary', 'Secondary', 'Accent'][index]} className="h-7 w-7 rounded-full border-2 border-white shadow ring-1 ring-slate-200" style={{ backgroundColor: colour }} />)}
          <Link to="/app/settings/booking-page" className="ml-2 inline-flex min-h-10 items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 hover:border-violet-300">Change brand colours <ExternalLink className="h-3.5 w-3.5" /></Link>
        </div>
      </div>
    </section>

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <h2 className="text-xl font-black text-slate-950">Lifecycle switches</h2>
      <p className="mt-1 text-sm text-slate-500">Customer booking confirmation, reminder delivery and payment receipts still respect the main transactional-email switches.</p>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <Toggle checked={settings.bookingConfirmationEnabled} onChange={value => setSettings({ ...settings, bookingConfirmationEnabled: value })} label="Customer booking confirmation" detail="Send as soon as a booking is confirmed." />
        <Toggle checked={settings.appointmentRemindersEnabled} onChange={value => setSettings({ ...settings, appointmentRemindersEnabled: value })} label="Customer appointment reminders" detail="Master switch for both reminder timings." />
        <Toggle checked={settings.paymentConfirmationEnabled} onChange={value => setSettings({ ...settings, paymentConfirmationEnabled: value })} label="Customer payment confirmation" detail="Confirm a successful customer payment." />
        {automationMeta.map(item => <Toggle key={item.key} checked={settings.automations[item.key]} onChange={value => updateAutomation(item.key, value)} label={item.label} detail={item.detail} />)}
      </div>
      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">Review links come from your verified Google and Trustpilot connections. <Link to="/app/settings/integrations/reviews" className="inline-flex items-center gap-1 font-black underline">Manage review links <ExternalLink className="h-3.5 w-3.5" /></Link></div>
    </section>

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><Send className="h-5 w-5" /></span><div><h2 className="text-xl font-black text-slate-950">Template editor</h2><p className="text-sm text-slate-500">Edit safe plain text and see an example before saving.</p></div></div>
      <div className="mt-5 grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
        <div className="space-y-2">{templateMeta.map(item => <button type="button" key={item.key} onClick={() => setSelectedTemplate(item.key)} className={item.key === selectedTemplate ? 'w-full rounded-2xl border border-violet-300 bg-violet-50 p-4 text-left ring-2 ring-violet-100' : 'w-full rounded-2xl border border-slate-200 p-4 text-left hover:border-slate-300 hover:bg-slate-50'}><span className="flex items-center justify-between gap-3"><span className="text-sm font-black text-slate-950">{item.label}</span><span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500">{item.audience}</span></span><span className="mt-1 block text-xs leading-5 text-slate-500">{item.detail}</span></button>)}</div>
        <div className="space-y-5">
          <div><h3 className="text-lg font-black text-slate-950">{activeMeta.label}</h3><p className="text-sm text-slate-500">{activeMeta.detail}</p></div>
          <label className="block text-sm font-black text-slate-800">Subject<input value={activeTemplate.subject} onChange={event => updateTemplate('subject', event.target.value)} maxLength={160} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" /></label>
          <label className="block text-sm font-black text-slate-800">Preview text<input value={activeTemplate.preview || ''} onChange={event => updateTemplate('preview', event.target.value)} maxLength={240} placeholder="A useful summary shown beside the subject" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" /></label>
          <label className="block text-sm font-black text-slate-800">Heading<input value={activeTemplate.heading} onChange={event => updateTemplate('heading', event.target.value)} maxLength={200} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" /></label>
          <label className="block text-sm font-black text-slate-800">Message<textarea value={activeTemplate.body} onChange={event => updateTemplate('body', event.target.value)} maxLength={2000} rows={6} className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm font-medium leading-6 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" /></label>
          <div className="flex flex-wrap gap-2 text-[11px] font-bold text-slate-600">{['{{businessName}}','{{customerName}}','{{serviceName}}','{{staffName}}','{{bookingDate}}','{{bookingTime}}','{{amount}}','{{currency}}'].map(token => <code key={token} className="rounded bg-slate-100 px-2 py-1">{token}</code>)}</div>
          <AutomatedEmailPreview templateKey={selectedTemplate} template={activeTemplate} design={settings.design} />
        </div>
      </div>
    </section>

    <div className="sticky bottom-4 flex justify-end"><button type="submit" disabled={saving} className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-slate-950 px-6 text-sm font-black text-white shadow-xl hover:bg-slate-800 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save all changes'}</button></div>
  </form>;
}
