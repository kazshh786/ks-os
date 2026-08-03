import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Facebook, Instagram, Mail, MessageCircle, Phone, Plug, Settings2 } from 'lucide-react';
import { Link } from 'react-router';
import type { CommunicationChannelConnection, CommunicationsSettingsResponse, ConversationChannel, UpdateCommunicationsSettingsRequest } from '@ks-os/contracts';
import { useAuth } from '../../auth/useAuth.js';
import { getDataProvider } from '../../data/data-provider.js';
import { listConversationChannels } from '../../features/conversations/conversations.api.js';

const channelIcons: Record<ConversationChannel, typeof Mail> = {
  EMAIL: Mail,
  SMS: MessageCircle,
  WHATSAPP: Phone,
  INSTAGRAM: Instagram,
  FACEBOOK: Facebook,
};

const statusTone = {
  CONNECTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ATTENTION: 'bg-amber-50 text-amber-800 ring-amber-200',
  DISCONNECTED: 'bg-slate-100 text-slate-600 ring-slate-200',
} as const;

const capabilityLabel = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());

function SettingToggle({ checked, onChange, label, description }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description: string }) {
  return <label className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-slate-200 p-4 transition hover:border-indigo-200 hover:bg-indigo-50/30">
    <span><span className="block text-sm font-black text-slate-900">{label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></span>
    <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="mt-1 h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
  </label>;
}

export function Communications() {
  const { role } = useAuth();
  const [settings, setSettings] = useState<CommunicationsSettingsResponse | null>(null);
  const [channels, setChannels] = useState<CommunicationChannelConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (role === 'staff') { setLoading(false); return; }
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      getDataProvider().getCommunicationsSettings(),
      listConversationChannels(),
    ]).then(([loadedSettings, loadedChannels]) => {
      if (!active) return;
      setSettings(loadedSettings);
      setChannels(loadedChannels);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Communications settings could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [role]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
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
      };
      await getDataProvider().updateCommunicationsSettings(update);
      setSuccessMessage('Communication preferences saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Communication preferences could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  if (role === 'staff') return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-800">Only business owners can manage channel connections and communication settings.</div>;
  if (loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-3xl bg-slate-200" /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0,1,2,3,4].map(item => <div key={item} className="h-48 animate-pulse rounded-3xl bg-slate-100" />)}</div></div>;
  if (!settings) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-800">{error || 'Communications settings are unavailable.'}</div>;

  const connectedCount = channels.filter(channel => channel.status === 'CONNECTED').length;

  return <div className="mx-auto max-w-7xl space-y-7">
    <header className="relative overflow-hidden rounded-[32px] bg-slate-950 p-6 text-white shadow-xl sm:p-8">
      <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="inline-flex items-center gap-2 rounded-full border border-indigo-300/20 bg-indigo-400/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-indigo-200"><Plug className="h-3.5 w-3.5" />Omnichannel communications</div><h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Connect every customer channel</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Email, SMS and Meta channels feed one booking-centred inbox. Staff can reply, book the customer, assign a form, request payment or share the booking page without losing context.</p></div>
        <Link to="/app/operations" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-black text-white hover:bg-indigo-400"><MessageCircle className="h-4 w-4" />Open customer inbox</Link>
      </div>
      <div className="relative mt-6 flex flex-wrap gap-3 text-xs font-black"><span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">{connectedCount} of {channels.length} channels connected</span><span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">Credentials stored encrypted</span><span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">Tenant-isolated message history</span></div>
    </header>

    {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">{error}</div>}
    {successMessage && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">{successMessage}</div>}

    <section aria-labelledby="channel-readiness-heading">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="channel-readiness-heading" className="text-xl font-black text-slate-950">Channel readiness</h2><p className="mt-1 text-sm text-slate-500">A channel is usable by the inbox only after its business account is connected and healthy.</p></div><Link to="/app/settings/integrations" className="text-xs font-black text-indigo-600 hover:text-indigo-800">Integration settings</Link></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{channels.map(channel => {
        const Icon = channelIcons[channel.channel];
        const connected = channel.status === 'CONNECTED';
        const needsPlatformSetup = !channel.providerConfigured;
        return <article key={channel.channel} className="flex min-h-56 flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white"><Icon className="h-5 w-5" /></span><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ring-1 ring-inset ${statusTone[channel.status]}`}>{connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : channel.status === 'ATTENTION' ? <AlertTriangle className="h-3.5 w-3.5" /> : null}{channel.status === 'ATTENTION' ? 'Needs attention' : channel.status.toLowerCase()}</span></div>
          <h3 className="mt-4 text-lg font-black text-slate-950">{channel.displayName}</h3><p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">{channel.provider}</p><p className="mt-3 text-sm leading-6 text-slate-600">{channel.setupMessage}</p>
          <div className="mt-4 flex flex-wrap gap-1.5">{channel.capabilities.slice(0, 5).map(capability => <span key={capability} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{capabilityLabel(capability)}</span>)}</div>
          <div className="mt-auto pt-5">{connected ? <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">{channel.externalAccountId ? `Account ${channel.externalAccountId}` : 'Connected account ready'}</div> : needsPlatformSetup ? <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">Platform setup is required before tenant onboarding can begin.</div> : <Link to="/app/settings/integrations" className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-black text-indigo-700 hover:bg-indigo-100">Prepare connection</Link>}</div>
        </article>;
      })}</div>
    </section>

    <form onSubmit={handleSave} className="space-y-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><Settings2 className="h-5 w-5" /></span><div><h2 className="text-xl font-black text-slate-950">Notification preferences</h2><p className="text-sm text-slate-500">Control the transactional updates KS OS sends around bookings, forms and payments.</p></div></div>

      <section className="grid gap-4 lg:grid-cols-2"><label className="text-sm font-black text-slate-800">Sender display name<input type="text" value={settings.senderDisplayName || ''} onChange={event => setSettings({ ...settings, senderDisplayName: event.target.value })} placeholder="Your business name" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label><label className="text-sm font-black text-slate-800">Reply-to email<input type="email" value={settings.replyToEmail || ''} onChange={event => setSettings({ ...settings, replyToEmail: event.target.value })} placeholder="hello@yourbusiness.co.uk" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label></section>

      <section><h3 className="mb-3 text-sm font-black uppercase tracking-wider text-slate-500">Bookings and payments</h3><div className="grid gap-3 lg:grid-cols-2"><SettingToggle checked={settings.bookingConfirmationEnabled} onChange={checked => setSettings({ ...settings, bookingConfirmationEnabled: checked })} label="Booking confirmations" description="Confirm new bookings after they are created." /><SettingToggle checked={settings.bookingRescheduleEnabled} onChange={checked => setSettings({ ...settings, bookingRescheduleEnabled: checked })} label="Reschedule updates" description="Tell customers when an appointment time changes." /><SettingToggle checked={settings.bookingCancellationEnabled} onChange={checked => setSettings({ ...settings, bookingCancellationEnabled: checked })} label="Cancellation updates" description="Confirm cancellations and any next steps." /><SettingToggle checked={settings.appointmentRemindersEnabled} onChange={checked => setSettings({ ...settings, appointmentRemindersEnabled: checked })} label="Appointment reminders" description="Send scheduled reminders before the visit." /><SettingToggle checked={settings.paymentConfirmationEnabled} onChange={checked => setSettings({ ...settings, paymentConfirmationEnabled: checked })} label="Payment confirmations" description="Confirm successful booking payments." /></div></section>

      <section><h3 className="mb-3 text-sm font-black uppercase tracking-wider text-slate-500">Forms and documents</h3><div className="grid gap-3 lg:grid-cols-2"><SettingToggle checked={settings.formDeliveryEnabled} onChange={checked => setSettings({ ...settings, formDeliveryEnabled: checked })} label="Form delivery" description="Send secure form-completion links when a form is assigned." /><SettingToggle checked={settings.formRemindersEnabled} onChange={checked => setSettings({ ...settings, formRemindersEnabled: checked })} label="Form reminders" description="Follow up when a required form remains incomplete." /></div>{settings.formRemindersEnabled && <label className="mt-4 block max-w-sm text-sm font-black text-slate-800">Reminder timing<select value={settings.formReminderTiming} onChange={event => setSettings({ ...settings, formReminderTiming: event.target.value })} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium"><option value="no_reminder">No additional reminder</option><option value="24_hours_after_assignment">24 hours after assignment</option><option value="48_hours_before_appointment">48 hours before appointment</option><option value="24_hours_before_appointment">24 hours before appointment</option></select></label>}</section>

      <div className="flex justify-end border-t border-slate-100 pt-5"><button type="submit" disabled={saving} className="min-h-11 rounded-xl bg-indigo-600 px-5 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save preferences'}</button></div>
    </form>
  </div>;
}
