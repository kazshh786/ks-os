import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Monitor, Save, Search, ShieldCheck, Smartphone } from 'lucide-react';
import { agencyFetch, type AgencyRequestError } from './AgencyAuth';

interface SearchBrief {
  reference: string;
  pageReference: string;
  pageType: string;
  status: 'DRAFT' | 'APPROVED' | 'SUPERSEDED';
  primaryKeyword: string;
  secondaryKeywords: string[];
  primaryTopic: string;
  secondaryTopics: string[];
  primarySearchIntent: string;
  secondarySearchIntents: string[];
  audienceSegmentKeys: string[];
  canonicalPath: string;
  recommendedTitle: string;
  recommendedMetaDescription: string;
  recommendedH1: string;
  recommendedH2Topics: string[];
  schemaTypes: string[];
  contentFormat: string;
  minimumContentDepthWords: number;
  internalLinksOut: Array<{ targetPageReference: string; anchorText: string }>;
  contentRisk: { ymyl: string };
}

interface SearchStrategy {
  reference: string;
  strategyVersion: number;
  status: 'DRAFT' | 'APPROVED' | 'SUPERSEDED';
  targetAudience: { segments: Array<{ key: string; name: string }> };
  searchMarket: { countryCode: string; locale: string; locations: string[] };
  searchIntentClusters: Array<{ key: string; intent: string; keywords: string[] }>;
  topicClusters: Array<{ key: string; name: string; pillarPageReference: string; supportingPageReferences: string[] }>;
  pageOpportunityMap: Array<{ pageReference: string; opportunity: string; primaryIntent: string; priority: string }>;
  provenance: { providerKey: string; modelKey: string; generatedAt: string };
}

interface SearchIntelligencePayload {
  strategy: SearchStrategy;
  briefs: SearchBrief[];
  status: SearchStrategy['status'];
  approvedAt: string | null;
  researchReadiness: {
    status: 'RESEARCH_REQUIRED' | 'QUALIFIED';
    findings: Array<{ code: string; message: string; blocking: boolean }>;
  };
  researchFreshness: { staleCount: number; evidenceCount: number };
}

const label = (value: string) => value.replaceAll('_', ' ').toLowerCase();

function SerpCard({
  brief,
  siteName,
  mobile,
}: {
  brief: SearchBrief;
  siteName: string;
  mobile: boolean;
}) {
  return <div className={`rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm ${mobile ? 'max-w-[390px]' : ''}`}>
    <div className="flex items-center gap-2">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-900 text-xs font-black text-white">{siteName.slice(0, 1).toUpperCase()}</span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{siteName}</p>
        <p className="truncate text-[11px] text-slate-600">example.com › {brief.canonicalPath === '/' ? '' : brief.canonicalPath.slice(1).replaceAll('/', ' › ')}</p>
      </div>
    </div>
    <h4 className={`${mobile ? 'mt-3 text-lg' : 'mt-3 text-xl'} font-medium leading-6 text-[#1a0dab]`}>{brief.recommendedTitle}</h4>
    <p className="mt-1 text-sm leading-5 text-slate-700">{brief.recommendedMetaDescription}</p>
    {brief.schemaTypes.length > 0 ? <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Eligible structured data: {brief.schemaTypes.map(label).join(' · ')}</p> : null}
  </div>;
}

export function SearchIntelligencePanel({
  siteReference,
  siteName,
  canManage,
  pageTitlesByReference,
}: {
  siteReference: string;
  siteName: string;
  canManage: boolean;
  pageTitlesByReference: Record<string, string>;
}) {
  const [data, setData] = useState<SearchIntelligencePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notCreated, setNotCreated] = useState(false);
  const [selectedBriefReference, setSelectedBriefReference] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await agencyFetch(`/sites/${siteReference}/search-intelligence`) as SearchIntelligencePayload;
      setData(result);
      setNotCreated(false);
      setSelectedBriefReference(current => current && result.briefs.some(brief => brief.reference === current)
        ? current
        : result.briefs[0]?.reference ?? '');
    } catch (caught) {
      const requestError = caught as AgencyRequestError;
      if (requestError.status === 404) {
        setNotCreated(true);
        setData(null);
      } else setError(requestError.message || 'Search Intelligence could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [siteReference]);

  useEffect(() => { void load(); }, [load]);

  const brief = data?.briefs.find(item => item.reference === selectedBriefReference) ?? null;
  useEffect(() => {
    setTitleDraft(brief?.recommendedTitle ?? '');
    setDescriptionDraft(brief?.recommendedMetaDescription ?? '');
  }, [brief?.reference, brief?.recommendedTitle, brief?.recommendedMetaDescription]);

  const collisions = useMemo(() => {
    const owners = new Map<string, SearchBrief[]>();
    for (const item of data?.briefs ?? []) {
      const key = item.primaryKeyword.trim().toLocaleLowerCase();
      owners.set(key, [...(owners.get(key) ?? []), item]);
    }
    return [...owners.entries()].filter(([, values]) => values.length > 1);
  }, [data?.briefs]);

  const saveMetadata = async () => {
    if (!data || !brief) return;
    setBusy('save'); setError(''); setNotice('');
    try {
      await agencyFetch(`/sites/${siteReference}/search-intelligence/strategies/${data.strategy.reference}/briefs/${brief.reference}/metadata`, {
        method: 'PATCH',
        body: JSON.stringify({ recommendedTitle: titleDraft, recommendedMetaDescription: descriptionDraft }),
      });
      setNotice('Draft title and description recommendations saved. The brief remains unapproved.');
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally { setBusy(''); }
  };

  const approve = async () => {
    if (!data || !window.confirm('Approve this exact Search Intelligence strategy and every bound page SEO brief? Approved artifacts become immutable and generation will be pinned to this digest.')) return;
    setBusy('approve'); setError(''); setNotice('');
    try {
      await agencyFetch(`/sites/${siteReference}/search-intelligence/strategies/${data.strategy.reference}/approve`, { method: 'POST', body: '{}' });
      setNotice('Search Intelligence strategy and all bound page briefs were explicitly approved.');
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally { setBusy(''); }
  };

  const createPlatformDraft = async () => {
    setBusy('create'); setError(''); setNotice('');
    try {
      const created = await agencyFetch(`/sites/${siteReference}/search-intelligence/create-draft`, { method: 'POST', body: '{}' });
      setNotice(`Planning draft created with ${created.pageCount} blueprint-bound page briefs. Governed search research, evidence import and agency approval are still required.`);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally { setBusy(''); }
  };

  const importResearchBundle = async (file: File) => {
    setBusy('import'); setError(''); setNotice('');
    try {
      const bundle = JSON.parse(await file.text()) as unknown;
      await agencyFetch(`/sites/${siteReference}/search-intelligence/strategies`, {
        method: 'POST',
        body: JSON.stringify(bundle),
      });
      setNotice('Governed research strategy, evidence and page briefs imported as a new draft for agency review.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The governed research bundle could not be imported.');
    } finally { setBusy(''); }
  };

  if (loading) return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading governed Search Intelligence…</div></section>;
  if (notCreated) return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><h2 className="flex items-center gap-2 text-sm font-black"><Search className="h-4 w-4 text-violet-300" />Search Intelligence V2</h2><p className="mt-2 text-xs leading-5 text-slate-400">No versioned strategy exists for this site. Create a governed planning draft from the exact approved blueprint; it will include one brief per page and remain blocked from approval and generation until governed research evidence is imported and reviewed.</p>{error ? <p role="alert" className="mt-4 rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-xs text-rose-200">{error}</p> : null}<button type="button" disabled={!canManage || Boolean(busy)} onClick={() => void createPlatformDraft()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-black disabled:opacity-40">{busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Create planning draft</button><p className="mt-3 text-[11px] leading-5 text-slate-500">The initial draft uses blueprint context only and records that no external SERP evidence or keyword metrics have yet been asserted.</p></section>;
  if (!data || !brief) return null;

  const isDraft = data.status === 'DRAFT';
  const researchRequired = data.researchReadiness?.status === 'RESEARCH_REQUIRED'
    || data.strategy.provenance.providerKey === 'ks-os-governed-draft'
    || data.researchFreshness.evidenceCount === 0;
  const provider = `${data.strategy.provenance.providerKey} · ${data.strategy.provenance.modelKey}`;
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-black"><Search className="h-5 w-5 text-violet-300" />Search Intelligence V2</h2>
        <p className="mt-1 text-xs text-slate-500">Version {data.strategy.strategyVersion} · {provider} · generated {new Date(data.strategy.provenance.generatedAt).toLocaleString()}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-3 py-1 text-[10px] font-black ${data.status === 'APPROVED' ? 'border-emerald-700 bg-emerald-950/40 text-emerald-200' : 'border-amber-700 bg-amber-950/40 text-amber-200'}`}>{data.status}</span>
        <span className={`rounded-full border px-3 py-1 text-[10px] font-black ${data.researchFreshness.staleCount ? 'border-rose-800 text-rose-300' : 'border-slate-700 text-slate-300'}`}>{data.researchFreshness.staleCount ? `${data.researchFreshness.staleCount} STALE` : `${data.researchFreshness.evidenceCount} EVIDENCE · CURRENT`}</span>
      </div>
    </div>
    {error ? <p role="alert" className="mt-4 rounded-xl border border-rose-900 bg-rose-950/30 p-3 text-xs text-rose-200">{error}</p> : null}
    {notice ? <p role="status" className="mt-4 rounded-xl border border-emerald-900 bg-emerald-950/30 p-3 text-xs text-emerald-200">{notice}</p> : null}
    {researchRequired ? <div className="mt-4 rounded-xl border border-amber-800 bg-amber-950/25 p-4"><p className="flex items-center gap-2 text-xs font-black text-amber-200"><AlertTriangle className="h-4 w-4" />Research required</p><p className="mt-2 text-xs leading-5 text-amber-100/80">This is a blueprint-context planning draft. It cannot be approved or used for website generation until a governed research bundle with referenced evidence and one complete brief per blueprint page is imported and reviewed.</p>{isDraft && canManage ? <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-amber-700 px-4 text-xs font-black text-amber-200"><Search className="h-4 w-4" />{busy === 'import' ? 'Importing governed research…' : 'Import governed research bundle'}<input type="file" accept="application/json,.json" disabled={Boolean(busy)} className="sr-only" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importResearchBundle(file); }} /></label> : null}</div> : null}

    <div className="mt-5 grid gap-3 md:grid-cols-4">
      <div className="rounded-xl bg-slate-950 p-3"><small className="font-black uppercase text-slate-500">Audience</small><p className="mt-2 text-xs leading-5">{data.strategy.targetAudience.segments.map(segment => segment.name).join(' · ')}</p></div>
      <div className="rounded-xl bg-slate-950 p-3"><small className="font-black uppercase text-slate-500">Market</small><p className="mt-2 text-xs leading-5">{data.strategy.searchMarket.locale} · {data.strategy.searchMarket.countryCode}<br />{data.strategy.searchMarket.locations.join(' · ') || 'No local targeting'}</p></div>
      <div className="rounded-xl bg-slate-950 p-3"><small className="font-black uppercase text-slate-500">Intent and topics</small><p className="mt-2 text-xs leading-5">{data.strategy.searchIntentClusters.length} intent clusters · {data.strategy.topicClusters.length} topic clusters</p></div>
      <div className="rounded-xl bg-slate-950 p-3"><small className="font-black uppercase text-slate-500">Ownership</small><p className={`mt-2 text-xs leading-5 ${collisions.length ? 'text-rose-300' : 'text-emerald-300'}`}>{collisions.length ? `${collisions.length} cannibalisation collision(s)` : 'No duplicate primary keyword owner'}</p></div>
    </div>

    <div className="mt-5 grid gap-5 xl:grid-cols-[270px_1fr]">
      <aside>
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Page opportunities and briefs</h3>
        <div className="mt-3 max-h-[620px] space-y-2 overflow-y-auto pr-1">
          {data.briefs.map(item => {
            const opportunity = data.strategy.pageOpportunityMap.find(value => value.pageReference === item.pageReference);
            return <button key={item.reference} type="button" onClick={() => setSelectedBriefReference(item.reference)} className={`w-full rounded-xl border p-3 text-left ${brief.reference === item.reference ? 'border-violet-500 bg-violet-950/30' : 'border-slate-800 bg-slate-950'}`}>
              <strong className="block text-xs">{pageTitlesByReference[item.pageReference] ?? item.recommendedH1}</strong>
              <span className="mt-1 block text-[10px] text-slate-500">{label(item.pageType)} · {label(item.primarySearchIntent)} · {opportunity?.priority ?? 'UNRANKED'}</span>
              <span className="mt-2 block text-[10px] leading-4 text-slate-400">{opportunity?.opportunity ?? item.primaryTopic}</span>
            </button>;
          })}
        </div>
      </aside>

      <div className="space-y-5">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4"><small className="font-black uppercase text-slate-500">Intent</small><p className="mt-2 text-sm font-bold capitalize">{label(brief.primarySearchIntent)}</p><p className="mt-2 text-[11px] text-slate-500">Audience: {brief.audienceSegmentKeys.join(' · ')}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4"><small className="font-black uppercase text-slate-500">Topic ownership</small><p className="mt-2 text-sm font-bold">{brief.primaryKeyword}</p><p className="mt-2 text-[11px] text-slate-500">{brief.secondaryKeywords.join(' · ') || 'No secondary keywords'}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4"><small className="font-black uppercase text-slate-500">Content and trust</small><p className="mt-2 text-sm font-bold capitalize">{label(brief.contentFormat)} · {brief.minimumContentDepthWords}+ words</p><p className="mt-2 text-[11px] text-slate-500">YMYL: {brief.contentRisk.ymyl} · {brief.schemaTypes.map(label).join(' · ')}</p></div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
          <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-black">Page SEO brief review</h3><p className="mt-1 text-[11px] text-slate-500">Canonical {brief.canonicalPath} · H1 {brief.recommendedH1}</p></div><span className="text-[10px] font-black text-slate-500">{brief.status}</span></div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <label className="text-[10px] font-black uppercase text-slate-500">Recommended title · {titleDraft.length}/70<input value={titleDraft} maxLength={70} disabled={!isDraft || !canManage} onChange={event => setTitleDraft(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm font-normal normal-case text-white disabled:opacity-60" /></label>
            <label className="text-[10px] font-black uppercase text-slate-500">Recommended description · {descriptionDraft.length}/170<textarea value={descriptionDraft} maxLength={170} rows={3} disabled={!isDraft || !canManage} onChange={event => setDescriptionDraft(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm font-normal normal-case text-white disabled:opacity-60" /></label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={!isDraft || !canManage || Boolean(busy) || !titleDraft.trim() || !descriptionDraft.trim()} onClick={() => void saveMetadata()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-700 px-4 text-xs font-black disabled:opacity-40">{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save draft metadata</button>
            {isDraft ? <button type="button" disabled={!canManage || Boolean(busy) || collisions.length > 0 || researchRequired} onClick={() => void approve()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-700 px-4 text-xs font-black text-emerald-300 disabled:opacity-40">{busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Approve exact strategy and briefs</button> : <span className="inline-flex min-h-11 items-center gap-2 text-xs font-black text-emerald-300"><Check className="h-4 w-4" />Immutable approved artifact</span>}
          </div>
          {collisions.length > 0 ? <p className="mt-3 flex items-center gap-2 text-xs text-rose-300"><AlertTriangle className="h-4 w-4" />Approval is disabled until duplicate primary keyword ownership is resolved.</p> : null}
          {researchRequired ? <p className="mt-3 flex items-center gap-2 text-xs text-amber-300"><AlertTriangle className="h-4 w-4" />Approval is disabled until governed search research and referenced evidence are present.</p> : null}
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-black uppercase tracking-widest text-slate-400">SERP preview</h3><p className="text-[10px] text-amber-300">Approximation only — search engines may rewrite presentation.</p></div>
          <div className="mt-3 grid gap-4 xl:grid-cols-2">
            <div><p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase text-slate-500"><Monitor className="h-3 w-3" />Desktop approximation</p><SerpCard brief={{ ...brief, recommendedTitle: titleDraft, recommendedMetaDescription: descriptionDraft }} siteName={siteName} mobile={false} /></div>
            <div><p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase text-slate-500"><Smartphone className="h-3 w-3" />Mobile approximation</p><SerpCard brief={{ ...brief, recommendedTitle: titleDraft, recommendedMetaDescription: descriptionDraft }} siteName={siteName} mobile /></div>
          </div>
        </div>
      </div>
    </div>
  </section>;
}

export default SearchIntelligencePanel;
