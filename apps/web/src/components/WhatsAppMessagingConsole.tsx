import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Send, UsersRound } from 'lucide-react';
import type { ConversationDetail, ConversationListItem, WhatsAppSendPolicy, WhatsAppTemplate } from '@ks-os/contracts';
import {
  getConversation,
  listConversations,
  sendConversationMessage,
} from '../features/conversations/conversations.api.js';
import {
  buildTemplateComponents,
  renderTemplatePreview,
  templateVariableCount,
  WhatsAppComposerControls,
} from '../features/conversations/WhatsAppComposerControls.js';
import { WhatsAppCampaignManager } from './WhatsAppCampaignManager.js';

export function WhatsAppMessagingConsole() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [policy, setPolicy] = useState<WhatsAppSendPolicy | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplate | null>(null);
  const [templateVariables, setTemplateVariables] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadConversations = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await listConversations({ channel: 'WHATSAPP', limit: 60 });
      setConversations(response.data);
      setSelectedId(current => current || response.data[0]?.id || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'WhatsApp conversations could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadConversations(); }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setPolicy(null);
      return;
    }
    let active = true;
    setError('');
    getConversation(selectedId).then(result => {
      if (!active) return;
      setDetail(result);
      setPolicy(result.whatsapp || null);
      setSelectedTemplate(null);
      setTemplateVariables([]);
      setBody('');
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'The WhatsApp conversation could not be loaded.');
    });
    return () => { active = false; };
  }, [selectedId]);

  const templateReady = useMemo(() => {
    if (!selectedTemplate) return false;
    if (templateVariableCount(selectedTemplate) !== templateVariables.length) return false;
    if (templateVariables.some(value => !value.trim())) return false;
    if (selectedTemplate.category === 'MARKETING' && policy?.marketingConsentStatus !== 'OPTED_IN') return false;
    return true;
  }, [policy?.marketingConsentStatus, selectedTemplate, templateVariables]);

  const canSend = selectedTemplate
    ? templateReady
    : Boolean(body.trim() && policy?.freeformAllowed);

  const send = async () => {
    if (!selectedId || !canSend || sending) return;
    setSending(true);
    setError('');
    setNotice('');
    try {
      const messageBody = selectedTemplate
        ? renderTemplatePreview(selectedTemplate, templateVariables)
        : body.trim();
      await sendConversationMessage(selectedId, {
        body: messageBody,
        channel: 'WHATSAPP',
        ...(selectedTemplate ? {
          whatsappTemplate: {
            id: selectedTemplate.id,
            name: selectedTemplate.name,
            language: selectedTemplate.language,
            category: selectedTemplate.category,
            components: buildTemplateComponents(selectedTemplate, templateVariables),
          },
        } : {}),
      });
      setNotice(selectedTemplate ? 'Approved WhatsApp template queued for delivery.' : 'WhatsApp reply queued for delivery.');
      setBody('');
      setSelectedTemplate(null);
      setTemplateVariables([]);
      const refreshed = await getConversation(selectedId);
      setDetail(refreshed);
      setPolicy(refreshed.whatsapp || null);
      await loadConversations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The WhatsApp message could not be queued.');
    } finally {
      setSending(false);
    }
  };

  return <section aria-labelledby="whatsapp-tier-console-heading" className="space-y-8">
    <div>
      <h2 id="whatsapp-tier-console-heading" className="text-xl font-black text-slate-950">WhatsApp messaging controls</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Core replies only inside the 24-hour service window. Growth unlocks approved utility templates. Scale unlocks consent-controlled marketing templates and campaigns. Meta charges remain on the business-owned WhatsApp account.</p>
    </div>

    {(error || notice) && <div role={error ? 'alert' : 'status'} className={`rounded-2xl border p-4 text-sm font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{error || notice}</div>}

    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="grid min-h-[420px] lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-slate-50 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-500"><UsersRound className="h-4 w-4" />WhatsApp conversations</div>
          <div className="max-h-[520px] overflow-y-auto p-2">{loading ? <div className="space-y-2 p-2">{[0,1,2].map(item => <div key={item} className="h-16 animate-pulse rounded-xl bg-slate-200" />)}</div> : conversations.length === 0 ? <div className="p-8 text-center"><MessageCircle className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-xs font-bold text-slate-500">No WhatsApp conversations yet. A customer must message the connected business number first.</p></div> : conversations.map(conversation => <button key={conversation.id} type="button" onClick={() => setSelectedId(conversation.id)} className={`mb-1 w-full rounded-xl px-3 py-3 text-left ${selectedId === conversation.id ? 'bg-indigo-600 text-white' : 'hover:bg-white'}`}><p className="truncate text-sm font-black">{conversation.customerName}</p><p className={`mt-1 truncate text-xs ${selectedId === conversation.id ? 'text-indigo-100' : 'text-slate-500'}`}>{conversation.preview || conversation.customerPhone || 'WhatsApp conversation'}</p></button>)}</div>
        </aside>

        <div className="min-w-0">
          {!selectedId || !detail ? <div className="flex min-h-[420px] items-center justify-center p-8 text-center"><div><MessageCircle className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">Choose a WhatsApp conversation</p></div></div> : <>
            <div className="border-b border-slate-200 px-4 py-4"><p className="text-sm font-black text-slate-950">{detail.customer.name}</p><p className="mt-1 text-xs text-slate-500">{detail.customer.phone || 'No customer number recorded'}</p></div>
            <WhatsAppComposerControls
              conversationId={selectedId}
              policy={policy}
              selectedTemplate={selectedTemplate}
              templateVariables={templateVariables}
              disabled={sending}
              onPolicyChange={setPolicy}
              onTemplateChange={(template, variables) => { setSelectedTemplate(template); setTemplateVariables(variables); }}
            />
            <div className="p-4">
              {!selectedTemplate && <textarea value={body} disabled={!policy?.freeformAllowed || sending} onChange={event => setBody(event.target.value)} rows={5} placeholder={policy?.freeformAllowed ? `Reply to ${detail.customer.name}` : 'The 24-hour WhatsApp reply window is closed'} className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none focus:border-indigo-500 disabled:bg-slate-100 disabled:text-slate-400" />}
              {selectedTemplate && <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm leading-6 text-indigo-950"><p className="text-[10px] font-black uppercase tracking-wide text-indigo-600">Message preview</p><p className="mt-2 whitespace-pre-wrap">{renderTemplatePreview(selectedTemplate, templateVariables)}</p></div>}
              <div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-slate-500">{selectedTemplate ? `${selectedTemplate.category} template · Meta messaging fees billed by Meta to this business.` : policy?.serviceWindowOpen ? 'Free-form service reply inside the active customer window.' : `Use ${policy?.fallbackChannels.join(' or ') || 'another channel'} or an approved template.`}</p><button type="button" disabled={!canSend || sending} onClick={() => void send()} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-4 w-4" />{sending ? 'Sending…' : 'Send WhatsApp'}</button></div>
            </div>
          </>}
        </div>
      </div>
    </article>

    <WhatsAppCampaignManager />
  </section>;
}
