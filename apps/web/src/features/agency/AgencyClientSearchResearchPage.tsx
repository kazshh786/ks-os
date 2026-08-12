import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  DatabaseZap,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Loader2,
  Search,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { Link, useParams } from 'react-router';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';

const surface = 'rounded-3xl border border-slate-800/90 bg-slate-900/80 shadow-[0_24px_80px_rgba(2,6,23,0.2)]';
const primary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-black text-white transition hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-40';
const secondary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-black text-slate-200 transition hover:border-violet-500 disabled:cursor-not-allowed disabled:opacity-40';

type ExtractedRow = { keyword: string; monthlySearchVolume?: number; keywordDifficulty?: number; costPerClick?: number; clicks?: number; impressions?: number; position?: number; url?: string; competitor?: string };
type ResearchSource = {
  reference: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  providerHint: string;
  market: string;
  locale: string;
  location: string;
  language: string;
  device: string;
  capturedAt: string;
  status: 'PENDING_UPLOAD' | 'EXTRACTED' | 'APPLIED' | 'REJECTED' | 'QUARANTINED';
  extracted: { keywordCount?: number; metricRowCount?: number; headers?: string[]; rows?: ExtractedRow[]; textPreview?: string; warnings?: string[] };
  createdAt: string;
};

async function sha256(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
function providerLabel(value: string) {
  return value.replace(/^uploaded-/i, '').replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, char => char.toUpperCase());
}
function statusTone(status: ResearchSource['status']) {
  if (status === 'APPLIED') return 'border-emerald-700 bg-emerald-950/30 text-emerald-200';
  if (status === 'EXTRACTED') return 'border-amber-700 bg-amber-950/30 text-amber-100';
  if (status === 'REJECTED' || status === 'QUARANTINED') return 'border-rose-700 bg-rose-950/30 text-rose-200';
  return 'border-sky-700 bg-sky-950/30 text-sky-200';
}

function SourceCard({ source, siteReference, editable, onChanged }: { source: ResearchSource; siteReference: string; editable: boolean; onChanged: () => Promise<void> }) {
  const [expanded, setExpanded] = useState(source.status === 'EXTRACTED');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const rows = source.extracted?.rows ?? [];
  const warnings = source.extracted?.warnings ?? [];
  const command = async (key: string, path: string) => {
    setBusy(key); setError('');
    try { await agencyFetch(path, { method: 'POST', body: '{}' }); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The research source could not be updated.'); }
    finally { setBusy(''); }
  };
  return <article className={`${surface} overflow-hidden`}>
    <div className="p-5"><div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${statusTone(source.status)}`}>{source.status === 'EXTRACTED' ? 'Ready for review' : source.status.replaceAll('_', ' ')}</span><span className="text-xs font-bold text-slate-500">{providerLabel(source.providerHint)}</span></div><h3 className="mt-3 truncate text-lg font-black text-white" title={source.fileName}>{source.fileName}</h3><p className="mt-1 text-xs text-slate-500">{bytes(source.byteSize)} · {source.market} · {source.location} · {source.device.toLowerCase()}</p></div><div className="grid grid-cols-2 gap-2 text-center"><div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"><strong className="block text-lg text-white">{source.extracted?.keywordCount ?? 0}</strong><span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Keywords</span></div><div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"><strong className="block text-lg text-white">{source.extracted?.metricRowCount ?? 0}</strong><span className="text-[10px] font-black uppercase tracking-wide text-slate-500">With metrics</span></div></div></div>
      {warnings.length ? <div className="mt-4 space-y-2">{warnings.map(warning => <p key={warning} className="rounded-xl border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs leading-5 text-amber-100/80">{warning}</p>)}</div> : null}
      {source.extracted?.textPreview ? <details className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3"><summary className="cursor-pointer text-xs font-black text-slate-300">Extracted document text</summary><p className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-500">{source.extracted.textPreview}</p></details> : null}
      {rows.length ? <button type="button" className={`${secondary} mt-4`} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide extracted sample' : 'Review extracted sample'}</button> : null}
      {expanded && rows.length ? <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-950 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="p-3">Keyword / query</th><th>Volume</th><th>Difficulty</th><th>Clicks</th><th>Impressions</th><th>Position</th></tr></thead><tbody className="divide-y divide-slate-800">{rows.slice(0, 12).map((row, index) => <tr key={`${row.keyword}-${index}`}><td className="p-3 font-bold text-slate-200">{row.keyword}</td><td className="text-slate-400">{row.monthlySearchVolume ?? '—'}</td><td className="text-slate-400">{row.keywordDifficulty ?? '—'}</td><td className="text-slate-400">{row.clicks ?? '—'}</td><td className="text-slate-400">{row.impressions ?? '—'}</td><td className="text-slate-400">{row.position ?? '—'}</td></tr>)}</tbody></table>{rows.length > 12 ? <p className="border-t border-slate-800 p-3 text-xs text-slate-600">Showing 12 of {rows.length} extracted rows.</p> : null}</div> : null}
      {error ? <p role="alert" className="mt-3 text-xs font-bold text-rose-300">{error}</p> : null}
      {editable && source.status === 'EXTRACTED' ? <div className="mt-5 flex flex-wrap gap-2">{rows.length ? <button type="button" disabled={Boolean(busy)} className={primary} onClick={() => { if (window.confirm(`Add the reviewed search evidence from ${source.fileName} to the current DRAFT search strategy? Nothing will be approved automatically.`)) void command('apply', `/sites/${siteReference}/search-intelligence/research-sources/${source.reference}/apply`); }}>{busy === 'apply' ? <><Loader2 className="h-4 w-4 animate-spin" />Adding…</> : <><CheckCircle2 className="h-4 w-4" />Add to search strategy</>}</button> : null}<button type="button" disabled={Boolean(busy)} className={secondary} onClick={() => void command('reject', `/sites/${siteReference}/search-intelligence/research-sources/${source.reference}/reject`)}>{busy === 'reject' ? 'Dismissing…' : 'Dismiss source'}</button></div> : null}
    </div>
  </article>;
}

export default function AgencyClientSearchResearchPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { session } = useAgencyAuth();
  const canManage = Boolean(session?.capabilities.includes('sites.manage'));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [providerHint, setProviderHint] = useState('FILE_UPLOAD');
  const [market, setMarket] = useState('GB');
  const [locale, setLocale] = useState('en-GB');
  const [location, setLocation] = useState('United Kingdom');
  const [language, setLanguage] = useState('en');
  const [device, setDevice] = useState<'DESKTOP' | 'MOBILE'>('DESKTOP');

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true); setError('');
    try {
      const detail = await agencyFetch(`/tenants/${tenantId}`);
      const context = await agencyFetch(`/tenants/${detail.tenant.agencyReference}/delivery-context`);
      const siteReference = context.site?.reference || context.run?.siteReference || null;
      if (!siteReference) { setData({ detail, context, siteReference: null, blueprint: null, search: null, sources: [] }); return; }
      const [blueprints, searchResult, sourceResult] = await Promise.all([
        agencyFetch(`/sites/${siteReference}/blueprints`).catch(() => []),
        agencyFetch(`/sites/${siteReference}/search-intelligence`).catch((cause: any) => cause?.status === 404 ? null : Promise.reject(cause)),
        agencyFetch(`/sites/${siteReference}/search-intelligence/research-sources`).catch(() => ({ sources: [] })),
      ]);
      const search = searchResult;
      if (search?.strategy?.searchMarket) {
        const searchMarket = search.strategy.searchMarket;
        setMarket(searchMarket.countryCode || 'GB');
        setLocale(searchMarket.locale || 'en-GB');
        setLanguage(searchMarket.languageCode || 'en');
        if (searchMarket.locations?.[0]) setLocation(searchMarket.locations[0]);
      }
      setData({ detail, context, siteReference, blueprint: blueprints[0] || null, search, sources: sourceResult.sources || [] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Search research could not be loaded.'); }
    finally { setLoading(false); }
  }, [tenantId]);
  useEffect(() => { void load(); }, [load]);

  const sources: ResearchSource[] = data?.sources ?? [];
  const pendingReview = useMemo(() => sources.filter(source => source.status === 'EXTRACTED').length, [sources]);
  const createDraft = async () => {
    if (!data?.siteReference || data.blueprint?.status !== 'APPROVED') return;
    setBusy(true); setError('');
    try { await agencyFetch(`/sites/${data.siteReference}/search-intelligence/create-draft`, { method: 'POST', body: '{}' }); setNotice('Search planning draft created. You can now add real research.'); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The search planning draft could not be created.'); }
    finally { setBusy(false); }
  };
  const upload = async () => {
    if (!file || !data?.siteReference || !data.search) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const digestSha256 = await sha256(file);
      const initiated = await agencyFetch(`/sites/${data.siteReference}/search-intelligence/research-sources`, { method: 'POST', body: JSON.stringify({ fileName: file.name, mimeType: file.type, byteSize: file.size, digestSha256, providerHint, market, locale, location, language, device }) });
      const result = await fetch(initiated.signedUploadUrl, { method: 'PUT', headers: { 'content-type': file.type, 'x-upsert': 'false' }, body: file });
      if (!result.ok) throw new Error('The private research upload did not complete.');
      const completed = await agencyFetch(`/sites/${data.siteReference}/search-intelligence/research-sources/${initiated.reference}/complete`, { method: 'POST', body: '{}' });
      setFile(null);
      setNotice(completed.extracted.keywordCount ? `KS OS extracted ${completed.extracted.keywordCount} keyword${completed.extracted.keywordCount === 1 ? '' : 's'}. Review the sample before adding anything to the search strategy.` : 'Research uploaded privately. Review the extraction guidance before deciding what to do next.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The research file could not be uploaded.'); }
    finally { setBusy(false); }
  };

  if (loading && !data) return <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-5 w-5 animate-spin" />Loading search research…</div>;
  if (!tenantId) return null;
  const tenantName = data?.detail?.tenant?.name || 'Client';
  const websiteHref = `/agency/tenants/${tenantId}/fulfilment`;
  return <div className="space-y-6">
    <header><p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Website · Search</p><h1 className="mt-2 text-3xl font-black text-white">Research · {tenantName}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Upload raw search research, inspect what KS OS extracted, then explicitly decide whether it belongs in the DRAFT search strategy.</p></header>
    <nav aria-label="Search workspace" className="flex gap-2 overflow-x-auto"><span className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-black text-white">Research</span><Link className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs font-black text-slate-400 hover:text-white" to={`${websiteHref}?view=search`}>Strategy</Link><Link className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs font-black text-slate-400 hover:text-white" to={`${websiteHref}?view=search#page-briefs`}>Page briefs</Link></nav>
    {error ? <div role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/30 p-4 text-sm text-rose-200">{error}</div> : null}
    {notice ? <div className="rounded-2xl border border-emerald-800 bg-emerald-950/20 p-4 text-sm text-emerald-200">{notice}</div> : null}
    {!data?.siteReference ? <section className="rounded-2xl border border-amber-800 bg-amber-950/20 p-5"><h2 className="font-black text-amber-100">Create the website workspace first</h2><p className="mt-2 text-sm leading-6 text-amber-100/70">Search research is attached to a specific managed website. Continue Launch until the site workspace exists.</p><Link className={`${primary} mt-4`} to={`/agency/tenants/${tenantId}/onboarding`}>Continue launch <ArrowRight className="h-4 w-4" /></Link></section> : null}
    {data?.siteReference && !data.search ? <section className="rounded-2xl border border-amber-800 bg-amber-950/20 p-5"><h2 className="font-black text-amber-100">{data.blueprint?.status === 'APPROVED' ? 'Create the search planning draft first' : 'Approve the website structure first'}</h2><p className="mt-2 text-sm leading-6 text-amber-100/70">{data.blueprint?.status === 'APPROVED' ? 'Research must attach to the DRAFT search strategy for the exact approved website structure.' : 'Search planning is tied to the exact page architecture you approve.'}</p>{data.blueprint?.status === 'APPROVED' && canManage ? <button type="button" disabled={busy} className={`${primary} mt-4`} onClick={() => void createDraft()}>{busy ? 'Creating…' : 'Create search planning draft'}</button> : <Link className={`${primary} mt-4`} to={`/agency/tenants/${tenantId}/onboarding`}>Review website structure</Link>}</section> : null}
    {data?.siteReference && data.search ? <>
      <section className={`${surface} p-5 sm:p-6`}><div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex items-center gap-3"><UploadCloud className="h-6 w-6 text-violet-300" /><div><h2 className="text-xl font-black text-white">Add research</h2><p className="mt-1 text-sm text-slate-500">Nothing is added to Search Intelligence until you review and apply it.</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="rounded-2xl border-2 border-dashed border-slate-700 bg-slate-950/60 p-5 text-center transition hover:border-violet-600"><FileSpreadsheet className="mx-auto h-8 w-8 text-violet-300" /><span className="mt-3 block text-sm font-black text-white">{file ? file.name : 'Choose a research file'}</span><span className="mt-1 block text-xs text-slate-500">CSV · XLSX · JSON · PDF · TXT</span><input className="sr-only" type="file" accept=".csv,.xlsx,.json,.pdf,.txt,text/csv,text/plain,application/json,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label><div className="space-y-3 sm:col-span-1 lg:col-span-2"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-400">Source<select value={providerHint} onChange={event => setProviderHint(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="FILE_UPLOAD">Generic research export</option><option value="GOOGLE_SEARCH_CONSOLE">Google Search Console export</option><option value="GOOGLE_KEYWORD_PLANNER">Google Keyword Planner export</option><option value="AHREFS">Ahrefs export</option><option value="SEMRUSH">SEMrush export</option><option value="SERP_EXPORT">SERP analysis export</option></select></label><label className="text-xs font-bold text-slate-400">Device<select value={device} onChange={event => setDevice(event.target.value as 'DESKTOP' | 'MOBILE')} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="DESKTOP">Desktop</option><option value="MOBILE">Mobile</option></select></label><label className="text-xs font-bold text-slate-400">Market<input value={market} onChange={event => setMarket(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label><label className="text-xs font-bold text-slate-400">Search location<input value={location} onChange={event => setLocation(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label><label className="text-xs font-bold text-slate-400">Locale<input value={locale} onChange={event => setLocale(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label><label className="text-xs font-bold text-slate-400">Language<input value={language} onChange={event => setLanguage(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label></div><button type="button" disabled={!file || busy || !canManage} className={primary} onClick={() => void upload()}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" />Processing…</> : <><UploadCloud className="h-4 w-4" />Upload and extract</>}</button></div></div></div><div className="min-w-[220px] rounded-2xl border border-slate-800 bg-slate-950 p-4"><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Review queue</p><p className="mt-2 text-3xl font-black text-white">{pendingReview}</p><p className="mt-1 text-xs text-slate-500">source{pendingReview === 1 ? '' : 's'} waiting for your decision</p></div></div></section>
      <section className={`${surface} p-5`}><div className="flex items-start gap-3"><DatabaseZap className="mt-0.5 h-5 w-5 text-sky-300" /><div><h2 className="font-black text-white">Provider connections</h2><p className="mt-1 text-sm text-slate-500">Direct provider imports are deliberately shown as unavailable until a real authenticated connector is configured.</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{['Google Search Console', 'Google Keyword Planner', 'SEMrush', 'Ahrefs', 'SERP provider'].map(provider => <div key={provider} className="rounded-xl border border-slate-800 bg-slate-950 p-3"><p className="text-xs font-black text-slate-300">{provider}</p><p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-600">Not connected</p></div>)}</div></section>
      <section><div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-xl font-black text-white">Research sources</h2><p className="mt-1 text-sm text-slate-500">Private source files and their deterministic extraction previews.</p></div><Link className={secondary} to={`${websiteHref}?view=search`}><Search className="h-4 w-4" />Open strategy</Link></div>{sources.length ? <div className="space-y-4">{sources.map(source => <SourceCard key={source.reference} source={source} siteReference={data.siteReference} editable={canManage && data.search.status !== 'APPROVED'} onChanged={load} />)}</div> : <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center"><FileSearch className="mx-auto h-7 w-7 text-slate-600" /><p className="mt-3 font-black text-slate-300">No research uploaded yet</p><p className="mt-1 text-xs text-slate-600">Add a keyword export or research document above.</p></div>}</section>
      <div className="rounded-2xl border border-sky-800/50 bg-sky-950/20 p-4 text-sm text-sky-100"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /><p><strong>Human approval stays separate.</strong> Applying reviewed research updates the DRAFT strategy and page briefs; it does not approve Search Intelligence, generate a website or publish anything.</p></div></div>
    </> : null}
  </div>;
}
