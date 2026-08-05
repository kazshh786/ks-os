import { useEffect, useState, type FormEvent } from 'react';
import type {
  AutomatedEmailTemplates,
  CommunicationsSettingsResponse,
  EmailAutomationOptions,
  EmailBranding,
  UpdateCommunicationsSettingsRequest,
} from '@ks-os/contracts';
import { CheckCircle2, ExternalLink, FileText, Mail, Save, Send, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { getDataProvider } from '../../data/data-provider.js';
import { AutomatedEmailPreview } from './AutomatedEmailPreview.js';
import { EmailMarketingTabs } from './EmailMarketingTabs.js';

type TemplateKey = keyof AutomatedEmailTemplates;
type BrandingKey = keyof EmailBranding;
type AutomationKey = keyof EmailAutomationOptions;
type PublishedForm = { id: string; title: string; status: string };

const templateMeta: Array<{ key: TemplateKey; label: string; detail: string; audience: string }> = [
  { key: 'customerBookingConfirmation', label: 'Booking confirmed', detail: 'Sent immediately after a booking becomes confirmed.', audience: 'Customer' },
  { key: 'customerBookingCancellation', label: 'Booking cancelled', detail: 'Sent when a confirmed booking is cancelled.', audience: 'Customer' },
  { key: 'customerBookingReschedule', label: 'Booking rescheduled', detail: 'Sent when a booking receives a new date or time.', audience: 'Customer' },
  { key: 'customerPaymentConfirmation', label: 'Payment confirmation', detail: 'Confirms a successful customer payment.', audience: 'Customer' },
  { key: 'customerRefundUpdate', label: 'Refund update', detail: 'Confirms the latest refund status and amount.', audience: 'Customer' },
  { key: 'formAssignment', label: 'Form assignment', detail: 'Used when a form link is manually sent from Forms.', audience: 'Customer' },
  { key: 'formReminder', label: 'Form reminder', detail: 'Reminds a customer about an incomplete assigned form.', audience: 'Customer' },
  { key: 'customerPortalAccess', label: 'Customer portal access', detail: 'Delivers a secure portal or booking-management link.', audience: 'Customer' },
  { key: 'businessBookingConfirmation', label: 'New booking', detail: 'Sent to the owner and assigned team member.', audience: 'Business' },
  { key: 'reminderThreeDays', label: '3-day reminder', detail: 'Scheduled for 72 hours before the appointment.', audience: 'Customer' },
  { key: 'reminderOneDay', label: '1-day reminder', detail: 'Scheduled for 24 hours before the appointment.', audience: 'Customer' },
  { key: 'customerThankYouGoogle', label: 'First-visit thank you', detail: 'Asks a first-time customer for an honest Google review.', audience: 'Customer' },
  { key: 'customerThankYouTrustpilot', label: 'Returning-customer thank you', detail: 'Asks a returning customer for an honest Trustpilot review.', audience: 'Customer' },
  { key: 'businessPaymentReceived', label: 'Payment received', detail: 'Sent to the business after a successful payment.', audience: 'Business' },
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

function Toggle({ checked, label, detail, onChange }: { checked: boolean; label: string; detail: string; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-slate-200 p-4 hover:border-violet-200 hover:bg-violet-50/30"><span><span className="block text-sm font-black text-slate-900">{label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{detail}</span></span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="mt-1 h-5 w-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500" /></label>;
}

export function AutomatedEmailsPage() {
  const [settings, setSettings] = useState<CommunicationsSettingsResponse | null>(null);
  const [forms, setForms] = useState<PublishedForm[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateKey>('customerBookingConfirmation');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      getDataProvider().getCommunicationsSettings(),
      getDataProvider().listForms().catch(() => []),
    ]).then(([value, rows]) => {
      if (!active) return;
      setSettings(value);
      setForms(rows.filter((form: PublishedForm) => form.status === 'PUBLISHED'));
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Automated email settings could not be loaded.');
    }).finally(() => {
      if (active) setLoading(false);
    });
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
  const updateTemplate = (field: 'subject' | 'heading' | 'body', value: string) => setSettings(current => current ? {
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
      mainBookingFormId: settings.mainBookingFormId,
      branding: settings.branding,
      automations: settings.automations,
      templates: settings.templates,
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
      <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Automated emails</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Shape booking, cancellation, reschedule, payment, refund, form and portal emails in your own voice. Your social profiles are promoted consistently across branded customer emails.</p></div><button type="submit" disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 text-sm font-black text-white hover:bg-violet-400 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save automated emails'}</button></div>
    </header>

    <EmailMarketingTabs />
    {error && <div role="alert" className="flex gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800"><TriangleAlert className="h-5 w-5 shrink-0" />{error}</div>}
    {saved && <div role="status" className="flex gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800"><CheckCircle2 className="h-5 w-5 shrink-0" />Automated email settings saved.</div>}

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <h2 className="text-xl font-black text-slate-950">Sender, business and social information</h2>
      <p className="mt-1 text-sm text-slate-500">These details appear in customer emails. Add social URLs to show the prominent “Check us out on our socials” panel.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="text-sm font-black text-slate-800">Sender display name<input value={settings.senderDisplayName || ''} onChange={event => setSettings({ ...settings, senderDisplayName: event.target.value || null })} placeholder={settings.branding.businessName} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" /></label>
        <label className="text-sm font-black text-slate-800">Reply-to email<input type="email" value={settings.replyToEmail || ''} onChange={event => setSettings({ ...settings, replyToEmail: event.target.value || null })} placeholder="hello@yourbusiness.co.uk" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" /></label>
        {brandingFields.map(field => <label key={field.key} className="text-sm font-black text-slate-800">{field.label}<input type={field.type || 'text'} value={settings.branding[field.key] || ''} onChange={event => updateBranding(field.key, event.target.value)} placeholder={field.placeholder} required={field.key === 'businessName'} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" /></label>)}
      </div>
    </section>

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><FileText className="h-5 w-5" /></span><div><h2 className="text-xl font-black text-slate-950">Main booking form</h2><p className="text-sm text-slate-500">Choose one published form to place inside the main booking confirmation.</p></div></div>
      <label className="mt-5 block text-sm font-black text-slate-800">Form sent with booking confirmation<select value={settings.mainBookingFormId || ''} onChange={event => setSettings({ ...settings, mainBookingFormId: event.target.value || null })} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"><option value="">Do not include a main form</option>{forms.map(form => <option key={form.id} value={form.id}>{form.title}</option>)}</select></label>
      <p className="mt-3 text-sm leading-6 text-slate-600">KS OS creates the secure assignment and places its button in the booking confirmation. Any other form is sent manually from Forms, so customers do not receive several automatic form emails at once.</p>
      {!forms.length && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">Publish a form in Forms before selecting it here.</p>}
    </section>

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <h2 className="text-xl font-black text-slate-950">Lifecycle switches</h2>
      <p className="mt-1 text-sm text-slate-500">Control which customer lifecycle messages are sent.</p>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <Toggle checked={settings.bookingConfirmationEnabled} onChange={value => setSettings({ ...settings, bookingConfirmationEnabled: value })} label="Customer booking confirmation" detail="Send as soon as a booking is confirmed." />
        <Toggle checked={settings.bookingCancellationEnabled} onChange={value => setSettings({ ...settings, bookingCancellationEnabled: value })} label="Customer booking cancellation" detail="Tell the customer when their booking is cancelled." />
        <Toggle checked={settings.bookingRescheduleEnabled} onChange={value => setSettings({ ...settings, bookingRescheduleEnabled: value })} label="Customer booking reschedule" detail="Send the updated appointment time and details." />
        <Toggle checked={settings.appointmentRemindersEnabled} onChange={value => setSettings({ ...settings, appointmentRemindersEnabled: value })} label="Customer appointment reminders" detail="Master switch for both reminder timings." />
        <Toggle checked={settings.paymentConfirmationEnabled} onChange={value => setSettings({ ...settings, paymentConfirmationEnabled: value })} label="Payment and refund updates" detail="Confirm successful payments and completed refund updates." />
        <Toggle checked={settings.formDeliveryEnabled} onChange={value => setSettings({ ...settings, formDeliveryEnabled: value })} label="Form delivery" detail="Allow secure form links in booking and manual form emails." />
        <Toggle checked={settings.formRemindersEnabled} onChange={value => setSettings({ ...settings, formRemindersEnabled: value })} label="Form reminders" detail="Remind customers about incomplete assigned forms." />
        {automationMeta.map(item => <Toggle key={item.key} checked={settings.automations[item.key]} onChange={value => updateAutomation(item.key, value)} label={item.label} detail={item.detail} />)}
      </div>
      <label className="mt-5 block max-w-xl text-sm font-black text-slate-800">Main-form reminder timing<select value={settings.formReminderTiming === 'none' ? 'no_reminder' : settings.formReminderTiming} onChange={event => setSettings({ ...settings, formReminderTiming: event.target.value })} disabled={!settings.formRemindersEnabled} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium disabled:bg-slate-100"><option value="no_reminder">No reminder</option><option value="24_hours_after_assignment">24 hours after assignment</option><option value="48_hours_before_appointment">48 hours before appointment</option><option value="24_hours_before_appointment">24 hours before appointment</option></select></label>
      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">Review links come from your verified Google and Trustpilot connections. <Link to="/app/settings/integrations/reviews" className="inline-flex items-center gap-1 font-black underline">Manage review links <ExternalLink className="h-3.5 w-3.5" /></Link></div>
    </section>

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><Send className="h-5 w-5" /></span><div><h2 className="text-xl font-black text-slate-950">Template editor</h2><p className="text-sm text-slate-500">Edit safe plain text and see an example before saving.</p></div></div>
      <div className="mt-5 grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
        <div className="space-y-2">{templateMeta.map(item => <button type="button" key={item.key} onClick={() => setSelectedTemplate(item.key)} className={item.key === selectedTemplate ? 'w-full rounded-2xl border border-violet-300 bg-violet-50 p-4 text-left ring-2 ring-violet-100' : 'w-full rounded-2xl border border-slate-200 p-4 text-left hover:border-slate-300 hover:bg-slate-50'}><span className="flex items-center justify-between gap-3"><span className="text-sm font-black text-slate-950">{item.label}</span><span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500">{item.audience}</span></span><span className="mt-1 block text-xs leading-5 text-slate-500">{item.detail}</span></button>)}</div>
        <div className="space-y-5">
          <div><h3 className="text-lg font-black text-slate-950">{activeMeta.label}</h3><p className="text-sm text-slate-500">{activeMeta.detail}</p></div>
          <label className="block text-sm font-black text-slate-800">Subject<input value={activeTemplate.subject} onChange={event => updateTemplate('subject', event.target.value)} maxLength={160} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" /></label>
          <label className="block text-sm font-black text-slate-800">Heading<input value={activeTemplate.heading} onChange={event => updateTemplate('heading', event.target.value)} maxLength={200} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" /></label>
          <label className="block text-sm font-black text-slate-800">Message<textarea value={activeTemplate.body} onChange={event => updateTemplate('body', event.target.value)} maxLength={2000} rows={7} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" /></label>
          <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">Supported placeholders include <strong>{'{{businessName}}'}</strong>, <strong>{'{{customerName}}'}</strong>, <strong>{'{{serviceName}}'}</strong>, <strong>{'{{bookingDate}}'}</strong>, <strong>{'{{bookingTime}}'}</strong>, <strong>{'{{amount}}'}</strong>, <strong>{'{{currency}}'}</strong>, <strong>{'{{status}}'}</strong> and <strong>{'{{formName}}'}</strong>.</p>
          <AutomatedEmailPreview template={activeTemplate} branding={settings.branding} />
        </div>
      </div>
    </section>

    <div className="sticky bottom-4 flex justify-end"><button type="submit" disabled={saving} className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-slate-950 px-6 text-sm font-black text-white shadow-xl hover:bg-slate-800 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save all changes'}</button></div>
  </form>;
}
