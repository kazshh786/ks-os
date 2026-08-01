import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, Lock, Megaphone, RefreshCw, ShieldCheck } from 'lucide-react';
import type { WhatsAppSendPolicy, WhatsAppTemplate } from '@ks-os/contracts';
import {
  listWhatsAppTemplates,
  syncWhatsAppTemplates,
  updateWhatsAppMarketingConsent,
} from './conversations.api.js';

const formatExpiry = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  : 'No active window';

export const templateVariableCount = (template: WhatsAppTemplate | null) => {
  if (!template) return 0;
  let maximum = 0;
  for (const component of template.components as Array<Record<string, unknown>>) {
    if (String(component?.type || '').toUpperCase() !== 'BODY') continue;
    const text = String(component?.text || '');
    for (const match of text.matchAll(/\{\{(\d+)\}\}/g)) maximum = Math.max(maximum, Number(match[1] || 0));
  }
  return maximum;
};

export const renderTemplatePreview = (template: WhatsAppTemplate, values: string[]) => {
  const body = (template.components as Array<Record<string, unknown>>)
    .find(component => String(component?.type || '').toUpperCase() === 'BODY');
  let text = String(body?.text || template.name.replaceAll('_', ' '));
  values.forEach((value, index) => { text = text.replaceAll(`{{${index + 1}}}`, value || `{{${index + 1}}}`); });
  return text;
};

export const buildTemplateComponents = (template: WhatsAppTemplate, values: string[]) => {
  if (!templateVariableCount(template)) return [];
  return [{
    type: 'body',
    parameters: values.map(value => ({ type: 'text', text: value })),
  }];
};

type Props = {
  conversationId: string;
  policy: WhatsAppSendPolicy | null | undefined;
  selectedTemplate: WhatsAppTemplate | null;
  templateVariables: string[];
  disabled?: boolean;
  onPolicyChange: (policy: WhatsAppSendPolicy) => void;
  onTemplateChange: (template: WhatsAppTemplate | null, variables: string[]) => void;
};

export function WhatsAppComposerControls({
  conversationId,
  policy,
  selectedTemplate,
  templateVariables,
  disabled = false,
  onPolicyChange,
  onTemplateChange,
}: Props) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    setError('');
    try {
      const response = await listWhatsAppTemplates(conversationId);
      setTemplates(response.data);
      onPolicyChange(response.policy);
      if (selectedTemplate && !response.data.some(template => template.id === selectedTemplate.id)) {
        onTemplateChange(null, []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'WhatsApp templates could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [conversationId, onPolicyChange, onTemplateChange, selectedTemplate]);

  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    setWorking('sync');
    setError('');
    setNotice('');
    try {
      const result = await syncWhatsAppTemplates();
      setNotice(`${result.synced} WhatsApp template${result.synced === 1 ? '' : 's'} synced from Meta.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'WhatsApp templates could not be synced.');
    } finally {
      setWorking('');
    }
  };

  const setConsent = async (status: 'OPTED_IN' | 'OPTED_OUT') => {
    setWorking('consent');
    setError('');
    setNotice('');
    try {
      const updated = await updateWhatsAppMarketingConsent(conversationId, {
        status,
        source: 'KS_OS_OWNER_CONFIRMATION',
        evidence: { recordedFrom: 'CONVERSATION_INBOX' },
      });
      onPolicyChange(updated);
      setNotice(status === 'OPTED_IN' ? 'WhatsApp marketing consent recorded.' : 'WhatsApp marketing opt-out recorded.');
      if (status === 'OPTED_OUT' && selectedTemplate?.category === 'MARKETING') onTemplateChange(null, []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Marketing consent could not be updated.');
    } finally {
      setWorking('');
    }
  };

  const variableCount = useMemo(() => templateVariableCount(selectedTemplate), [selectedTemplate]);
  const grouped = useMemo(() => ({
    utility: templates.filter(template => template.category === 'UTILITY' || template.category === 'AUTHENTICATION'),
    marketing: templates.filter(template => template.category === 'MARKETING'),
  }), [templates]);

  const selectTemplate = (id: string) => {
    const template = templates.find(item => item.id === id) || null;
    onTemplateChange(template, template ? Array(templateVariableCount(template)).fill('') : []);
    setNotice('');
  };

  const updateVariable = (index: number, value: string) => {
    const next = [...templateVariables];
    next[index] = value;
    onTemplateChange(selectedTemplate, next);
  };

  return <div className="border-b border-slate-100 bg-slate-50/80 px-3 py-3">
    <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-slate-700 ring-1 ring-slate-200">
        <Clock3 className="h-3.5 w-3.5" />
        {policy?.serviceWindowOpen ? `24-hour reply window open until ${formatExpiry(policy.serviceWindowExpiresAt)}` : '24-hour reply window closed'}
      </span>
      <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-black text-indigo-700">{policy?.packageTier || 'CORE'} plan</span>
      {policy?.marketingTemplatesAllowed && <span className="inline-flex items-center gap-1 rounded-full bg-fuchsia-50 px-2.5 py-1 text-fuchsia-700"><Megaphone className="h-3.5 w-3.5" />Marketing enabled</span>}
    </div>

    {!policy?.serviceWindowOpen && policy?.packageTier === 'CORE' && <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900">
      <Lock className="mt-0.5 h-4 w-4 shrink-0" />Core can reply on WhatsApp only during the 24-hour customer-service window. Use {policy.fallbackChannels.length ? policy.fallbackChannels.join(' or ') : 'another connected channel'} until the customer messages again.
    </div>}

    {(policy?.utilityTemplatesAllowed || policy?.marketingTemplatesAllowed) && <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <label className="block"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-500">Approved WhatsApp template</span><select disabled={disabled || loading} value={selectedTemplate?.id || ''} onChange={event => selectTemplate(event.target.value)} className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-800"><option value="">Free-form reply</option>{grouped.utility.length > 0 && <optgroup label="Utility and authentication">{grouped.utility.map(template => <option key={template.id} value={template.id}>{template.name} · {template.language}</option>)}</optgroup>}{grouped.marketing.length > 0 && <optgroup label="Marketing — Scale">{grouped.marketing.map(template => <option key={template.id} value={template.id}>{template.name} · {template.language}</option>)}</optgroup>}</select></label>
      <button type="button" disabled={disabled || working === 'sync'} onClick={() => void sync()} className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${working === 'sync' ? 'animate-spin' : ''}`} />Sync templates</button>
    </div>}

    {selectedTemplate && <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
      <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black text-indigo-950">{selectedTemplate.name}</p><p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-600">{selectedTemplate.category} · {selectedTemplate.language}</p></div><ShieldCheck className="h-4 w-4 text-indigo-600" /></div>
      {variableCount > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{Array.from({ length: variableCount }, (_, index) => <label key={index} className="block"><span className="mb-1 block text-[10px] font-black text-indigo-700">Template value {index + 1}</span><input disabled={disabled} value={templateVariables[index] || ''} onChange={event => updateVariable(index, event.target.value)} placeholder={`Value for {{${index + 1}}}`} className="min-h-9 w-full rounded-lg border border-indigo-200 bg-white px-3 text-xs outline-none focus:border-indigo-500" /></label>)}</div>}
      <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-indigo-900">{renderTemplatePreview(selectedTemplate, templateVariables)}</p>
    </div>}

    {policy?.marketingTemplatesAllowed && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <div className="min-w-0 flex-1"><p className="text-xs font-black text-slate-900">Marketing consent: {policy.marketingConsentStatus.replaceAll('_', ' ').toLowerCase()}</p><p className="mt-0.5 text-[10px] leading-4 text-slate-500">Only record opt-in when the customer has clearly agreed to receive WhatsApp marketing.</p></div>
      <button type="button" disabled={disabled || working === 'consent'} onClick={() => void setConsent('OPTED_IN')} className="min-h-9 rounded-lg bg-emerald-600 px-3 text-[11px] font-black text-white disabled:opacity-50">Record opt-in</button>
      <button type="button" disabled={disabled || working === 'consent'} onClick={() => void setConsent('OPTED_OUT')} className="min-h-9 rounded-lg border border-rose-200 px-3 text-[11px] font-black text-rose-700 disabled:opacity-50">Opt out</button>
    </div>}

    {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mt-2 text-[11px] font-bold ${error ? 'text-rose-700' : 'text-emerald-700'}`}>{error || notice}</p>}
  </div>;
}
