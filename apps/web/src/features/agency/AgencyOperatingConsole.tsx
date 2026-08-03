import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarCheck,
  CheckCircle2,
  CircleAlert,
  Clock3,
  CreditCard,
  ExternalLink,
  FileCheck2,
  Globe2,
  Headphones,
  LayoutDashboard,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  WandSparkles,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';

type TenantSummary = {
  id: string;
  name: string;
  subdomain: string;
  lifecycleStatus: string;
  planKey?: string | null;
  primaryContactName?: string | null;
  primaryContactEmail?: string | null;
  legalBusinessName?: string | null;
  launchedAt?: string | null;
};

type LaunchStage = {
  id: string;
  stageKey: string;
  sequence: number;
  status: string;
  blockerNote?: string | null;
};

type TenantDetail = {
  tenant: TenantSummary;
  onboarding: LaunchStage[];
  deliverables: Array<{ id: string; title: string; type: string; status: string; dueAt?: string | null }>;
  plan?: { plan?: { name?: string | null } | null } | null;
  subscription?: { status?: string | null } | null;
  billing?: { mandateStatus?: string | null } | null;
};

const money = (value: unknown, currency = 'GBP') => new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency,
  maximumFractionDigits: 0,
}).format(Number(value || 0) / 100);

const formatDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric',
}) : 'Not yet';

function useAgencyData<T>(loader: () => Promise<T>, dependencies: React.DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loader());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The agency data could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // The caller controls stable dependencies for each live query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return { data, loading, error, reload };
}

const statusTone = (value: string) => {
  const normalised = value.toUpperCase();
  if (['ACTIVE', 'COMPLETE', 'COMPLETED', 'READY', 'SUCCEEDED', 'PAID'].includes(normalised)) return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
  if (['ONBOARDING', 'IN_PROGRESS', 'PENDING', 'DRAFT', 'OPEN'].includes(normalised)) return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
  if (['SUSPENDED', 'FAILED', 'BLOCKED', 'OVERDUE', 'CANCELLED'].includes(normalised)) return 'border-rose-400/30 bg-rose-400/10 text-rose-200';
  return 'border-slate-700 bg-slate-800/70 text-slate-300';
};

const StatusBadge = ({ value }: { value: string }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusTone(value)}`}>
    {value.replaceAll('_', ' ')}
  </span>
);

const Surface: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`rounded-3xl border border-slate-800/90 bg-slate-900/80 shadow-[0_24px_80px_rgba(2,6,23,0.28)] ${className}`}>
    {children}
  </section>
);

const LoadingState = ({ error }: { error?: string | null }) => (
  <Surface className="p-8">
    {error ? (
      <div role="alert" className="flex items-start gap-3 text-rose-200"><CircleAlert className="mt-0.5 h-5 w-5" /><div><p className="font-black">This view could not be loaded</p><p className="mt-1 text-sm text-rose-200/70">{error}</p></div></div>
    ) : (
      <div className="flex items-center gap-3 text-slate-400"><div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-violet-400" /><span className="text-sm font-bold">Loading the agency workspace…</span></div>
    )}
  </Surface>
);

const PageIntro = ({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) => (
  <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
    <div className="max-w-3xl">
      <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-300">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>
    </div>
    {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
  </div>
);

const PrimaryLink = ({ to, children }: { to: string; children: React.ReactNode }) => (
  <Link to={to} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-black text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-300">
    {children}
  </Link>
);

const SecondaryLink = ({ to, children }: { to: string; children: React.ReactNode }) => (
  <Link to={to} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-bold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300">
    {children}
  </Link>
);

const MetricCard = ({ label, value, detail, icon: Icon, tone = 'violet' }: { label: string; value: React.ReactNode; detail: string; icon: React.ElementType; tone?: 'violet' | 'emerald' | 'amber' | 'rose' }) => {
  const tones = {
    violet: 'bg-violet-500/15 text-violet-200',
    emerald: 'bg-emerald-500/15 text-emerald-200',
    amber: 'bg-amber-500/15 text-amber-100',
    rose: 'bg-rose-500/15 text-rose-200',
  };
  return <Surface className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p><p className="mt-3 text-3xl font-black tracking-tight text-white">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div><div className={`grid h-11 w-11 place-items-center rounded-2xl ${tones[tone]}`}><Icon className="h-5 w-5" /></div></div></Surface>;
};

const stageProgress = (stages: LaunchStage[]) => {
  if (!stages.length) return 0;
  const complete = stages.filter(stage => ['COMPLETE', 'COMPLETED'].includes(stage.status)).length;
  return Math.round((complete / stages.length) * 100);
};

const nextStage = (stages: LaunchStage[]) => stages.find(stage => !['COMPLETE', 'COMPLETED'].includes(stage.status));

const ProgressBar = ({ value }: { value: number }) => (
  <div className="h-2 overflow-hidden rounded-full bg-slate-800" aria-label={`${value}% complete`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
    <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400 transition-all" style={{ width: `${Math.max(4, value)}%` }} />
  </div>
);

export const AgencyHomePage: React.FC = () => {
  const live = useAgencyData(async () => {
    const [analytics, tenants, support] = await Promise.all([
      agencyFetch('/analytics'),
      agencyFetch('/tenants'),
      agencyFetch('/support/overview'),
    ]);
    return { analytics, tenants: tenants as TenantSummary[], support };
  }, []);

  if (live.loading || !live.data) return <LoadingState error={live.error} />;

  const { analytics, tenants, support } = live.data;
  const onboarding = tenants.filter(tenant => tenant.lifecycleStatus === 'ONBOARDING');
  const active = tenants.filter(tenant => tenant.lifecycleStatus === 'ACTIVE');
  const suspended = tenants.filter(tenant => tenant.lifecycleStatus === 'SUSPENDED');
  const priorities = [
    ...onboarding.slice(0, 4).map(tenant => ({
      id: tenant.id,
      title: tenant.name,
      detail: 'Continue client setup and launch preparation',
      href: `/agency/tenants/${tenant.id}`,
      status: 'ONBOARDING',
      icon: WandSparkles,
    })),
    ...(support.failedJobs || []).slice(0, 2).map((job: any) => ({
      id: job.id,
      title: job.jobType,
      detail: job.failureCode || 'A background process needs attention',
      href: '/agency/jobs',
      status: 'FAILED',
      icon: CircleAlert,
    })),
  ];

  return <div className="space-y-7">
    <PageIntro
      eyebrow="Agency command centre"
      title="Know what needs attention, then act"
      description="A single view of client progress, revenue, delivery and platform issues. Start with the priority list rather than hunting through separate system pages."
      actions={<><SecondaryLink to="/agency/onboarding"><CalendarCheck className="h-4 w-4" />View onboarding</SecondaryLink><PrimaryLink to="/agency/tenants/new"><Plus className="h-4 w-4" />Add client</PrimaryLink></>}
    />

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Live clients" value={active.length} detail={`${tenants.length} clients in the portfolio`} icon={Building2} tone="emerald" />
      <MetricCard label="In onboarding" value={onboarding.length} detail="Clients still moving towards launch" icon={Sparkles} tone="amber" />
      <MetricCard label="Monthly recurring revenue" value={money(analytics.revenue.mrr_minor)} detail={`${analytics.revenue.active_subscriptions || 0} active subscriptions`} icon={CreditCard} />
      <MetricCard label="Needs intervention" value={(support.failedJobs?.length || 0) + suspended.length} detail={`${support.failedJobs?.length || 0} failed jobs · ${suspended.length} suspended`} icon={CircleAlert} tone="rose" />
    </div>

    <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
      <Surface className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-5"><div><p className="text-xs font-black uppercase tracking-widest text-slate-500">What to do next</p><h2 className="mt-1 text-xl font-black text-white">Priority work</h2></div><Link to="/agency/tenants" className="text-xs font-black text-violet-300 hover:text-violet-200">All clients</Link></div>
        <div className="divide-y divide-slate-800">
          {priorities.length ? priorities.map(item => {
            const Icon = item.icon;
            return <Link key={`${item.status}-${item.id}`} to={item.href} className="group flex items-center gap-4 px-6 py-5 transition hover:bg-slate-800/45"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${item.status === 'FAILED' ? 'bg-rose-500/15 text-rose-200' : 'bg-violet-500/15 text-violet-200'}`}><Icon className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-black text-white">{item.title}</p><StatusBadge value={item.status} /></div><p className="mt-1 text-sm text-slate-500">{item.detail}</p></div><ArrowRight className="h-5 w-5 text-slate-600 transition group-hover:translate-x-1 group-hover:text-violet-300" /></Link>;
          }) : <div className="px-6 py-12 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" /><p className="mt-3 font-black text-white">Nothing urgent right now</p><p className="mt-1 text-sm text-slate-500">Your onboarding and platform queues are clear.</p></div>}
        </div>
      </Surface>

      <div className="space-y-6">
        <Surface className="p-6"><p className="text-xs font-black uppercase tracking-widest text-slate-500">Agency pulse</p><dl className="mt-5 space-y-4"><div className="flex items-center justify-between"><dt className="text-sm text-slate-400">Appointments in 30 days</dt><dd className="font-black text-white">{analytics.usage.appointments_30d || 0}</dd></div><div className="flex items-center justify-between"><dt className="text-sm text-slate-400">Open deliverables</dt><dd className="font-black text-white">{analytics.workload.open_deliverables || 0}</dd></div><div className="flex items-center justify-between"><dt className="text-sm text-slate-400">At-risk MRR</dt><dd className="font-black text-rose-200">{money(analytics.revenue.at_risk_mrr_minor)}</dd></div><div className="flex items-center justify-between"><dt className="text-sm text-slate-400">Median time to launch</dt><dd className="font-black text-white">{Math.round(analytics.activation.median_days_to_launch || 0)} days</dd></div></dl></Surface>
        <Surface className="p-6"><p className="text-xs font-black uppercase tracking-widest text-slate-500">Quick actions</p><div className="mt-4 grid gap-2"><SecondaryLink to="/agency/fact-finding"><FileCheck2 className="h-4 w-4" />Review fact finding</SecondaryLink><SecondaryLink to="/agency/provisioning"><Globe2 className="h-4 w-4" />Website delivery</SecondaryLink><SecondaryLink to="/agency/support"><Headphones className="h-4 w-4" />Support centre</SecondaryLink></div></Surface>
      </div>
    </div>
  </div>;
};

export const AgencyClientsPage: React.FC = () => {
  const { session } = useAgencyAuth();
  const live = useAgencyData<TenantSummary[]>(() => agencyFetch('/tenants'), []);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');

  const rows = useMemo(() => (live.data || []).filter(tenant => {
    const haystack = `${tenant.name} ${tenant.subdomain} ${tenant.primaryContactName || ''} ${tenant.primaryContactEmail || ''}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase()) && (status === 'ALL' || tenant.lifecycleStatus === status);
  }), [live.data, query, status]);

  return <div className="space-y-7">
    <PageIntro
      eyebrow="Client portfolio"
      title="Every workspace, one clear entry point"
      description="Search, understand status and open the client workspace without needing to know which internal tool controls each part of delivery."
      actions={session?.capabilities.includes('tenants.manage') ? <PrimaryLink to="/agency/tenants/new"><Plus className="h-4 w-4" />Add client</PrimaryLink> : undefined}
    />

    <Surface className="overflow-hidden">
      <div className="border-b border-slate-800 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full max-w-xl"><span className="sr-only">Search clients</span><Search className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-500" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search client, contact or workspace address" className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20" /></label>
          <div className="flex flex-wrap gap-2" aria-label="Filter clients by status">{['ALL', 'ACTIVE', 'ONBOARDING', 'SUSPENDED'].map(option => <button key={option} type="button" onClick={() => setStatus(option)} className={`min-h-10 rounded-xl px-3 text-xs font-black transition ${status === option ? 'bg-white text-slate-950' : 'border border-slate-700 bg-slate-900 text-slate-400 hover:text-white'}`}>{option === 'ALL' ? 'All clients' : option.toLowerCase()}</button>)}</div>
        </div>
      </div>

      {live.loading || !live.data ? <div className="p-6"><LoadingState error={live.error} /></div> : <div className="divide-y divide-slate-800">
        {rows.length ? rows.map(tenant => <Link key={tenant.id} to={`/agency/tenants/${tenant.id}`} className="group grid gap-4 p-5 transition hover:bg-slate-800/40 sm:p-6 lg:grid-cols-[1.35fr_0.8fr_0.7fr_auto] lg:items-center">
          <div className="flex min-w-0 items-center gap-4"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-500/25 to-fuchsia-500/10 text-violet-200"><Building2 className="h-5 w-5" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-base font-black text-white">{tenant.name}</h2><StatusBadge value={tenant.lifecycleStatus} /></div><p className="mt-1 truncate text-sm text-slate-500">{tenant.primaryContactName || 'No named contact'} · {tenant.primaryContactEmail || 'No email saved'}</p></div></div>
          <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-600">Workspace</p><p className="mt-1 truncate font-mono text-xs font-bold text-violet-300">{tenant.subdomain}.kasimshah.com</p></div>
          <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-600">Package</p><p className="mt-1 text-sm font-black text-slate-200">{tenant.planKey || 'Not assigned'}</p></div>
          <span className="inline-flex items-center gap-2 text-xs font-black text-violet-300">Open workspace <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
        </Link>) : <div className="px-6 py-16 text-center"><Search className="mx-auto h-7 w-7 text-slate-600" /><p className="mt-3 font-black text-white">No clients match this view</p><p className="mt-1 text-sm text-slate-500">Try a different search or status filter.</p></div>}
      </div>}
    </Surface>
  </div>;
};

export const AgencyOnboardingPage: React.FC = () => {
  const live = useAgencyData(async () => {
    const tenants = await agencyFetch('/tenants') as TenantSummary[];
    const onboarding = tenants.filter(tenant => tenant.lifecycleStatus === 'ONBOARDING');
    return Promise.all(onboarding.map(async tenant => {
      const detail = await agencyFetch(`/tenants/${tenant.id}`) as TenantDetail;
      return detail;
    }));
  }, []);

  if (live.loading || !live.data) return <LoadingState error={live.error} />;

  return <div className="space-y-7">
    <PageIntro eyebrow="Onboarding" title="Move every client towards launch" description="Each card shows progress, blockers and the next incomplete setup stage. Open the workspace to continue rather than moving between disconnected queues." actions={<PrimaryLink to="/agency/tenants/new"><Plus className="h-4 w-4" />Start onboarding</PrimaryLink>} />
    {live.data.length ? <div className="grid gap-5 xl:grid-cols-2">{live.data.map(detail => {
      const progress = stageProgress(detail.onboarding || []);
      const next = nextStage(detail.onboarding || []);
      const blockers = (detail.onboarding || []).filter(stage => stage.blockerNote);
      return <Surface key={detail.tenant.id} className="p-6"><div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black text-white">{detail.tenant.name}</h2><StatusBadge value={detail.tenant.lifecycleStatus} /></div><p className="mt-1 text-xs font-mono text-violet-300">{detail.tenant.subdomain}.kasimshah.com</p></div><span className="text-2xl font-black text-white">{progress}%</span></div><div className="mt-5"><ProgressBar value={progress} /></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-slate-950/80 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-600">Next step</p><p className="mt-2 text-sm font-black text-white">{next ? next.stageKey.replaceAll('_', ' ') : 'Ready for final launch check'}</p></div><div className="rounded-2xl bg-slate-950/80 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-600">Blockers</p><p className={`mt-2 text-sm font-black ${blockers.length ? 'text-amber-200' : 'text-emerald-200'}`}>{blockers.length ? `${blockers.length} need attention` : 'No blockers recorded'}</p></div></div>{blockers[0]?.blockerNote ? <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-100"><strong>Current blocker:</strong> {blockers[0].blockerNote}</p> : null}<Link to={`/agency/tenants/${detail.tenant.id}`} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-black text-white hover:bg-violet-500">Continue onboarding <ArrowRight className="h-4 w-4" /></Link></Surface>;
    })}</div> : <Surface className="p-12 text-center"><BadgeCheck className="mx-auto h-9 w-9 text-emerald-300" /><h2 className="mt-4 text-xl font-black text-white">The onboarding queue is clear</h2><p className="mt-2 text-sm text-slate-500">New client workspaces will appear here until they are launched.</p><div className="mt-6"><PrimaryLink to="/agency/tenants/new"><Plus className="h-4 w-4" />Add your next client</PrimaryLink></div></Surface>}
  </div>;
};

export const AgencyClientWorkspacePage: React.FC = () => {
  const { tenantId } = useParams();
  const navigate = useNavigate();
  const live = useAgencyData(async () => {
    const [detail, users] = await Promise.all([
      agencyFetch(`/tenants/${tenantId}`),
      agencyFetch(`/tenants/${tenantId}/users`).catch(() => []),
    ]);
    return { detail: detail as TenantDetail, users: users as Array<{ id: string; status: string }> };
  }, [tenantId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (live.loading || !live.data) return <LoadingState error={live.error} />;

  const { detail, users } = live.data;
  const tenant = detail.tenant;
  const progress = stageProgress(detail.onboarding || []);
  const next = nextStage(detail.onboarding || []);
  const blockers = (detail.onboarding || []).filter(stage => stage.blockerNote);

  const runLaunchChecks = async () => {
    setBusy('checks'); setNotice(null); setActionError(null);
    try {
      const result = await agencyFetch(`/tenants/${tenantId}/launch-checks`, { method: 'POST' });
      setNotice(result.ready ? 'All launch checks passed. This workspace can be activated.' : `${(result.checks || []).filter((check: any) => !check.ok).length} launch checks still need attention.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Launch checks could not be completed.');
    } finally { setBusy(null); }
  };

  const launch = async () => {
    setBusy('launch'); setNotice(null); setActionError(null);
    try {
      const checks = await agencyFetch(`/tenants/${tenantId}/launch-checks`, { method: 'POST' });
      if (!checks.ready) {
        setNotice(`${(checks.checks || []).filter((check: any) => !check.ok).length} launch checks still need attention.`);
        return;
      }
      await agencyFetch(`/tenants/${tenantId}/launch`, { method: 'POST' });
      setNotice('The client workspace is now active.');
      await live.reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The workspace could not be launched.');
    } finally { setBusy(null); }
  };

  return <div className="space-y-7">
    <div className="rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-500/15 via-slate-900 to-slate-950 p-6 shadow-2xl sm:p-8">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between"><div><div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => navigate('/agency/tenants')} className="text-xs font-black text-slate-500 hover:text-white">All clients</button><span className="text-slate-700">/</span><StatusBadge value={tenant.lifecycleStatus} /></div><h1 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">{tenant.name}</h1><div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-400"><span className="inline-flex items-center gap-2"><Globe2 className="h-4 w-4 text-violet-300" />{tenant.subdomain}.kasimshah.com</span><span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-violet-300" />{users.length} workspace user{users.length === 1 ? '' : 's'}</span></div></div><div className="flex flex-wrap gap-2"><a href={`https://${tenant.subdomain}.kasimshah.com/book`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800">Open booking page <ExternalLink className="h-4 w-4" /></a>{tenant.lifecycleStatus === 'ACTIVE' ? <button type="button" onClick={runLaunchChecks} disabled={!!busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-black text-slate-950 disabled:opacity-50"><ShieldCheck className="h-4 w-4" />{busy === 'checks' ? 'Checking…' : 'Run health check'}</button> : <button type="button" onClick={launch} disabled={!!busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />{busy === 'launch' ? 'Launching…' : 'Check and launch'}</button>}</div></div>
    </div>

    {notice ? <p role="status" className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm font-bold text-emerald-100">{notice}</p> : null}
    {actionError ? <p role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">{actionError}</p> : null}

    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Setup progress" value={`${progress}%`} detail={next ? `Next: ${next.stageKey.replaceAll('_', ' ')}` : 'All setup stages complete'} icon={Sparkles} tone={progress === 100 ? 'emerald' : 'violet'} />
      <MetricCard label="Package" value={detail.plan?.plan?.name || tenant.planKey || 'Unassigned'} detail="Controls available client features" icon={LayoutDashboard} />
      <MetricCard label="Subscription" value={detail.subscription?.status || 'Not started'} detail={`Mandate: ${detail.billing?.mandateStatus || 'not created'}`} icon={CreditCard} tone="amber" />
      <MetricCard label="Launch date" value={formatDate(tenant.launchedAt)} detail={tenant.lifecycleStatus === 'ACTIVE' ? 'Workspace is available to the client' : 'Complete setup before launch'} icon={CalendarCheck} tone={tenant.lifecycleStatus === 'ACTIVE' ? 'emerald' : 'amber'} />
    </div>

    <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
      <Surface className="overflow-hidden"><div className="border-b border-slate-800 px-6 py-5"><p className="text-xs font-black uppercase tracking-widest text-slate-500">Launch journey</p><div className="mt-2 flex items-end justify-between gap-4"><h2 className="text-xl font-black text-white">Setup and onboarding</h2><span className="text-sm font-black text-violet-200">{progress}% complete</span></div><div className="mt-4"><ProgressBar value={progress} /></div></div><div className="divide-y divide-slate-800">{(detail.onboarding || []).map(stage => <div key={stage.id} className="flex items-start gap-4 px-6 py-4"><div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${['COMPLETE', 'COMPLETED'].includes(stage.status) ? 'bg-emerald-500/15 text-emerald-300' : stage.blockerNote ? 'bg-amber-500/15 text-amber-200' : 'bg-slate-800 text-slate-400'}`}>{['COMPLETE', 'COMPLETED'].includes(stage.status) ? <CheckCircle2 className="h-4 w-4" /> : <span className="text-xs font-black">{stage.sequence}</span>}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-black text-white">{stage.stageKey.replaceAll('_', ' ')}</p><StatusBadge value={stage.status} /></div>{stage.blockerNote ? <p className="mt-2 text-xs leading-5 text-amber-100">{stage.blockerNote}</p> : null}</div></div>)}</div></Surface>

      <div className="space-y-6"><Surface className="p-6"><p className="text-xs font-black uppercase tracking-widest text-slate-500">Recommended next action</p><div className="mt-4 grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/15 text-violet-200">{blockers.length ? <CircleAlert className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}</div><h2 className="mt-4 text-xl font-black text-white">{blockers.length ? 'Resolve the current blocker' : next ? next.stageKey.replaceAll('_', ' ') : 'Run the final launch check'}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{blockers[0]?.blockerNote || (next ? 'Continue the next incomplete stage, then return here to confirm launch readiness.' : 'All onboarding stages are complete. Confirm the technical and commercial checks before activation.')}</p><Link to={`/agency/tenants/${tenantId}/onboarding`} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-black text-white hover:bg-violet-500">Open setup checklist <ArrowRight className="h-4 w-4" /></Link></Surface>

        <Surface className="p-6"><p className="text-xs font-black uppercase tracking-widest text-slate-500">Manage this client</p><div className="mt-4 grid gap-2"><SecondaryLink to={`/agency/tenants/${tenantId}/billing`}><CreditCard className="h-4 w-4" />Billing and subscription</SecondaryLink><SecondaryLink to={`/agency/tenants/${tenantId}/entitlements`}><Sparkles className="h-4 w-4" />Package and features</SecondaryLink><SecondaryLink to={`/agency/tenants/${tenantId}/fulfilment`}><FileCheck2 className="h-4 w-4" />Delivery work</SecondaryLink><SecondaryLink to={`/agency/tenants/${tenantId}/health`}><Activity className="h-4 w-4" />Technical health</SecondaryLink></div></Surface>
      </div>
    </div>

    <Surface className="overflow-hidden"><div className="flex items-center justify-between border-b border-slate-800 px-6 py-5"><div><p className="text-xs font-black uppercase tracking-widest text-slate-500">Agency delivery</p><h2 className="mt-1 text-xl font-black text-white">Open deliverables</h2></div><Link to={`/agency/tenants/${tenantId}/fulfilment`} className="text-xs font-black text-violet-300 hover:text-violet-200">Manage delivery</Link></div>{detail.deliverables?.length ? <div className="divide-y divide-slate-800">{detail.deliverables.map(item => <div key={item.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-black text-white">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.type.replaceAll('_', ' ')} · due {formatDate(item.dueAt)}</p></div><StatusBadge value={item.status} /></div>)}</div> : <div className="px-6 py-10 text-center"><Clock3 className="mx-auto h-7 w-7 text-slate-600" /><p className="mt-3 font-black text-white">No delivery work recorded</p><p className="mt-1 text-sm text-slate-500">Managed-service tasks will appear here.</p></div>}</Surface>
  </div>;
};
