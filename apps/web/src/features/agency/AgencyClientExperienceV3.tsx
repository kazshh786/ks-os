import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  FileImage,
  FileSearch,
  Globe2,
  LayoutTemplate,
  Loader2,
  MonitorCog,
  Search,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';
import { AgencyLaunchCommandCenter } from './AgencyLaunchCommandCenter';

const surface = 'rounded-3xl border border-slate-800/90 bg-slate-900/80 shadow-[0_24px_80px_rgba(2,6,23,0.24)]';
const primary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-black text-white transition hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-40';
const secondary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 text-sm font-bold text-slate-200 transition hover:border-slate-600 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-40';

export type HumanWorkState = 'NEEDS_YOU' | 'WAITING' | 'IN_PROGRESS' | 'READY' | 'COMPLETE' | 'PROBLEM';
export function humanWorkStateLabel(value: HumanWorkState) {
  return ({ NEEDS_YOU: 'Needs you', WAITING: 'Waiting', IN_PROGRESS: 'In progress', READY: 'Ready', COMPLETE: 'Complete', PROBLEM: 'Problem' } as const)[value];
}
function stateTone(value: HumanWorkState) {
  if (value === 'COMPLETE' || value === 'READY') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
  if (value === 'NEEDS_YOU') return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
  if (value === 'WAITING' || value === 'IN_PROGRESS') return 'border-sky-400/30 bg-sky-400/10 text-sky-100';
  return 'border-rose-400/30 bg-rose-400/10 text-rose-200';
}
function StatusPill({ value }: { value: HumanWorkState }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${stateTone(value)}`}>{humanWorkStateLabel(value)}</span>;
}
function Guidance({ tone, title, children }: { tone: 'info' | 'warning' | 'error' | 'success'; title: string; children: React.ReactNode }) {
  const styles = { info: 'border-sky-700/60 bg-sky-950/20 text-sky-100', warning: 'border-amber-700/60 bg-amber-950/20 text-amber-100', error: 'border-rose-700/60 bg-rose-950/25 text-rose-100', success: 'border-emerald-700/60 bg-emerald-950/20 text-emerald-100' }[tone];
  const Icon = tone === 'error' ? CircleAlert : tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : ShieldCheck;
  return <section className={`rounded-2xl border p-4 ${styles}`}><div className="flex items-start gap-3"><Icon className="mt-0.5 h-5 w-5 shrink-0" /><div className="min-w-0 flex-1"><h3 className="font-black">{title}</h3><div className="mt-1 text-sm leading-6 opacity-80">{children}</div></div></div></section>;
}
function phaseState({ complete, needsYou, waiting, ready }: { complete?: boolean; needsYou?: boolean; waiting?: boolean; ready?: boolean }): HumanWorkState {
  if (complete) return 'COMPLETE';
  if (needsYou) return 'NEEDS_YOU';
  if (waiting) return 'WAITING';
  if (ready) return 'READY';
  return 'IN_PROGRESS';
}
function LaunchPhase({ number, title, items, active }: { number: number; title: string; items: Array<{ label: string; state: HumanWorkState }>; active: boolean }) {
  return <section className={`rounded-2xl border p-4 ${active ? 'border-violet-500/60 bg-violet-950/20' : 'border-slate-800 bg-slate-950/50'}`}><div className="flex items-center gap-3"><span className={`grid h-9 w-9 place-items-center rounded-xl text-sm font-black ${active ? 'bg-violet-600 text-white' : 'bg-slate-900 text-slate-400'}`}>{number}</span><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Phase {number}</p><h3 className="font-black text-white">{title}</h3></div></div><div className="mt-4 space-y-2">{items.map(item => <div key={item.label} className="flex items-center justify-between gap-3 rounded-xl bg-slate-900/60 px-3 py-2"><span className="text-xs font-bold text-slate-300">{item.label}</span><StatusPill value={item.state} /></div>)}</div></section>;
}

type LaunchData = { context: any; booking: any; questionnaires: any[]; siteReference: string | null; blueprint: any; search: any; generations: any[]; quality: any[]; domains: any[]; publications: any[] };

export function AgencyLaunchJourneyV3({ tenantReference, tenantDetail, onBack }: { tenantReference: string; tenantDetail: any; onBack: () => void }) {
  const [data, setData] = useState<LaunchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [context, booking, questionnaires] = await Promise.all([
        agencyFetch(`/tenants/${tenantReference}/delivery-context`),
        agencyFetch(`/tenants/${tenantReference}/onboarding-booking`),
        agencyFetch(`/fact-finding/questionnaires?tenantReference=${encodeURIComponent(tenantReference)}`),
      ]);
      const siteReference = context.site?.reference || context.run?.siteReference || null;
      let blueprint = null; let search = null; let generations: any[] = []; let quality: any[] = []; let domains: any[] = []; let publications: any[] = [];
      if (siteReference) {
        const [blueprints, searchPayload, generationRows, qualityRows, domainRows, publicationRows] = await Promise.all([
          agencyFetch(`/sites/${siteReference}/blueprints`).catch(() => []),
          agencyFetch(`/sites/${siteReference}/search-intelligence`).catch(() => null),
          agencyFetch(`/sites/${siteReference}/generation-runs`).catch(() => []),
          agencyFetch(`/sites/${siteReference}/quality-runs`).catch(() => []),
          agencyFetch(`/sites/${siteReference}/domains`).catch(() => []),
          agencyFetch(`/sites/${siteReference}/publications`).catch(() => []),
        ]);
        blueprint = blueprints[0] || null; search = searchPayload; generations = generationRows; quality = qualityRows; domains = domainRows; publications = publicationRows;
      }
      setData({ context, booking, questionnaires, siteReference, blueprint, search, generations, quality, domains, publications });
    } catch (cause) { setData(null); setError(cause instanceof Error ? cause.message : 'The client launch workspace could not be loaded.'); }
    finally { setLoading(false); }
  }, [tenantReference]);
  useEffect(() => { void load(); }, [load]);

  if (loading && !data) return <section className={`${surface} p-8`}><div className="flex items-center gap-3 text-sm text-slate-400"><Loader2 className="h-5 w-5 animate-spin" />Loading the client launch plan…</div></section>;
  if (error && !data) return <Guidance tone="error" title="The launch plan could not be loaded"><p>{error}</p><button type="button" onClick={() => void load()} className={`${secondary} mt-4`}>Try again</button></Guidance>;
  if (!data) return null;

  const discovery = data.questionnaires[0] || null;
  const discoveryComplete = Boolean(discovery && ['SUBMITTED', 'AGENCY_REVIEW', 'APPROVED'].includes(discovery.status));
  const discoveryWaiting = Boolean(discovery && ['INVITED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'].includes(discovery.status));
  const factsComplete = data.context.productionBrief?.status === 'LOCKED_FOR_PROVISIONING';
  const bookingComplete = data.booking.readiness?.readyForBuild === true;
  const assetsComplete = Number(discovery?.approvedAssetCount || 0) > 0;
  const planComplete = Boolean(data.context.draft);
  const blueprintComplete = data.blueprint?.status === 'APPROVED';
  const researchRequired = Boolean(data.search && (data.search.researchReadiness?.status === 'RESEARCH_REQUIRED' || Number(data.search.researchFreshness?.evidenceCount || 0) === 0));
  const searchComplete = data.search?.status === 'APPROVED' && !researchRequired;
  const generationComplete = Boolean(data.generations[0] && ['READY_FOR_REVIEW', 'DESIGN_COMPLETE', 'GENERATION_COMPLETE'].includes(data.generations[0].status));
  const qualityComplete = Boolean(data.quality[0] && ['PASSED', 'PASS', 'COMPLETE', 'COMPLETED'].includes(data.quality[0].status));
  const domainComplete = Boolean(data.domains.find(domain => (domain.domainRole || domain.role) === 'CANONICAL'));
  const published = Boolean(data.publications[0]);
  const phases = [
    { title: 'Understand', complete: discoveryComplete && factsComplete, items: [
      { label: 'Client details', state: 'COMPLETE' as HumanWorkState },
      { label: 'Discovery', state: phaseState({ complete: discoveryComplete, waiting: discoveryWaiting, needsYou: !discoveryWaiting && !discoveryComplete }) },
      { label: 'Confirm business information', state: phaseState({ complete: factsComplete, needsYou: discoveryComplete && !factsComplete, waiting: !discoveryComplete }) },
    ] },
    { title: 'Set up', complete: bookingComplete && assetsComplete, items: [
      { label: 'Booking', state: phaseState({ complete: bookingComplete, needsYou: factsComplete && !bookingComplete, waiting: !factsComplete }) },
      { label: 'Brand and images', state: phaseState({ complete: assetsComplete, needsYou: discoveryComplete && !assetsComplete, waiting: !discoveryComplete }) },
    ] },
    { title: 'Plan website', complete: planComplete && blueprintComplete && searchComplete, items: [
      { label: 'Pages and priorities', state: phaseState({ complete: planComplete, needsYou: factsComplete && bookingComplete && !planComplete, waiting: !factsComplete || !bookingComplete }) },
      { label: 'Website structure', state: phaseState({ complete: blueprintComplete, needsYou: planComplete && !blueprintComplete, waiting: !planComplete }) },
      { label: 'Search strategy', state: phaseState({ complete: searchComplete, needsYou: blueprintComplete && !searchComplete, waiting: !blueprintComplete }) },
    ] },
    { title: 'Build and review', complete: generationComplete && qualityComplete, items: [
      { label: 'Generate website', state: phaseState({ complete: generationComplete, ready: searchComplete && !generationComplete, waiting: !searchComplete }) },
      { label: 'Design and quality review', state: phaseState({ complete: qualityComplete, needsYou: generationComplete && !qualityComplete, waiting: !generationComplete }) },
    ] },
    { title: 'Go live', complete: published, items: [
      { label: 'Domain', state: phaseState({ complete: domainComplete, needsYou: generationComplete && !domainComplete, waiting: !generationComplete }) },
      { label: 'Publish', state: phaseState({ complete: published, ready: qualityComplete && domainComplete && !published, waiting: !qualityComplete || !domainComplete }) },
    ] },
  ];
  const activePhase = Math.max(0, phases.findIndex(phase => !phase.complete));
  const tenantId = tenantDetail.tenant.id;
  const discoveryHref = `/agency/fact-finding?tenant=${tenantReference}${discovery ? `&questionnaire=${discovery.reference}` : ''}`;
  const assetLibraryHref = `/agency/tenants/${tenantId}/onboarding?view=assets`;
  const websiteHref = `/agency/tenants/${tenantId}/fulfilment`;
  const researchHref = `${websiteHref}?view=research`;

  let title = 'Launch complete'; let description = 'The client website has a live publication. Continue with ongoing website and operational improvements.'; let action: React.ReactNode = <Link className={primary} to={websiteHref}>Open website workspace <ArrowRight className="h-4 w-4" /></Link>;
  if (!discovery) { title = 'Start client discovery'; description = 'Collect the information, permissions and assets KS OS needs before planning the website.'; action = <Link className={primary} to={discoveryHref}>Start discovery <ArrowRight className="h-4 w-4" /></Link>; }
  else if (!discoveryComplete) { title = discoveryWaiting ? 'Waiting for client discovery' : 'Finish client discovery'; description = discoveryWaiting ? 'The client still has information to provide. Review progress without advancing the website prematurely.' : 'Complete or review the current discovery before approving public business information.'; action = <Link className={primary} to={discoveryHref}>Open discovery <ArrowRight className="h-4 w-4" /></Link>; }
  else if (!factsComplete) { title = 'Confirm the business information'; description = 'Review what may appear publicly, resolve evidence requests and lock the approved business information.'; action = <Link className={primary} to={discoveryHref}>Review business information <ArrowRight className="h-4 w-4" /></Link>; }
  else if (!bookingComplete) { title = 'Complete booking setup'; description = 'Services, locations, staff or availability still need to be ready before the website can use booking actions.'; action = <Link className={primary} to={`/agency/bookings?tenant=${tenantReference}`}>Open booking setup <ArrowRight className="h-4 w-4" /></Link>; }
  else if (!assetsComplete) { title = 'Review brand and images'; description = 'Upload and approve the client logo, team or location imagery and supporting assets before design work.'; action = <Link className={primary} to={assetLibraryHref}>Open brand and assets <ArrowRight className="h-4 w-4" /></Link>; }
  else if (!planComplete || !blueprintComplete) { title = !planComplete ? 'Prepare the website plan' : 'Review the website structure'; description = !planComplete ? 'Confirm pages, priorities and design direction before KS OS proposes the architecture.' : 'Review the exact page set, hierarchy and URLs before search planning begins.'; action = <button type="button" className={primary} onClick={() => setAdvanced(true)}>Open launch controls <ArrowRight className="h-4 w-4" /></button>; }
  else if (!searchComplete) { title = researchRequired ? 'Add real search research' : 'Review the search strategy'; description = researchRequired ? 'The planning draft needs governed search evidence before it can be approved.' : 'Review the page-by-page search plan and explicitly approve it before website generation.'; action = <Link className={primary} to={researchRequired ? researchHref : `${websiteHref}?view=search`}>{researchRequired ? 'Open research inbox' : 'Open search strategy'} <ArrowRight className="h-4 w-4" /></Link>; }
  else if (!generationComplete) { title = 'Build the website'; description = 'All planning prerequisites are approved. You can now create the governed draft website.'; action = <button type="button" className={primary} onClick={() => setAdvanced(true)}>Open build controls <ArrowRight className="h-4 w-4" /></button>; }
  else if (!qualityComplete) { title = 'Review the website and quality checks'; description = 'Generation produced a candidate website. Review design, content and launch blockers before approval.'; action = <Link className={primary} to={`${websiteHref}?view=quality`}>Review website <ArrowRight className="h-4 w-4" /></Link>; }
  else if (!domainComplete || !published) { title = !domainComplete ? 'Connect the primary website address' : 'Ready for the final launch decision'; description = !domainComplete ? 'The website is ready, but its primary domain still needs to be connected and verified.' : 'Quality has passed and the domain is ready. Publication remains an explicit human decision.'; action = <Link className={primary} to={`${websiteHref}?view=launch`}>Open launch checklist <ArrowRight className="h-4 w-4" /></Link>; }

  return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={onBack} className={secondary}>← Client overview</button><span className="text-xs font-black uppercase tracking-[0.16em] text-violet-300">Launch workspace</span></div><section className="rounded-3xl border border-violet-500/30 bg-gradient-to-br from-violet-500/15 via-slate-900 to-slate-950 p-6 sm:p-8"><p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">What needs attention now</p><h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">{title}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">{description}</p><div className="mt-5">{action}</div></section><div className="grid gap-4 xl:grid-cols-5">{phases.map((phase, index) => <LaunchPhase key={phase.title} number={index + 1} title={phase.title} items={phase.items} active={index === activePhase} />)}</div><section className={`${surface} p-5`}><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Advanced controls</p><h2 className="mt-1 text-lg font-black text-white">Open these only when a launch step asks you to</h2><p className="mt-1 text-sm text-slate-500">The governed controls remain available without defining the primary experience.</p></div><button type="button" className={secondary} onClick={() => setAdvanced(value => !value)}>{advanced ? 'Hide controls' : 'Show controls'}</button></div>{advanced ? <div className="mt-6 border-t border-slate-800 pt-6"><AgencyLaunchCommandCenter tenantReference={tenantReference} tenantDetail={tenantDetail} onBack={onBack} /></div> : null}</section></div>;
}

function WebsiteTabs({ tenantId, active }: { tenantId: string; active: string }) {
  const tabs = [['overview', 'Overview'], ['pages', 'Pages'], ['search', 'Search'], ['quality', 'Quality'], ['launch', 'Launch']];
  return <nav aria-label="Website workspace" className="flex gap-2 overflow-x-auto pb-1">{tabs.map(([key, label]) => <Link key={key} to={`/agency/tenants/${tenantId}/fulfilment${key === 'overview' ? '' : `?view=${key}`}`} className={`shrink-0 rounded-xl px-4 py-2 text-xs font-black transition ${active === key ? 'bg-violet-600 text-white' : 'border border-slate-800 bg-slate-950 text-slate-400 hover:text-white'}`}>{label}</Link>)}</nav>;
}

function SearchStrategyWorkspace({ tenantId, siteReference, siteName, blueprint, pageTitles }: { tenantId: string; siteReference: string; siteName: string; blueprint: any; pageTitles: Record<string, string> }) {
  const { session } = useAgencyAuth();
  const canManage = Boolean(session?.capabilities.includes('sites.manage'));
  const [data, setData] = useState<any>(null); const [loading, setLoading] = useState(true); const [missing, setMissing] = useState(false); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = useCallback(async () => { setLoading(true); setError(''); try { setData(await agencyFetch(`/sites/${siteReference}/search-intelligence`)); setMissing(false); } catch (cause: any) { if (cause?.status === 404) { setMissing(true); setData(null); } else setError(cause instanceof Error ? cause.message : 'The search strategy could not be loaded.'); } finally { setLoading(false); } }, [siteReference]);
  useEffect(() => { void load(); }, [load]);
  const createDraft = async () => { if (blueprint?.status !== 'APPROVED') return; setBusy('create'); setError(''); try { await agencyFetch(`/sites/${siteReference}/search-intelligence/create-draft`, { method: 'POST', body: '{}' }); setNotice('Search planning draft created. Add real research before approval.'); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The search planning draft could not be created.'); } finally { setBusy(''); } };
  const approve = async () => { if (!data || !window.confirm('Approve this exact search strategy and every page brief? Approved artifacts become immutable.')) return; setBusy('approve'); setError(''); try { await agencyFetch(`/sites/${siteReference}/search-intelligence/strategies/${data.strategy.reference}/approve`, { method: 'POST', body: '{}' }); setNotice('Search strategy approved.'); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The search strategy could not be approved.'); } finally { setBusy(''); } };
  if (loading) return <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading search strategy…</div>;
  if (error) return <Guidance tone="error" title="The search strategy could not be loaded"><p>{error}</p><button type="button" className={`${secondary} mt-4`} onClick={() => void load()}>Try again</button></Guidance>;
  if (missing) { const approved = blueprint?.status === 'APPROVED'; return <Guidance tone={approved ? 'info' : 'warning'} title={approved ? 'Create the search planning draft' : 'Approve the website structure first'}><p>{approved ? 'KS OS will create one planning brief for every approved page. Real search research is still required before approval.' : `Search planning is tied to the exact pages you approve. ${blueprint ? `Website structure revision ${blueprint.revision} is currently ${String(blueprint.status).replaceAll('_', ' ').toLowerCase()}.` : 'No website structure is available yet.'}`}</p>{approved ? <button type="button" className={`${primary} mt-4`} disabled={!canManage || Boolean(busy)} onClick={() => void createDraft()}>{busy === 'create' ? 'Creating…' : 'Create search planning draft'}</button> : null}</Guidance>; }
  const researchRequired = data.researchReadiness?.status === 'RESEARCH_REQUIRED' || Number(data.researchFreshness?.evidenceCount || 0) === 0;
  return <div className="space-y-5">
    <nav aria-label="Search workspace" className="flex gap-2 overflow-x-auto"><Link className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs font-black text-slate-400 hover:text-white" to={`/agency/tenants/${tenantId}/fulfilment?view=research`}>Research</Link><span className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-black text-white">Strategy</span><a className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs font-black text-slate-400 hover:text-white" href="#page-briefs">Page briefs</a></nav>
    {notice ? <Guidance tone="success" title="Saved"><p>{notice}</p></Guidance> : null}
    {researchRequired ? <Guidance tone="warning" title="Add real search research before approval"><p>This planning draft only knows the approved website structure. Upload CSV, XLSX, JSON, PDF or text research in the Research inbox, review the extraction, then explicitly add it to this DRAFT strategy.</p>{canManage ? <Link className={`${primary} mt-4`} to={`/agency/tenants/${tenantId}/fulfilment?view=research`}><FileSearch className="h-4 w-4" />Open research inbox</Link> : null}</Guidance> : <Guidance tone="success" title="Research evidence is attached"><p>{data.researchFreshness.evidenceCount} evidence record{data.researchFreshness.evidenceCount === 1 ? '' : 's'} are bound to this strategy. Review the page briefs before approval.</p></Guidance>}
    <section className={`${surface} p-5`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Search strategy</p><h2 className="mt-1 text-xl font-black text-white">{siteName}</h2></div><StatusPill value={data.status === 'APPROVED' ? 'COMPLETE' : researchRequired ? 'NEEDS_YOU' : 'READY'} /></div><p className="mt-4 text-sm text-slate-400">{data.strategy.targetAudience?.segments?.map((segment: any) => segment.name).join(' · ') || 'Audience not defined'} · {data.strategy.searchMarket?.locale || 'Market not defined'} · {data.researchFreshness?.evidenceCount || 0} evidence records</p></section>
    <section id="page-briefs" className={`${surface} scroll-mt-24 overflow-hidden`}><div className="border-b border-slate-800 px-5 py-4"><h3 className="font-black text-white">Page search briefs</h3><p className="mt-1 text-xs text-slate-500">Every approved website page owns a clear search purpose.</p></div><div className="divide-y divide-slate-800">{(data.briefs || []).map((brief: any) => <div key={brief.reference} className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-center md:justify-between"><div><p className="font-black text-white">{pageTitles[brief.pageReference] || brief.primaryTopic || brief.pageType}</p><p className="mt-1 text-xs text-slate-500">Primary target: {brief.primaryKeyword} · {String(brief.primarySearchIntent || '').replaceAll('_', ' ').toLowerCase()}</p></div><span className="text-xs font-bold text-slate-400">{String(brief.status).replaceAll('_', ' ')}</span></div>)}</div></section>
    {data.status !== 'APPROVED' && !researchRequired && canManage ? <button type="button" className={primary} disabled={Boolean(busy)} onClick={() => void approve()}>{busy === 'approve' ? 'Approving…' : 'Approve search strategy'}</button> : null}
  </div>;
}

export function AgencyClientWebsiteWorkspacePage() {
  const { tenantId } = useParams<{ tenantId: string }>(); const [params] = useSearchParams(); const view = params.get('view') || 'overview'; const [data, setData] = useState<any>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { if (!tenantId) return; setLoading(true); setError(''); try { const detail = await agencyFetch(`/tenants/${tenantId}`); const context = await agencyFetch(`/tenants/${detail.tenant.agencyReference}/delivery-context`); const siteReference = context.site?.reference || context.run?.siteReference || null; if (!siteReference) { setData({ detail, context, siteReference: null }); return; } const [studio, blueprints, quality, domains, publications] = await Promise.all([agencyFetch(`/sites/${siteReference}/studio`).catch(() => null), agencyFetch(`/sites/${siteReference}/blueprints`).catch(() => []), agencyFetch(`/sites/${siteReference}/quality-runs`).catch(() => []), agencyFetch(`/sites/${siteReference}/domains`).catch(() => []), agencyFetch(`/sites/${siteReference}/publications`).catch(() => [])]); setData({ detail, context, siteReference, studio, blueprint: blueprints[0] || null, quality, domains, publications }); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The website workspace could not be loaded.'); } finally { setLoading(false); } }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  if (loading && !data) return <section className={`${surface} p-8`}><div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-5 w-5 animate-spin" />Loading website workspace…</div></section>;
  if (error && !data) return <Guidance tone="error" title="The website workspace could not be loaded"><p>{error}</p><button type="button" className={`${secondary} mt-4`} onClick={() => void load()}>Try again</button></Guidance>;
  if (!data || !tenantId) return null;
  const tenant = data.detail.tenant; const pageTitles = Object.fromEntries((data.studio?.pages || []).map((page: any) => [page.reference, page.title])); const domain = data.domains?.find((item: any) => (item.domainRole || item.role) === 'CANONICAL'); const quality = data.quality?.[0] || null; const publication = data.publications?.[0] || null;
  return <div className="space-y-6"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Website</p><h1 className="mt-2 text-3xl font-black text-white">{tenant.name}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Plan, review and launch the client website without jumping between internal KS OS subsystems.</p></div><WebsiteTabs tenantId={tenantId} active={view} />{!data.siteReference ? <Guidance tone="info" title="Create the website workspace first"><p>No managed site exists for this client yet. Continue the Launch workflow to prepare the plan and create the draft site.</p><Link className={`${primary} mt-4`} to={`/agency/tenants/${tenantId}/onboarding`}>Continue launch <ArrowRight className="h-4 w-4" /></Link></Guidance> : null}{data.siteReference && view === 'overview' ? <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4"><Link to={`/agency/tenants/${tenantId}/onboarding`} className={`${surface} p-5 transition hover:border-violet-700`}><LayoutTemplate className="h-5 w-5 text-violet-300" /><h2 className="mt-4 font-black text-white">Website structure</h2><p className="mt-2 text-sm text-slate-500">{data.blueprint ? `Revision ${data.blueprint.revision} · ${String(data.blueprint.status).replaceAll('_', ' ').toLowerCase()}` : 'Not created yet'}</p></Link><Link to={`/agency/tenants/${tenantId}/fulfilment?view=search`} className={`${surface} p-5 transition hover:border-violet-700`}><Search className="h-5 w-5 text-violet-300" /><h2 className="mt-4 font-black text-white">Search strategy</h2><p className="mt-2 text-sm text-slate-500">Research, target queries, page intent and search briefs.</p></Link><Link to={`/agency/tenants/${tenantId}/onboarding?view=assets`} className={`${surface} p-5 transition hover:border-violet-700`}><FileImage className="h-5 w-5 text-violet-300" /><h2 className="mt-4 font-black text-white">Brand and assets</h2><p className="mt-2 text-sm text-slate-500">Upload, review and approve logos, photography and supporting evidence in the client asset library.</p></Link><Link to={`/agency/sites/${data.siteReference}/studio`} className={`${surface} p-5 transition hover:border-violet-700`}><WandSparkles className="h-5 w-5 text-violet-300" /><h2 className="mt-4 font-black text-white">Design</h2><p className="mt-2 text-sm text-slate-500">Theme, page sections, content and component variants.</p></Link></div> : null}{data.siteReference && view === 'pages' ? <section className={`${surface} overflow-hidden`}><div className="border-b border-slate-800 px-5 py-4"><h2 className="text-xl font-black text-white">Pages</h2><p className="mt-1 text-sm text-slate-500">The current website version and its governed page structure.</p></div><div className="divide-y divide-slate-800">{(data.studio?.pages || []).length ? data.studio.pages.map((page: any) => <div key={page.reference} className="flex items-center justify-between gap-4 px-5 py-4"><div><p className="font-black text-white">{page.title}</p><p className="mt-1 text-xs text-slate-500">{String(page.pageType).replaceAll('_', ' ').toLowerCase()} · {page.path}</p></div><span className="text-xs font-bold text-slate-400">{String(page.status || 'DRAFT').replaceAll('_', ' ')}</span></div>) : <p className="p-5 text-sm text-slate-500">No generated pages exist yet.</p>}</div></section> : null}{data.siteReference && view === 'search' ? <SearchStrategyWorkspace tenantId={tenantId} siteReference={data.siteReference} siteName={tenant.name} blueprint={data.blueprint} pageTitles={pageTitles} /> : null}{data.siteReference && view === 'quality' ? <Guidance tone={quality ? 'info' : 'warning'} title={quality ? 'Review the current pre-launch checks' : 'Quality checks have not run yet'}><p>{quality ? `Latest quality run: ${String(quality.status).replaceAll('_', ' ').toLowerCase()}. Open the design workspace for full findings and remediation controls.` : 'Generate a reviewable website version before running pre-launch checks.'}</p><Link className={`${primary} mt-4`} to={`/agency/sites/${data.siteReference}/studio`}>Open website review <MonitorCog className="h-4 w-4" /></Link></Guidance> : null}{data.siteReference && view === 'launch' ? <div className="space-y-4"><Guidance tone={publication ? 'success' : domain && quality ? 'info' : 'warning'} title={publication ? 'Website is live' : domain ? 'Complete the final launch checks' : 'Connect the primary website address'}><p>{publication ? 'A published website version exists. Future changes remain governed.' : domain ? 'The domain is present. Confirm quality and final approval before publishing.' : 'The primary domain has not been connected yet.'}</p><Link className={`${primary} mt-4`} to={`/agency/sites/${data.siteReference}/studio`}>Open launch controls <Globe2 className="h-4 w-4" /></Link></Guidance></div> : null}</div>;
}

export function AgencyClientOperationsPage() {
  const { tenantId } = useParams<{ tenantId: string }>(); const [data, setData] = useState<any>(null); const [error, setError] = useState('');
  useEffect(() => { if (!tenantId) return; void agencyFetch(`/tenants/${tenantId}/overview?preset=LAST_30_DAYS`).then(setData).catch(cause => setError(cause instanceof Error ? cause.message : 'Operations could not be loaded.')); }, [tenantId]);
  if (error) return <Guidance tone="error" title="Operations could not be loaded"><p>{error}</p></Guidance>;
  if (!data || !tenantId) return <p className="text-sm text-slate-400">Loading client operations…</p>;
  const failures = Number(data.analytics?.operations?.failedEmails || 0) + Number(data.analytics?.operations?.failedSms || 0) + Number(data.latestErrors?.length || 0);
  return <div className="space-y-6"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Operations</p><h1 className="mt-2 text-3xl font-black text-white">{data.tenant.name}</h1><p className="mt-2 text-sm text-slate-400">Day-to-day client health without exposing platform diagnostics unless you need them.</p></div>{failures ? <Guidance tone="warning" title={`${failures} item${failures === 1 ? '' : 's'} need attention`}><p>Recent communication or platform failures are associated with this client.</p></Guidance> : <Guidance tone="success" title="No operational problems need attention"><p>Recent client operations are healthy based on the current overview.</p></Guidance>}<Link className={secondary} to={`/agency/tenants/${tenantId}/health?technical=1`}>Open technical health details <ArrowRight className="h-4 w-4" /></Link></div>;
}

export function AgencyClientAccountPage() {
  const { tenantId } = useParams<{ tenantId: string }>(); if (!tenantId) return null;
  return <div className="space-y-6"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Account</p><h1 className="mt-2 text-3xl font-black text-white">Client account and access</h1><p className="mt-2 text-sm text-slate-400">Billing, package entitlements and workspace access live together here.</p></div><div className="grid gap-4 md:grid-cols-3"><Link className={`${surface} p-5 transition hover:border-violet-700`} to={`/agency/tenants/${tenantId}/billing?details=1`}><Globe2 className="h-5 w-5 text-violet-300" /><h2 className="mt-4 font-black text-white">Billing and subscription</h2><p className="mt-2 text-sm text-slate-500">Subscription state, mandate and billing details.</p></Link><Link className={`${surface} p-5 transition hover:border-violet-700`} to={`/agency/tenants/${tenantId}/entitlements`}><Sparkles className="h-5 w-5 text-violet-300" /><h2 className="mt-4 font-black text-white">Package and features</h2><p className="mt-2 text-sm text-slate-500">Plan entitlements and enabled capabilities.</p></Link><Link className={`${surface} p-5 transition hover:border-violet-700`} to={`/agency/tenants/${tenantId}/users`}><ShieldCheck className="h-5 w-5 text-violet-300" /><h2 className="mt-4 font-black text-white">Users and access</h2><p className="mt-2 text-sm text-slate-500">Workspace members, access and account administration.</p></Link></div></div>;
}
