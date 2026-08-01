import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Lock, Megaphone, RefreshCw, Send, ShieldCheck, XCircle } from 'lucide-react';
import type { WhatsAppCampaignAudience, WhatsAppCampaignListResponse, WhatsAppTemplate } from '@ks-os/contracts';
import {
  cancelWhatsAppCampaign,
  createWhatsAppCampaign,
  listWhatsAppCampaigns,
  syncWhatsAppTemplates,
} from '../features/conversations/conversations.api.js';
import { renderTemplatePreview, templateVariableCount } from '../features/conversations/WhatsAppComposerControls.js';

const audienceLabels: Record<WhatsAppCampaignAudience, string> = {
  ALL_OPTED_IN: 'All opted-in customers',
  UPCOMING_BOOKING_30_DAYS: 'Customers booked in the next 30 days',
  LAPSED_90_DAYS: 'Customers not seen for 90 days',
};

const formatDate = (value: string) => new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

const defaultSchedule = () => {
  const date = new Date(Date.now() + 10 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export function WhatsAppCampaignManager() {
  const [response, setResponse] = useState<WhatsAppCampaignListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [audienceType, setAudienceType] = useState<WhatsAppCampaignAudience>('ALL_OPTED_IN');
  const [scheduledAt, setScheduledAt] = useState(defaultSchedule);
  const [recipientLimit, setRecipientLimit] = useState(100);
  const [parameters, setParameters] = useState<string[]>([]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await listWhatsAppCampaigns();
      setResponse(result);
      setRecipientLimit(current => Math.max(1, Math.min(current, Math.max(1, result.meta.remainingThisMonth || 1))));
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : 'WhatsApp campaigns could not be loaded.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(true); }, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const templates = response?.meta.marketingTemplates || [];
  const selectedTemplate = useMemo(
    () => templates.find(template => template.id === templateId) || null,
    [templateId, templates],
  );
  const requiredParameters = templateVariableCount(selectedTemplate);
  const usagePercent = response
    ? Math.min(100, Math.round((response.meta.usedThisMonth / response.meta.monthlyLimit) * 100))
    : 0;

  const selectTemplate = (id: string) => {
    setTemplateId(id);
    const template = templates.find(item => item.id === id) || null;
    setParameters(template ? Array(templateVariableCount(template)).fill('') : []);
  };

  const updateParameter = (index: number, value: string) => {
    setParameters(current => current.map((item, itemIndex) => itemIndex === index ? value : item));
  };

  const sync = async () => {
    setWorking('sync');
    setError('');
    setNotice('');
    try {
      const result = await syncWhatsAppTemplates();
      setNotice(`${result.synced} WhatsApp template${result.synced === 1 ? '' : 's'} synced from Meta.`);
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'WhatsApp templates could not be synced.');
    } finally {
      setWorking('');
    }
  };

  const create = async () => {
    if (!selectedTemplate || !response) return;
    setWorking('create');
    setError('');
    setNotice('');
    try {
      await createWhatsAppCampaign({
        name,
        templateId: selectedTemplate.id,
        audienceType,
        templateParameters: parameters,
        scheduledAt: new Date(scheduledAt).toISOString(),
        recipientLimit,
      });
      setNotice('WhatsApp marketing campaign scheduled. The messaging worker will dispatch it at the selected time.');
      setName('');
      setTemplateId('');
      setParameters([]);
      setScheduledAt(defaultSchedule());
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The WhatsApp campaign could not be scheduled.');
    } finally {
      setWorking('');
    }
  };

  const cancel = async (campaignId: string) => {
    if (!window.confirm('Cancel this scheduled WhatsApp campaign?')) return;
    setWorking(campaignId);
    setError('');
    setNotice('');
    try {
      await cancelWhatsAppCampaign(campaignId);
      setNotice('WhatsApp campaign cancelled.');
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The WhatsApp campaign could not be cancelled.');
    } finally {
      setWorking('');
    }
  };

  const formReady = Boolean(
    response?.meta.packageTier === 'SCALE'
    && response.meta.remainingThisMonth > 0
    && name.trim().length >= 2
    && selectedTemplate
    && requiredParameters === parameters.length
    && parameters.every(value => value.trim())
    && scheduledAt,
  );

  return <section aria-labelledby="whatsapp-campaign-heading" className="space-y-4">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div><h2 id="whatsapp-campaign-heading" className="text-xl font-black text-slate-950">WhatsApp marketing campaigns</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Scale-only scheduled campaigns use approved Meta templates, opted-in recipients, a seven-day frequency cap and a monthly workspace limit.</p></div>
      <span className="inline-flex items-center gap-2 text-xs font-black text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-600" />Consent rechecked at delivery</span>
    </div>

    {(error || notice) && <div role={error ? 'alert' : 'status'} className={`rounded-2xl border p-4 text-sm font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{error || notice}</div>}

    {loading ? <div className="h-64 animate-pulse rounded-3xl bg-slate-100" /> : response?.meta.packageTier !== 'SCALE' ? <article className="rounded-3xl border border-amber-200 bg-amber-50 p-6"><div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><Lock className="h-5 w-5" /></span><div><h3 className="font-black text-amber-950">Available on the Scale plan</h3><p className="mt-1 text-sm leading-6 text-amber-900">Core keeps free-form WhatsApp replies inside the 24-hour service window. Growth adds utility templates. Scale adds consent-controlled marketing campaigns.</p></div></div></article> : <>
      <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-black text-slate-950">Monthly campaign allowance</h3><p className="mt-1 text-xs text-slate-500">{response.meta.usedThisMonth.toLocaleString()} used · {response.meta.remainingThisMonth.toLocaleString()} remaining · Meta fees billed directly to this business</p></div><span className="rounded-full bg-fuchsia-50 px-3 py-1.5 text-xs font-black text-fuchsia-700">Scale</span></div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-fuchsia-600 transition-all" style={{ width: `${usagePercent}%` }} role="progressbar" aria-valuenow={response.meta.usedThisMonth} aria-valuemin={0} aria-valuemax={response.meta.monthlyLimit} /></div>
      </article>

      <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><h3 className="font-black text-slate-950">Schedule a campaign</h3><p className="mt-1 text-xs leading-5 text-slate-500">Only customers with a current WhatsApp marketing opt-in are eligible. Anyone contacted in the previous {response.meta.frequencyCapDays} days is automatically excluded.</p></div><button type="button" disabled={working === 'sync'} onClick={() => void sync()} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${working === 'sync' ? 'animate-spin' : ''}`} />Sync templates</button></div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block"><span className="mb-1 block text-xs font-black text-slate-700">Campaign name</span><input value={name} onChange={event => setName(event.target.value)} maxLength={255} placeholder="August rebooking offer" className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-500" /></label>
          <label className="block"><span className="mb-1 block text-xs font-black text-slate-700">Marketing template</span><select value={templateId} onChange={event => selectTemplate(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"><option value="">Select an approved template</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name} · {template.language}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs font-black text-slate-700">Audience</span><select value={audienceType} onChange={event => setAudienceType(event.target.value as WhatsAppCampaignAudience)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold">{Object.entries(audienceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs font-black text-slate-700">Schedule</span><input type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" /></label>
          <label className="block"><span className="mb-1 block text-xs font-black text-slate-700">Maximum recipients</span><input type="number" min={1} max={Math.min(1000, Math.max(1, response.meta.remainingThisMonth))} value={recipientLimit} onChange={event => setRecipientLimit(Number(event.target.value))} className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" /></label>
        </div>

        {selectedTemplate && <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-indigo-700">Template values</p>{requiredParameters > 0 ? <div className="mt-3 grid gap-3 md:grid-cols-2">{Array.from({ length: requiredParameters }, (_, index) => <label key={index}><span className="mb-1 block text-xs font-bold text-indigo-900">Value {index + 1}</span><input value={parameters[index] || ''} onChange={event => updateParameter(index, event.target.value)} placeholder={`Value for {{${index + 1}}}`} className="min-h-10 w-full rounded-xl border border-indigo-200 bg-white px-3 text-sm" /></label>)}</div> : <p className="mt-2 text-xs text-indigo-800">This template has no variable values.</p>}<p className="mt-4 whitespace-pre-wrap rounded-xl bg-white/70 p-3 text-sm leading-6 text-indigo-950">{renderTemplatePreview(selectedTemplate, parameters)}</p></div>}

        <div className="mt-5 flex justify-end"><button type="button" disabled={!formReady || working === 'create'} onClick={() => void create()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-fuchsia-600 px-5 text-sm font-black text-white hover:bg-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-4 w-4" />{working === 'create' ? 'Scheduling…' : 'Schedule campaign'}</button></div>
      </article>

      <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2"><Megaphone className="h-5 w-5 text-fuchsia-600" /><h3 className="font-black text-slate-950">Campaign history</h3></div>
        {response.data.length === 0 ? <p className="mt-4 rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">No WhatsApp marketing campaigns have been scheduled.</p> : <div className="mt-4 space-y-3">{response.data.map(campaign => <div key={campaign.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-black text-slate-950">{campaign.name}</p><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-600">{campaign.status}</span></div><p className="mt-1 text-xs text-slate-500">{campaign.templateName} · {audienceLabels[campaign.audienceType]} · {formatDate(campaign.scheduledAt)}</p></div>{campaign.status === 'SCHEDULED' && <button type="button" disabled={working === campaign.id} onClick={() => void cancel(campaign.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-xs font-black text-rose-700 disabled:opacity-50"><XCircle className="h-3.5 w-3.5" />Cancel</button>}</div><div className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">{[['Queued', campaign.queuedCount], ['Sent', campaign.sentCount], ['Delivered', campaign.deliveredCount], ['Read', campaign.readCount], ['Failed', campaign.failedCount], ['Skipped', campaign.skippedCount]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 px-2 py-2"><p className="text-sm font-black text-slate-900">{value}</p><p className="text-[10px] font-bold uppercase text-slate-400">{label}</p></div>)}</div>{campaign.failureCode && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-800">{campaign.failureCode.replaceAll('_', ' ').toLowerCase()}</p>}</div>)}</div>}
      </article>
    </>}
  </section>;
}
