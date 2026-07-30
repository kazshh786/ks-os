import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  FilePlus2,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';

type SiteRow = {
  reference: string;
  tenantName: string;
  displayName: string;
  status: string;
};

type Opportunity = {
  serviceReference: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
  priceMinor: number;
  pageStatus: 'READY_TO_PROVISION' | 'PAGE_EXISTS';
  pageReference: string | null;
  pagePath: string | null;
  canProvision: boolean;
};

type SiteOpportunities = {
  site: SiteRow;
  allocation: 'INITIAL' | 'MONTHLY';
  allowanceRemaining: number;
  liveDataSync: boolean;
  items: Opportunity[];
  error?: string;
};

const money = (minor: number) => new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
}).format(Math.max(0, minor) / 100);

export default function AgencyServicePageOpportunitiesPage() {
  const { session } = useAgencyAuth();
  const [groups, setGroups] = useState<SiteOpportunities[]>([]);
  const [filter, setFilter] = useState<'READY' | 'ALL' | 'EXISTS'>('READY');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canManage = Boolean(session?.capabilities.includes('sites.manage'));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const sites = await agencyFetch('/sites') as SiteRow[];
      const rows = await Promise.all(sites.map(async site => {
        try {
          const result = await agencyFetch(`/sites/${site.reference}/studio/service-pages`);
          return { site, ...result } as SiteOpportunities;
        } catch (cause) {
          return {
            site,
            allocation: 'MONTHLY' as const,
            allowanceRemaining: 0,
            liveDataSync: true,
            items: [],
            error: cause instanceof Error ? cause.message : 'Service pages could not be checked.',
          };
        }
      }));
      setGroups(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Service page opportunities could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => groups.flatMap(group => group.items
    .filter(item => filter === 'ALL'
      || (filter === 'READY' && item.pageStatus === 'READY_TO_PROVISION')
      || (filter === 'EXISTS' && item.pageStatus === 'PAGE_EXISTS'))
    .map(item => ({ group, item }))), [filter, groups]);

  const readyCount = useMemo(() => groups.reduce(
    (total, group) => total + group.items.filter(item => item.pageStatus === 'READY_TO_PROVISION').length,
    0,
  ), [groups]);

  const provision = async (group: SiteOpportunities, item: Opportunity) => {
    if (!canManage || busy) return;
    setBusy(item.serviceReference);
    setError('');
    setNotice('');
    try {
      const result = await agencyFetch(`/sites/${group.site.reference}/studio/service-pages`, {
        method: 'POST',
        body: JSON.stringify({ serviceReference: item.serviceReference }),
      });
      setNotice(`${item.name} now has a new page preview. The live website is unchanged until review, quality checks and publication are complete.`);
      await load();
      if (result?.versionReference) {
        window.sessionStorage.setItem('ks-service-page-version', result.versionReference);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The service page could not be provisioned.');
    } finally {
      setBusy('');
    }
  };

  return <div className="space-y-6">
    <section className="rounded-3xl border border-violet-800/60 bg-gradient-to-br from-violet-950 via-slate-950 to-slate-900 p-6 shadow-2xl sm:p-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Booking-owned website growth</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-white">Service page opportunities</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">Every active booking service is compared with the client’s reviewed website. New services appear here, but KS OS never creates or publishes a page until an agency operator explicitly provisions it.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || Boolean(busy)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-violet-700 px-4 text-xs font-black text-violet-200 disabled:opacity-40">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh services
        </button>
      </div>
    </section>

    {error ? <p role="alert" className="rounded-2xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p> : null}
    {notice ? <p role="status" className="rounded-2xl border border-emerald-800 bg-emerald-950/35 p-4 text-sm text-emerald-200">{notice}</p> : null}

    <div className="grid gap-4 md:grid-cols-3">
      <article className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Awaiting agency choice</p><p className="mt-2 text-3xl font-black text-white">{readyCount}</p><p className="mt-1 text-xs text-slate-500">No page is created automatically.</p></article>
      <article className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Managed websites</p><p className="mt-2 text-3xl font-black text-white">{groups.length}</p><p className="mt-1 text-xs text-slate-500">Checked against the latest preview or publication.</p></article>
      <article className="rounded-2xl border border-emerald-800/60 bg-emerald-950/25 p-5"><p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-emerald-300"><ShieldCheck className="h-4 w-4" />Live operational sync</p><p className="mt-2 text-sm font-black text-white">Hours, prices and bookability</p><p className="mt-1 text-xs leading-5 text-emerald-200/70">These booking-owned fields update without rewriting approved website copy.</p></article>
    </div>

    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-base font-black text-white">Client service catalogue</h2><p className="mt-1 text-xs leading-5 text-slate-400">Provisioning creates a new page-scoped review version. It does not change the current live site.</p></div>
        <div className="flex gap-2">{([['READY', 'Needs page'], ['ALL', 'All services'], ['EXISTS', 'Page exists']] as const).map(([value, text]) => <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value} className={`min-h-10 rounded-xl border px-3 text-xs font-black ${filter === value ? 'border-violet-500 bg-violet-950/40 text-white' : 'border-slate-700 text-slate-400'}`}>{text}</button>)}</div>
      </div>

      {loading ? <p className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Comparing booking services with website pages…</p> : visible.length ? <div className="mt-5 grid gap-4 lg:grid-cols-2">{visible.map(({ group, item }) => {
        const ready = item.pageStatus === 'READY_TO_PROVISION';
        return <article key={`${group.site.reference}:${item.serviceReference}`} className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wide text-violet-300">{group.site.tenantName}</p><h3 className="mt-1 text-lg font-black text-white">{item.name}</h3></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${ready ? 'border-amber-700 bg-amber-950/30 text-amber-200' : 'border-emerald-700 bg-emerald-950/30 text-emerald-200'}`}>{ready ? 'PAGE OPPORTUNITY' : 'PAGE EXISTS'}</span></div>
          <p className="mt-3 line-clamp-3 text-xs leading-5 text-slate-400">{item.description || 'No public service description has been added yet.'}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-400"><span className="rounded-lg border border-slate-800 px-2 py-1"><Clock3 className="mr-1 inline h-3 w-3" />{item.durationMinutes} minutes</span><span className="rounded-lg border border-slate-800 px-2 py-1">{money(item.priceMinor)}</span><span className="rounded-lg border border-slate-800 px-2 py-1">{group.allocation === 'MONTHLY' ? `${group.allowanceRemaining} monthly page allowance remaining` : `${group.allowanceRemaining} initial page allowance remaining`}</span></div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">{ready ? <button type="button" onClick={() => void provision(group, item)} disabled={!canManage || !item.canProvision || Boolean(busy)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><FilePlus2 className="h-4 w-4" />{busy === item.serviceReference ? 'Creating review version…' : item.canProvision ? 'Provision service page' : 'Page allowance required'}</button> : <Link to={`/agency/sites/${group.site.reference}/studio`} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-700 px-4 text-xs font-black text-emerald-200"><CheckCircle2 className="h-4 w-4" />Review in Site Studio</Link>}<Link to={`/agency/sites/${group.site.reference}/studio`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 text-xs font-black text-slate-300"><ExternalLink className="h-4 w-4" />Website</Link></div>
        </article>;
      })}</div> : <div className="mt-5 rounded-2xl border border-dashed border-slate-700 p-10 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-emerald-300" /><p className="mt-3 text-sm font-black text-white">No matching service opportunities</p><p className="mt-1 text-xs text-slate-500">Change the filter or add an active service in the client booking workspace.</p></div>}
      {groups.some(group => group.error) ? <div className="mt-5 space-y-2">{groups.filter(group => group.error).map(group => <p key={group.site.reference} className="rounded-xl border border-amber-800 bg-amber-950/25 p-3 text-xs text-amber-200"><strong>{group.site.tenantName}:</strong> {group.error}</p>)}</div> : null}
    </section>
  </div>;
}
