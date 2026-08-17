import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type {
  AutomatedEmailTemplates,
  CommunicationsSettingsResponse,
  EmailAutomationOptions,
  EmailBranding,
  EmailDesignStyle,
  UpdateCommunicationsSettingsRequest,
} from '@ks-os/contracts';
import { Check, CheckCircle2, ChevronDown, ExternalLink, Mail, Save, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { getDataProvider } from '../../data/data-provider.js';
import { AutomatedEmailPreview } from './AutomatedEmailPreview.js';
import { EmailMarketingTabs } from './EmailMarketingTabs.js';

type TemplateKey = keyof AutomatedEmailTemplates;
type BrandingKey = keyof EmailBranding;
type AutomationKey = keyof EmailAutomationOptions;
type TransactionalSettingKey = 'bookingConfirmationEnabled' | 'appointmentRemindersEnabled' | 'paymentConfirmationEnabled';

const templateMeta: Array<{
  key: TemplateKey;
  label: string;
  detail: string;
  audience: 'Customer' | 'Business';
}> = [
  { key: 'customerBookingConfirmation', label: 'Booking confirmed', detail: 'Sent immediately after a booking becomes confirmed.', audience: 'Customer' },
  { key: 'reminderThreeDays', label: '3-day reminder', detail: 'Scheduled for 72 hours before the appointment.', audience: 'Customer' },
  { key: 'reminderOneDay', label: '1-day reminder', detail: 'Scheduled for 24 hours before the appointment.', audience: 'Customer' },
  { key: 'customerThankYouGoogle', label: 'First-visit thank you', detail: 'Asks a first-time customer for an honest Google review.', audience: 'Customer' },
  { key: 'customerThankYouTrustpilot', label: 'Returning thank-you', detail: 'Asks a returning customer for an honest Trustpilot review.', audience: 'Customer' },
  { key: 'businessBookingConfirmation', label: 'New booking', detail: 'Sent to the owner and assigned team member.', audience: 'Business' },
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
  { key: 'logoUrl', label: 'Logo URL', type: 'url', placeholder: 'https://…/logo.png' },
  { key: 'businessEmail', label: 'Business email shown in emails', type: 'email', placeholder: 'hello@yourbusiness.co.uk' },
  { key: 'businessPhone', label: 'Business phone', placeholder: '020 0000 0000' },
  { key: 'businessAddress', label: 'Business address', placeholder: 'Street, town, postcode' },
  { key: 'websiteUrl', label: 'Website', type: 'url', placeholder: 'https://yourbusiness.co.uk' },
  { key: 'instagramUrl', label: 'Instagram URL', type: 'url', placeholder: 'https://instagram.com/…' },
  { key: 'facebookUrl', label: 'Facebook URL', type: 'url', placeholder: 'https://facebook.com/…' },
  { key: 'tiktokUrl', label: 'TikTok URL', type: 'url', placeholder: 'https://tiktok.com/@…' },
];

const designMeta: Array<{ style: EmailDesignStyle; name: string; description: string }> = [
  { style: 'CLEAN', name: 'Clean', description: 'Minimal and versatile.' },
  { style: 'EDITORIAL', name: 'Editorial', description: 'Refined and spacious.' },
  { style: 'STUDIO', name: 'Studio', description: 'Bright floating cards.' },
  { style: 'CONTRAST', name: 'Contrast', description: 'Bold visual hierarchy.' },
];

const variables = [
  '{{businessName}}',
  '{{customerName}}',
  '{{serviceName}}',
  '{{staffName}}',
  '{{bookingDate}}',
  '{{bookingTime}}',
  '{{amount}}',
  '{{currency}}',
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
  const studio = style === 'STUDIO';

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={
        'relative min-h-28 rounded-xl border-2 p-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ' +
        (selected
          ? 'border-violet-500 bg-violet-50'
          : 'border-slate-200 bg-white hover:border-violet-300')
      }
    >
      {selected ? (
        <span className="absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white">
          <Check className="h-3 w-3" />
          <span className="sr-only">Selected</span>
        </span>
      ) : null}
      <span className="block overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-1.5">
        <span className="block rounded bg-white px-2 py-1 text-[7px] font-black text-slate-700">YOUR LOGO</span>
        <span
          className={'mt-1.5 block p-2 ' + (dark ? 'bg-slate-950' : studio ? 'rounded-md' : 'bg-white')}
          style={{ backgroundColor: dark ? palette.secondaryColor : studio ? palette.accentColor + '22' : '#ffffff' }}
        >
          <span className="block h-1.5 w-12 rounded-full" style={{ backgroundColor: dark ? '#ffffff' : palette.primaryColor }} />
          <span className="mt-1.5 block h-1 w-full rounded-full bg-slate-300" />
          <span className="mt-1 block h-3 w-14 rounded" style={{ backgroundColor: palette.primaryColor }} />
        </span>
      </span>
      <span className="mt-2 block pr-6 text-xs font-black text-slate-950">{name}</span>
      <span className="mt-0.5 block text-[10px] leading-4 text-slate-500">{description}</span>
    </button>
  );
}

function Toggle({
  checked,
  label,
  detail,
  onChange,
}: {
  checked: boolean;
  label: string;
  detail: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 border-b border-slate-100 py-3 last:border-b-0">
      <span>
        <span className="block text-sm font-bold text-slate-900">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500">{detail}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
      />
    </label>
  );
}

function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-slate-200 px-5 py-5 last:border-b-0">
      <h2 className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function TemplateRail({
  selectedTemplate,
  onSelect,
}: {
  selectedTemplate: TemplateKey;
  onSelect: (key: TemplateKey) => void;
}) {
  return (
    <nav aria-label="Email templates" className="space-y-6">
      {(['Customer', 'Business'] as const).map(audience => (
        <div key={audience}>
          <p className="px-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{audience}</p>
          <div className="mt-2 space-y-1">
            {templateMeta.filter(item => item.audience === audience).map(item => {
              const selected = item.key === selectedTemplate;
              return (
                <button
                  type="button"
                  key={item.key}
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => onSelect(item.key)}
                  className={
                    'flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ' +
                    (selected
                      ? 'bg-violet-50 font-black text-violet-800'
                      : 'font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950')
                  }
                >
                  <span className={'h-2 w-2 shrink-0 rounded-full ' + (selected ? 'bg-violet-600' : 'bg-slate-300')} aria-hidden="true" />
                  <span>{item.label}</span>
                  {selected ? <span className="sr-only">Selected</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function relevantAutomation(templateKey: TemplateKey): {
  kind: 'setting';
  key: TransactionalSettingKey;
  label: string;
  detail: string;
} | {
  kind: 'automation';
  key: AutomationKey;
  label: string;
  detail: string;
} {
  switch (templateKey) {
    case 'customerBookingConfirmation':
      return { kind: 'setting', key: 'bookingConfirmationEnabled', label: 'Send automatically', detail: 'Send when a customer booking is confirmed.' };
    case 'businessBookingConfirmation':
      return { kind: 'automation', key: 'businessBookingConfirmationEnabled', label: 'Send automatically', detail: 'Notify owners and the assigned team member.' };
    case 'reminderThreeDays':
      return { kind: 'automation', key: 'reminderThreeDaysEnabled', label: 'Send 3 days before', detail: 'Queue this customer reminder 72 hours before the appointment.' };
    case 'reminderOneDay':
      return { kind: 'automation', key: 'reminderOneDayEnabled', label: 'Send 1 day before', detail: 'Queue this customer reminder 24 hours before the appointment.' };
    case 'customerThankYouGoogle':
    case 'customerThankYouTrustpilot':
      return { kind: 'automation', key: 'customerThankYouEnabled', label: 'Send automatically', detail: 'Send after an eligible completed appointment.' };
    case 'businessPaymentReceived':
      return { kind: 'automation', key: 'businessPaymentReceivedEnabled', label: 'Send automatically', detail: 'Notify the business after a successful booking payment.' };
  }
}

export function AutomatedEmailsPage() {
  const [settings, setSettings] = useState<CommunicationsSettingsResponse | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateKey>('customerBookingConfirmation');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getDataProvider().getCommunicationsSettings()
      .then(value => {
        if (active) setSettings(value);
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : 'Automated email settings could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-[70vh] border border-slate-200 bg-white">
        <div className="h-16 animate-pulse border-b border-slate-200 bg-slate-100" />
        <div className="grid min-h-[620px] gap-px bg-slate-200 xl:grid-cols-[220px_minmax(520px,1fr)_380px]">
          <div className="hidden bg-slate-50 xl:block" />
          <div className="bg-slate-100" />
          <div className="bg-white" />
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div role="alert" className="border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-800">
        {error || 'Automated email settings are unavailable.'}
      </div>
    );
  }

  const markChanged = () => {
    setDirty(true);
    setSaved(false);
    setError(null);
  };

  const updateBranding = (key: BrandingKey, value: string) => {
    markChanged();
    setSettings(current => current ? {
      ...current,
      branding: { ...current.branding, [key]: key === 'businessName' ? value : value.trim() || null },
    } : current);
  };

  const updateAutomation = (key: AutomationKey, value: boolean) => {
    markChanged();
    setSettings(current => current ? {
      ...current,
      automations: { ...current.automations, [key]: value },
    } : current);
  };

  const updateTransactionalSetting = (key: TransactionalSettingKey, value: boolean) => {
    markChanged();
    setSettings(current => current ? { ...current, [key]: value } : current);
  };

  const updateTemplate = (field: 'subject' | 'preview' | 'heading' | 'body', value: string) => {
    markChanged();
    setSettings(current => current ? {
      ...current,
      templates: {
        ...current.templates,
        [selectedTemplate]: { ...current.templates[selectedTemplate], [field]: value },
      },
    } : current);
  };

  const selectTemplate = (key: TemplateKey) => {
    setSelectedTemplate(key);
  };

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
      setDirty(false);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Automated email settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const activeMeta = templateMeta.find(item => item.key === selectedTemplate)!;
  const activeTemplate = settings.templates[selectedTemplate];
  const selectedAutomation = relevantAutomation(selectedTemplate);
  const selectedAutomationChecked = selectedAutomation.kind === 'setting'
    ? settings[selectedAutomation.key]
    : settings.automations[selectedAutomation.key];

  const saveStatus = saving
    ? 'Saving…'
    : error
      ? 'Save failed'
      : dirty
        ? 'Unsaved changes'
        : saved
          ? 'Saved'
          : 'All changes saved';

  return (
    <form onSubmit={save} className="-mx-3 bg-slate-100 sm:-mx-5 lg:-mx-6" data-testid="email-studio">
      <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white">
            <Mail className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-black text-slate-950">Automated emails</h1>
            <p className="truncate text-xs font-semibold text-slate-500">{activeMeta.label} · {activeMeta.audience}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            role="status"
            aria-live="polite"
            className={
              'hidden items-center gap-1.5 text-xs font-bold sm:inline-flex ' +
              (error ? 'text-rose-700' : dirty ? 'text-amber-700' : 'text-emerald-700')
            }
          >
            {!dirty && !error && !saving ? <CheckCircle2 className="h-4 w-4" /> : null}
            {saveStatus}
          </span>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-black text-white hover:bg-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </header>

      <div className="bg-white px-4 sm:px-6">
        <EmailMarketingTabs />
      </div>

      {error ? (
        <div role="alert" className="flex min-h-10 items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-800 sm:px-6">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div
        data-testid="email-studio-layout"
        className="grid min-h-[calc(100vh-9rem)] bg-slate-200 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[220px_minmax(520px,1fr)_380px]"
      >
        <aside className="hidden border-r border-slate-200 bg-slate-50 px-3 py-5 xl:block">
          <TemplateRail selectedTemplate={selectedTemplate} onSelect={selectTemplate} />
        </aside>

        <main className="min-w-0 bg-slate-100 p-3 sm:p-4 lg:p-5">
          <label className="mb-3 block text-xs font-black text-slate-700 xl:hidden">
            Email template
            <select
              value={selectedTemplate}
              onChange={event => selectTemplate(event.target.value as TemplateKey)}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
            >
              {templateMeta.map(item => (
                <option key={item.key} value={item.key}>{item.label} · {item.audience}</option>
              ))}
            </select>
          </label>

          <AutomatedEmailPreview
            emailName={activeMeta.label}
            templateKey={selectedTemplate}
            template={activeTemplate}
            design={settings.design}
          />
        </main>

        <aside
          data-testid="email-settings-inspector"
          aria-label="Email settings inspector"
          className="min-w-0 border-t border-slate-200 bg-white lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:overflow-y-auto lg:border-l lg:border-t-0"
        >
          <InspectorSection title="Content">
            <div className="space-y-4">
              <label className="block text-sm font-bold text-slate-800">
                Subject
                <input
                  value={activeTemplate.subject}
                  onChange={event => updateTemplate('subject', event.target.value)}
                  maxLength={160}
                  className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label className="block text-sm font-bold text-slate-800">
                Preview text
                <input
                  value={activeTemplate.preview || ''}
                  onChange={event => updateTemplate('preview', event.target.value)}
                  maxLength={240}
                  placeholder="A useful summary shown beside the subject"
                  className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label className="block text-sm font-bold text-slate-800">
                Heading
                <input
                  value={activeTemplate.heading}
                  onChange={event => updateTemplate('heading', event.target.value)}
                  maxLength={200}
                  className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label className="block text-sm font-bold text-slate-800">
                Message
                <textarea
                  value={activeTemplate.body}
                  onChange={event => updateTemplate('body', event.target.value)}
                  maxLength={2000}
                  rows={6}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 p-3 text-sm font-medium leading-6 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <div>
                <p className="text-xs font-black text-slate-700">Available variables</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {variables.map(token => (
                    <button
                      type="button"
                      key={token}
                      aria-label={'Insert ' + token}
                      onClick={() => updateTemplate('body', activeTemplate.body + (activeTemplate.body.endsWith(' ') ? '' : ' ') + token)}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600 hover:border-violet-300 hover:text-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                    >
                      {token}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </InspectorSection>

          <InspectorSection title="Design">
            <div className="grid grid-cols-2 gap-2">
              {designMeta.map(item => (
                <EmailStyleCard
                  key={item.style}
                  {...item}
                  selected={settings.design.style === item.style}
                  palette={settings.theme}
                  onSelect={() => {
                    markChanged();
                    setSettings(current => current ? { ...current, design: { style: item.style } } : current);
                  }}
                />
              ))}
            </div>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black text-slate-800">Brand colours</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Synced from booking page</p>
                </div>
                <div className="flex items-center gap-1.5" aria-label="Booking-page palette">
                  {[settings.theme.primaryColor, settings.theme.secondaryColor, settings.theme.accentColor].map((colour, index) => (
                    <span
                      key={colour + index}
                      title={['Primary', 'Secondary', 'Accent'][index]}
                      className="h-6 w-6 rounded-full border-2 border-white shadow ring-1 ring-slate-200"
                      style={{ backgroundColor: colour }}
                    />
                  ))}
                </div>
              </div>
              <Link
                to="/app/settings/booking-page"
                className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 hover:border-violet-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                Change brand colours <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          </InspectorSection>

          <details className="group border-b border-slate-200">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-5 text-xs font-black uppercase tracking-[0.16em] text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500">
              Business
              <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
            </summary>
            <div className="space-y-4 px-5 pb-5">
              <label className="block text-sm font-bold text-slate-800">
                Sender display name
                <input
                  value={settings.senderDisplayName || ''}
                  onChange={event => {
                    markChanged();
                    setSettings(current => current ? { ...current, senderDisplayName: event.target.value || null } : current);
                  }}
                  placeholder={settings.branding.businessName}
                  className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label className="block text-sm font-bold text-slate-800">
                Reply-to email
                <input
                  type="email"
                  value={settings.replyToEmail || ''}
                  onChange={event => {
                    markChanged();
                    setSettings(current => current ? { ...current, replyToEmail: event.target.value || null } : current);
                  }}
                  placeholder="hello@yourbusiness.co.uk"
                  className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                />
              </label>
              {brandingFields.map(field => (
                <label key={field.key} className="block text-sm font-bold text-slate-800">
                  {field.label}
                  <input
                    type={field.type || 'text'}
                    value={settings.branding[field.key] || ''}
                    onChange={event => updateBranding(field.key, event.target.value)}
                    placeholder={field.placeholder}
                    required={field.key === 'businessName'}
                    className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-medium focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                  />
                </label>
              ))}
            </div>
          </details>

          <InspectorSection title="Automation">
            <Toggle
              checked={selectedAutomationChecked}
              onChange={value => selectedAutomation.kind === 'setting'
                ? updateTransactionalSetting(selectedAutomation.key, value)
                : updateAutomation(selectedAutomation.key, value)}
              label={selectedAutomation.label}
              detail={selectedAutomation.detail}
            />
            <details className="group mt-3 rounded-lg border border-slate-200">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-xs font-black text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500">
                Advanced automation settings
                <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
              </summary>
              <div className="border-t border-slate-200 px-3">
                <Toggle
                  checked={settings.bookingConfirmationEnabled}
                  onChange={value => updateTransactionalSetting('bookingConfirmationEnabled', value)}
                  label="Customer booking confirmation"
                  detail="Master switch for customer confirmations."
                />
                <Toggle
                  checked={settings.appointmentRemindersEnabled}
                  onChange={value => updateTransactionalSetting('appointmentRemindersEnabled', value)}
                  label="Customer appointment reminders"
                  detail="Master switch for both reminder timings."
                />
                <Toggle
                  checked={settings.paymentConfirmationEnabled}
                  onChange={value => updateTransactionalSetting('paymentConfirmationEnabled', value)}
                  label="Customer payment confirmation"
                  detail="Confirm a successful customer payment."
                />
                {automationMeta
                  .filter(item => selectedAutomation.kind !== 'automation' || item.key !== selectedAutomation.key)
                  .map(item => (
                    <Toggle
                      key={item.key}
                      checked={settings.automations[item.key]}
                      onChange={value => updateAutomation(item.key, value)}
                      label={item.label}
                      detail={item.detail}
                    />
                  ))}
              </div>
            </details>
            <p className="mt-4 text-xs leading-5 text-slate-500">
              Review destinations use your verified integrations.{' '}
              <Link to="/app/settings/integrations/reviews" className="font-black text-violet-700 underline">
                Manage review links
              </Link>
            </p>
          </InspectorSection>
        </aside>
      </div>
    </form>
  );
}
