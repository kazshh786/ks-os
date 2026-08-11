import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Database, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { agencyFetch } from './AgencyAuth';

interface LiveIntelligencePayload {
  dataClasses: Record<'published' | 'live' | 'personal', string>;
  published: { snapshotReference: string; versionReference: string; immutable: boolean; pageCount: number } | null;
  live: null | {
    resolvedAt: string;
    services: Array<{ publicReference: string; bookingEligible: boolean; publicPrice?: { formatted: string }; waitlistEligible: boolean }>;
    staff: Array<{ publicReference: string; active: boolean; bookingEligible: boolean }>;
    locations: Array<{ publicReference: string; active: boolean; bookingEligible: boolean; opening: { state: string; label: string } }>;
    availability: Array<{ state: string; message: string }>;
    campaigns: Array<{ publicReference: string; message: string; placement: string }>;
    warnings: Array<{ code: string }>;
    telemetry: { cacheClass: string; cacheHit: boolean; fallbackActivated: boolean; queryCount: number; resolutionMs: number };
  };
  componentBindings: Array<{
    pagePath: string;
    sectionReference: string;
    sectionType: string;
    componentKey: string;
    liveDataCapabilities: string[];
    liveContentSlots: string[];
    rule: unknown;
    ruleState: { matches: boolean; indeterminate: boolean } | null;
    fallbackBehaviour: string;
    cacheClass: string;
    personalisationMode: string;
    seoImpact: string;
  }>;
  events: Array<{ reference: string; entityType: string; kind: string; changedFields: string[]; occurredAt: string; processedAt: string | null }>;
  assessments: Array<{ reference: string; classification: string; createdAt: string }>;
  proposals: Array<{ publicReference: string; status: string; summary: string; affectedPageReferences: string[]; recommendations: string[] }>;
  campaigns: Array<{ reference: string; status: string; message: string; placement: string; startsAt: string; endsAt: string }>;
}

const toneClass = {
  slate: 'border-slate-700 bg-slate-950/40 text-slate-200',
  amber: 'border-amber-700 bg-amber-950/40 text-amber-200',
  emerald: 'border-emerald-700 bg-emerald-950/40 text-emerald-200',
} as const;
const tag = (value: string, tone: keyof typeof toneClass = 'slate') => <span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase ${toneClass[tone]}`}>{value.replaceAll('_', ' ')}</span>;

export function LiveSiteIntelligencePanel({
  siteReference,
  canManage,
  canApprove,
}: {
  siteReference: string;
  canManage: boolean;
  canApprove: boolean;
}) {
  const [data, setData] = useState<LiveIntelligencePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await agencyFetch(`/sites/${siteReference}/live-intelligence`) as LiveIntelligencePayload);
    } catch (caught: any) {
      setError(caught.message || 'Live Site Intelligence could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [siteReference]);

  useEffect(() => { void load(); }, [load]);

  const processChanges = async () => {
    setBusy('process'); setError(''); setNotice('');
    try {
      const result = await agencyFetch(`/sites/${siteReference}/live-intelligence/process-changes`, { method: 'POST', body: '{}' }) as { processedCount: number };
      setNotice(`${result.processedCount} operational change${result.processedCount === 1 ? '' : 's'} assessed. Material changes remain in human review.`);
      await load();
    } catch (caught: any) { setError(caught.message); } finally { setBusy(''); }
  };

  const reviewProposal = async (reference: string, decision: 'APPROVED' | 'REJECTED') => {
    if (!window.confirm(`${decision === 'APPROVED' ? 'Approve' : 'Reject'} this proposal review decision? This records the decision only and does not publish or alter routing.`)) return;
    setBusy(reference); setError(''); setNotice('');
    try {
      await agencyFetch(`/sites/${siteReference}/live-intelligence/proposals/${reference}/review`, {
        method: 'POST', body: JSON.stringify({ decision }),
      });
      setNotice(`Proposal ${decision.toLowerCase()}. No published site state was changed.`);
      await load();
    } catch (caught: any) { setError(caught.message); } finally { setBusy(''); }
  };

  if (loading) return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading Live Site Intelligence…</div></section>;

  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-lg font-black"><Activity className="h-5 w-5 text-emerald-300" />Live Site Intelligence V1</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">Published strategy stays immutable. Anonymous-safe operational facts are resolved server-side, while material marketing or SEO consequences enter a governed proposal queue.</p></div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void load()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-3 text-xs font-black"><RefreshCw className="h-4 w-4" />Refresh</button>
        {canManage ? <button type="button" disabled={Boolean(busy)} onClick={() => void processChanges()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-3 text-xs font-black disabled:opacity-50"><ShieldCheck className="h-4 w-4" />Assess queued changes</button> : null}
      </div>
    </div>
    {error ? <p className="mt-4 rounded-xl border border-rose-800 bg-rose-950/30 p-3 text-xs text-rose-200">{error}</p> : null}
    {notice ? <p className="mt-4 rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 text-xs text-emerald-200">{notice}</p> : null}

    <div className="mt-5 grid gap-3 lg:grid-cols-3">
      {data ? (['published', 'live', 'personal'] as const).map(key => <article key={key} className="rounded-xl border border-slate-800 bg-slate-950 p-4"><div className="flex items-center justify-between"><strong className="text-xs uppercase tracking-widest">{key}</strong>{tag(key === 'personal' ? 'private/no-store' : key === 'published' ? 'immutable' : data.live?.telemetry.cacheClass || 'fallback')}</div><p className="mt-3 text-xs leading-5 text-slate-400">{data.dataClasses[key]}</p></article>) : null}
    </div>

    {data?.live ? <div className={`mt-4 rounded-xl border p-4 ${data.live.telemetry.fallbackActivated ? 'border-amber-800 bg-amber-950/20' : 'border-emerald-800 bg-emerald-950/20'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="flex items-center gap-2 text-sm"><Database className="h-4 w-4" />Current resolved public state</strong>{tag(data.live.telemetry.fallbackActivated ? 'fallback active' : 'healthy', data.live.telemetry.fallbackActivated ? 'amber' : 'emerald')}</div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6"><span>{data.live.services.length} services</span><span>{data.live.staff.length} staff</span><span>{data.live.locations.length} locations</span><span>{data.live.availability.length} summaries</span><span>{data.live.campaigns.length} active campaigns</span><span>{data.live.telemetry.resolutionMs}ms · {data.live.telemetry.queryCount} queries</span></div>
      {data.live.locations.map(location => <p key={location.publicReference} className="mt-2 text-xs text-slate-300">{location.opening.label} · {location.bookingEligible ? 'booking eligible' : 'not booking eligible'}</p>)}
    </div> : <p className="mt-4 rounded-xl border border-amber-800 bg-amber-950/20 p-4 text-xs text-amber-200"><TriangleAlert className="mr-2 inline h-4 w-4" />No published snapshot exists, so public live state is not resolved.</p>}

    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <div><h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Live component bindings</h3><div className="mt-3 max-h-96 space-y-2 overflow-auto">{data?.componentBindings.map(binding => <article key={binding.sectionReference} className="rounded-xl border border-slate-800 bg-slate-950 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs">{binding.sectionType} · {binding.componentKey}</strong>{tag(binding.cacheClass)}</div><p className="mt-2 text-[11px] text-slate-500">{binding.pagePath} · source PUBLISHED</p><dl className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2"><div><dt className="font-black text-slate-300">Live bindings</dt><dd className="text-slate-500">{binding.liveDataCapabilities.join(', ') || 'None'}</dd></div><div><dt className="font-black text-slate-300">Live slots</dt><dd className="text-slate-500">{binding.liveContentSlots.join(', ') || 'None'}</dd></div><div><dt className="font-black text-slate-300">Fallback</dt><dd className="text-slate-500">{binding.fallbackBehaviour.replaceAll('_', ' ')}</dd></div><div><dt className="font-black text-slate-300">SEO impact</dt><dd className="text-slate-500">{binding.seoImpact.replaceAll('_', ' ')}</dd></div></dl>{binding.rule ? <p className="mt-3 rounded-lg bg-slate-900 p-2 text-[11px]">Rule: {binding.ruleState?.indeterminate ? 'fallback' : binding.ruleState?.matches ? 'shown' : 'hidden'}</p> : null}</article>)}</div></div>
      <div><h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Change proposals</h3><div className="mt-3 space-y-2">{data?.proposals.length ? data.proposals.map(proposal => <article key={proposal.publicReference} className="rounded-xl border border-slate-800 bg-slate-950 p-3"><div className="flex items-center justify-between gap-2"><strong className="text-xs">{proposal.summary}</strong>{tag(proposal.status)}</div><p className="mt-2 text-[11px] text-slate-500">{proposal.affectedPageReferences.length} affected page{proposal.affectedPageReferences.length === 1 ? '' : 's'} · human approval required</p>{proposal.recommendations.map(item => <p key={item} className="mt-1 text-[11px] text-slate-400">• {item}</p>)}{canApprove && ['DRAFT', 'IN_REVIEW'].includes(proposal.status) ? <div className="mt-3 flex gap-2"><button disabled={Boolean(busy)} onClick={() => void reviewProposal(proposal.publicReference, 'APPROVED')} className="rounded-lg border border-emerald-700 px-3 py-2 text-[11px] font-black">Approve proposal</button><button disabled={Boolean(busy)} onClick={() => void reviewProposal(proposal.publicReference, 'REJECTED')} className="rounded-lg border border-rose-800 px-3 py-2 text-[11px] font-black">Reject</button></div> : null}</article>) : <p className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-500">No material published-change proposals.</p>}</div>
        <h3 className="mt-5 text-xs font-black uppercase tracking-widest text-slate-400">Operational event queue</h3><div className="mt-3 space-y-2">{data?.events.slice(0, 10).map(event => <article key={event.reference} className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs"><div className="flex items-center justify-between"><strong>{event.kind.replaceAll('_', ' ')}</strong>{tag(event.processedAt ? 'assessed' : 'queued', event.processedAt ? 'slate' : 'amber')}</div><p className="mt-2 text-[11px] text-slate-500">{event.entityType} · {event.changedFields.join(', ')}</p></article>)}</div>
      </div>
    </div>
  </section>;
}

export default LiveSiteIntelligencePanel;
