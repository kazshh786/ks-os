import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, Clock3, Globe2, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { agencyFetch } from './AgencyAuth';

const surface = 'rounded-3xl border border-slate-800/90 bg-slate-900/80 shadow-[0_24px_80px_rgba(2,6,23,0.24)]';
const primary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-black text-white transition hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-300';

function humanise(value?: string | null) {
  return value ? value.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, match => match.toUpperCase()) : 'Not started';
}

export default function AgencyClientOverviewV3() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true); setError('');
    try {
      const overview = await agencyFetch(`/tenants/${tenantId}/overview?preset=LAST_30_DAYS`);
      let context: any = null;
      try {
        const detail = await agencyFetch(`/tenants/${tenantId}`);
        if (detail?.tenant?.agencyReference) context = await agencyFetch(`/tenants/${detail.tenant.agencyReference}/delivery-context`);
      } catch { /* Overview remains useful if launch context is unavailable. */ }
      setData({ overview, context });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The client overview could not be loaded.'); }
    finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const next = useMemo(() => {
    if (!data || !tenantId) return null;
    const { onboarding, tenant } = data.overview;
    if (tenant.lifecycleStatus !== 'ACTIVE') return {
      title: onboarding.nextAction || `Continue ${humanise(onboarding.currentStage)}`,
      description: onboarding.blockers?.length
        ? `${onboarding.blockers.length} launch blocker${onboarding.blockers.length === 1 ? '' : 's'} need attention before this client can move forward.`
        : 'Continue the guided launch plan. KS OS will show the next human decision rather than exposing the underlying state machine.',
      href: `/agency/tenants/${tenantId}/onboarding`,
      label: 'Continue launch',
    };
    if (data.overview.latestErrors?.length) return {
      title: 'Review client operations',
      description: `${data.overview.latestErrors.length} recent platform issue${data.overview.latestErrors.length === 1 ? '' : 's'} are associated with this client.`,
      href: `/agency/tenants/${tenantId}/health`,
      label: 'Review operations',
    };
    return {
      title: 'Review website and client performance',
      description: 'The client is live. Use the website and operations workspaces for ongoing improvements rather than the launch flow.',
      href: `/agency/tenants/${tenantId}/fulfilment`,
      label: 'Open website',
    };
  }, [data, tenantId]);

  if (loading && !data) return <section className={`${surface} p-8`}><div className="flex items-center gap-3 text-sm text-slate-400"><Loader2 className="h-5 w-5 animate-spin" />Loading client workspace…</div></section>;
  if (error && !data) return <section className={`${surface} p-8`}><div role="alert" className="flex items-start gap-3 text-rose-200"><CircleAlert className="mt-0.5 h-5 w-5" /><div><p className="font-black">The client workspace could not be loaded</p><p className="mt-1 text-sm text-rose-200/70">{error}</p><button type="button" onClick={() => void load()} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-800 px-3 text-xs font-black"><RefreshCw className="h-4 w-4" />Try again</button></div></div></section>;
  if (!data || !tenantId || !next) return null;

  const { overview, context } = data;
  const launchComplete = overview.tenant.lifecycleStatus === 'ACTIVE';
  const bookingReady = context?.canonical?.services?.length > 0;
  const websiteExists = Boolean(context?.site?.reference || context?.run?.siteReference);
  const waitingOn = overview.onboarding.blockers?.length ? 'You' : launchComplete ? 'Nobody' : humanise(overview.onboarding.currentStage);

  return <div className="space-y-6">
    <section className="rounded-3xl border border-violet-500/30 bg-gradient-to-br from-violet-500/15 via-slate-900 to-slate-950 p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Next action</span><span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${launchComplete ? 'border-emerald-700 bg-emerald-950/30 text-emerald-200' : 'border-amber-700 bg-amber-950/30 text-amber-100'}`}>{launchComplete ? 'Live client' : 'Launch in progress'}</span></div>
      <h1 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">{next.title}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">{next.description}</p>
      <Link to={next.href} className={`${primary} mt-5`}>{next.label}<ArrowRight className="h-4 w-4" /></Link>
    </section>

    <section className={`${surface} p-5`}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl bg-slate-950 p-4"><small className="font-black uppercase tracking-wide text-slate-500">Launch progress</small><p className="mt-2 text-2xl font-black text-white">{overview.onboarding.completionPercentage}%</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(4, overview.onboarding.completionPercentage)}%` }} /></div></div>
        <div className="rounded-2xl bg-slate-950 p-4"><small className="font-black uppercase tracking-wide text-slate-500">Waiting on</small><p className="mt-2 font-black text-white">{waitingOn}</p></div>
        <div className="rounded-2xl bg-slate-950 p-4"><small className="font-black uppercase tracking-wide text-slate-500">Website</small><p className="mt-2 font-black text-white">{websiteExists ? 'Draft exists' : 'Not created'}</p></div>
        <div className="rounded-2xl bg-slate-950 p-4"><small className="font-black uppercase tracking-wide text-slate-500">Booking</small><p className="mt-2 font-black text-white">{bookingReady ? 'Configured' : 'Needs setup'}</p></div>
        <div className="rounded-2xl bg-slate-950 p-4"><small className="font-black uppercase tracking-wide text-slate-500">Current stage</small><p className="mt-2 font-black text-white">{humanise(overview.onboarding.currentStage)}</p></div>
      </div>
    </section>

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Link to={`/agency/tenants/${tenantId}/onboarding`} className={`${surface} group p-5 transition hover:border-violet-700`}><Sparkles className="h-5 w-5 text-violet-300" /><h2 className="mt-4 font-black text-white">Launch</h2><p className="mt-2 text-sm text-slate-500">Discovery, business information, booking, brand, website planning and go-live.</p></Link>
      <Link to={`/agency/tenants/${tenantId}/fulfilment`} className={`${surface} group p-5 transition hover:border-violet-700`}><Globe2 className="h-5 w-5 text-violet-300" /><h2 className="mt-4 font-black text-white">Website</h2><p className="mt-2 text-sm text-slate-500">Pages, design, search strategy, quality and launch state.</p></Link>
      <Link to={`/agency/tenants/${tenantId}/health`} className={`${surface} group p-5 transition hover:border-violet-700`}><CheckCircle2 className="h-5 w-5 text-violet-300" /><h2 className="mt-4 font-black text-white">Operations</h2><p className="mt-2 text-sm text-slate-500">Bookings, communication health, support and day-to-day issues.</p></Link>
      <Link to={`/agency/tenants/${tenantId}/billing`} className={`${surface} group p-5 transition hover:border-violet-700`}><Clock3 className="h-5 w-5 text-violet-300" /><h2 className="mt-4 font-black text-white">Account</h2><p className="mt-2 text-sm text-slate-500">Billing, package features, users and access.</p></Link>
    </div>

    {overview.recentActivity?.length ? <section className={`${surface} overflow-hidden`}><div className="border-b border-slate-800 px-5 py-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Recent activity</p><h2 className="mt-1 text-lg font-black text-white">What changed recently</h2></div><div className="divide-y divide-slate-800">{overview.recentActivity.slice(0, 6).map((item: any) => <div key={item.id} className="px-5 py-4"><p className="text-sm font-bold text-white">{item.description || humanise(item.action)}</p><p className="mt-1 text-xs text-slate-500">{new Date(item.occurredAt).toLocaleString('en-GB')}</p></div>)}</div></section> : null}
  </div>;
}
