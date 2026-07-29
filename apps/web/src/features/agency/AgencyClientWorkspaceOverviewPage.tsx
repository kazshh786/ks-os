import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ExternalLink,
  Gauge,
  Headphones,
  PoundSterling,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Link, useParams } from 'react-router';
import { agencyFetch } from './AgencyAuth';

type PeriodPreset = 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'LAST_90_DAYS';

type KpiValue = {
  value: number;
  previousValue: number | null;
  changeValue: number | null;
  changePercentage: number | null;
};

type OverviewData = {
  tenant: {
    id: string;
    name: string;
    subdomain: string;
    lifecycleStatus: string;
    currency: string;
  };
  analytics: {
    period: { localFrom: string; localTo: string };
    currency: string;
    bookings: {
      total: KpiValue;
      completed: KpiValue;
      cancellationRate: KpiValue;
      noShowRate: KpiValue;
    };
    revenue: {
      netRecordedRevenue: KpiValue & { currency: string };
    };
    clients: {
      uniqueClients: KpiValue;
      newClients: KpiValue;
    };
    operations: {
      awaitingPayment: number;
      failedEmails: number;
      failedSms: number;
    };
    dailyTrend: Array<{
      date: string;
      bookings: number;
      completedAppointments: number;
    }>;
  };
  onboarding: {
    status: string;
    completionPercentage: number;
    currentStage: string;
    targetLaunchAt?: string | null;
    nextAction?: string | null;
    blockers: Array<{ stageKey: string; blockerNote?: string | null }>;
  };
  conversionProxy: {
    eligibleBookings: number;
    completionRate: number | null;
    dropOffRate: number | null;
    limitation: string;
    outcomes: Array<{
      key: string;
      label: string;
      value: number;
      percentage: number | null;
    }>;
  };
  latestErrors: Array<{
    id: string;
    jobType: string;
    failureCode?: string | null;
    status: string;
    attemptCount: number;
    lastFailedAt: string;
  }>;
  supportCases: Array<{
    id: string;
    severity: string;
    status: string;
    title: string;
    summary?: string | null;
    startedAt: string;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    targetType: string;
    outcome: string;
    description?: string | null;
    occurredAt: string;
  }>;
};

type Improvement = {
  title: string;
  detail: string;
  href: string;
  priority: 'high' | 'medium';
};

const periods: Array<{ value: PeriodPreset; label: string }> = [
  { value: 'LAST_7_DAYS', label: 'Last 7 days' },
  { value: 'LAST_30_DAYS', label: 'Last 30 days' },
  { value: 'LAST_90_DAYS', label: 'Last 90 days' },
];

const surface = 'rounded-3xl border border-slate-800/90 bg-slate-900/80 shadow-[0_24px_80px_rgba(2,6,23,0.28)]';

const formatMoney = (valueMinor: number, currency = 'GBP') => new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency,
  maximumFractionDigits: 0,
}).format(valueMinor / 100);

const formatDate = (value?: string | null, includeTime = false) => value
  ? new Date(value).toLocaleString('en-GB', includeTime
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' })
  : 'Not set';

const humanise = (value: string) => value
  .replaceAll('_', ' ')
  .toLowerCase()
  .replace(/(^|\s)\S/g, match => match.toUpperCase());

const statusTone = (value: string) => {
  const status = value.toUpperCase();
  if (['ACTIVE', 'COMPLETE', 'COMPLETED', 'PASS', 'SUCCEEDED'].includes(status)) return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
  if (['ONBOARDING', 'IN_PROGRESS', 'OPEN', 'PENDING'].includes(status)) return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
  if (['FAILED', 'BLOCKED', 'CRITICAL', 'HIGH'].includes(status)) return 'border-rose-400/30 bg-rose-400/10 text-rose-200';
  return 'border-slate-700 bg-slate-800/70 text-slate-300';
};

const StatusBadge = ({ value }: { value: string }) => (
  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusTone(value)}`}>
    {value.replaceAll('_', ' ')}
  </span>
);

const Change = ({ value }: { value: number | null }) => {
  if (value === null || value === 0) return <span className="text-slate-500">No change</span>;
  const positive = value > 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
};

const MetricCard = ({
  label,
  value,
  detail,
  change,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
  change?: number | null;
  icon: React.ElementType;
}) => (
  <section className={`${surface} p-5`}>
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</p>
        <p className="mt-3 text-3xl font-black tracking-tight text-white">{value}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">{detail}</span>
          {change !== undefined ? <Change value={change ?? null} /> : null}
        </div>
      </div>
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-500/15 text-violet-200">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  </section>
);

const EmptyState = ({ title, detail }: { title: string; detail: string }) => (
  <div className="px-6 py-10 text-center">
    <CheckCircle2 className="mx-auto h-7 w-7 text-slate-600" />
    <p className="mt-3 font-black text-white">{title}</p>
    <p className="mt-1 text-sm text-slate-500">{detail}</p>
  </div>
);

const ImprovementLink = ({ item }: { item: Improvement }) => {
  const content = (
    <>
      <div className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${item.priority === 'high' ? 'bg-rose-500/15 text-rose-200' : 'bg-amber-500/15 text-amber-100'}`}>
        {item.priority === 'high' ? <CircleAlert className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-black text-white">{item.title}</p>
        <p className="mt-1 text-sm leading-6 text-slate-500">{item.detail}</p>
      </div>
      <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-slate-600 transition group-hover:translate-x-1 group-hover:text-violet-300" />
    </>
  );

  const className = 'group flex items-start gap-4 px-6 py-5 transition hover:bg-slate-800/40';
  return item.href.startsWith('http')
    ? <a href={item.href} target="_blank" rel="noreferrer" className={className}>{content}</a>
    : <Link to={item.href} className={className}>{content}</Link>;
};

export const AgencyClientWorkspaceOverviewPage: React.FC = () => {
  const { tenantId } = useParams();
  const [period, setPeriod] = useState<PeriodPreset>('LAST_30_DAYS');
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      setData(await agencyFetch(`/tenants/${tenantId}/overview?preset=${period}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The client overview could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [period, tenantId]);

  useEffect(() => { void load(); }, [load]);

  const improvements = useMemo<Improvement[]>(() => {
    if (!data) return [];
    const items: Improvement[] = [];
    const { analytics, conversionProxy, onboarding, tenant, latestErrors } = data;

    if (tenant.lifecycleStatus !== 'ACTIVE') {
      items.push({
        title: 'Complete setup before judging live performance',
        detail: `${onboarding.completionPercentage}% complete · current stage: ${humanise(onboarding.currentStage)}`,
        href: `/agency/tenants/${tenantId}/onboarding`,
        priority: onboarding.blockers.length ? 'high' : 'medium',
      });
    }
    if (conversionProxy.eligibleBookings === 0) {
      items.push({
        title: 'No booking activity in this period',
        detail: tenant.lifecycleStatus === 'ACTIVE'
          ? 'Run a test booking and confirm that services, staff and availability are visible.'
          : 'Performance reporting will populate after test or live bookings are created.',
        href: `https://${tenant.subdomain}.kasimshah.com/book`,
        priority: 'medium',
      });
    }
    if (conversionProxy.completionRate !== null && conversionProxy.completionRate < 70) {
      items.push({
        title: 'Booking completion is below 70%',
        detail: `${conversionProxy.dropOffRate?.toFixed(1)}% of recorded bookings did not reach completed status. Review cancellations, no-shows and open bookings.`,
        href: `/agency/tenants/${tenantId}/health`,
        priority: 'high',
      });
    }
    if (analytics.bookings.cancellationRate.value >= 10) {
      items.push({
        title: 'Cancellation rate needs attention',
        detail: `${analytics.bookings.cancellationRate.value.toFixed(1)}% cancellation rate in the selected period.`,
        href: `/agency/tenants/${tenantId}/health`,
        priority: 'medium',
      });
    }
    if (analytics.bookings.noShowRate.value >= 5) {
      items.push({
        title: 'Reduce no-shows',
        detail: `${analytics.bookings.noShowRate.value.toFixed(1)}% no-show rate. Check reminders, deposits and confirmation messaging.`,
        href: `/agency/tenants/${tenantId}/health`,
        priority: 'medium',
      });
    }

    const communicationFailures = analytics.operations.failedEmails + analytics.operations.failedSms;
    if (communicationFailures > 0) {
      items.push({
        title: 'Client communications are failing',
        detail: `${communicationFailures} failed email or SMS deliveries need investigation.`,
        href: `/agency/tenants/${tenantId}/health`,
        priority: 'high',
      });
    }
    if (analytics.operations.awaitingPayment > 0) {
      items.push({
        title: 'Payments are awaiting action',
        detail: `${analytics.operations.awaitingPayment} appointment payments are still awaiting payment.`,
        href: `/agency/tenants/${tenantId}/billing`,
        priority: 'medium',
      });
    }
    if (latestErrors.length > 0) {
      items.push({
        title: 'Resolve recent platform errors',
        detail: `${latestErrors.length} current failed job${latestErrors.length === 1 ? '' : 's'} are associated with this client.`,
        href: `/agency/tenants/${tenantId}/health`,
        priority: 'high',
      });
    }

    return items.slice(0, 5);
  }, [data, tenantId]);

  if (loading && !data) {
    return (
      <section className={`${surface} p-8`}>
        <div className="flex items-center gap-3 text-slate-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-violet-400" />
          <span className="text-sm font-bold">Loading client performance and health…</span>
        </div>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className={`${surface} p-8`}>
        <div role="alert" className="flex items-start gap-3 text-rose-200">
          <CircleAlert className="mt-0.5 h-5 w-5" />
          <div>
            <p className="font-black">The workspace overview could not be loaded</p>
            <p className="mt-1 text-sm text-rose-200/70">{error}</p>
            <button type="button" onClick={() => void load()} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-rose-400/10 px-3 text-xs font-black text-rose-100">
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!data) return null;

  const { tenant, analytics, conversionProxy, onboarding, latestErrors, supportCases, recentActivity } = data;
  const maxTrendBookings = Math.max(1, ...analytics.dailyTrend.map(item => item.bookings));
  const isPreLaunch = tenant.lifecycleStatus !== 'ACTIVE';

  return (
    <div className="space-y-7">
      <section className="rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-500/15 via-slate-900 to-slate-950 p-6 shadow-2xl sm:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Client performance overview</span>
              <StatusBadge value={tenant.lifecycleStatus} />
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">{tenant.name}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">A high-level view of bookings, revenue, customer outcomes, technical issues, support work and the actions most likely to improve this workspace.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`https://${tenant.subdomain}.kasimshah.com/book`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800">
              Open booking page <ExternalLink className="h-4 w-4" />
            </a>
            <Link to={`/agency/tenants/${tenantId}/onboarding`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-black text-white hover:bg-violet-500">
              Setup and launch <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {isPreLaunch ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 text-amber-200" />
            <div>
              <p className="font-black text-amber-100">Pre-launch workspace</p>
              <p className="mt-1 text-sm text-amber-100/70">Analytics are real, not seeded. Zero values mean {tenant.name} has no recorded activity for this period yet.</p>
            </div>
          </div>
          <Link to={`/agency/tenants/${tenantId}/onboarding`} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-amber-200 px-4 text-xs font-black text-slate-950">Continue setup</Link>
        </section>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Performance period</p>
          <p className="mt-1 text-sm text-slate-400">{formatDate(analytics.period.localFrom)} to {formatDate(analytics.period.localTo)}</p>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Select performance period">
          {periods.map(option => (
            <button key={option.value} type="button" onClick={() => setPeriod(option.value)} className={`min-h-10 rounded-xl px-3 text-xs font-black transition ${period === option.value ? 'bg-white text-slate-950' : 'border border-slate-700 bg-slate-900 text-slate-400 hover:text-white'}`}>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <p role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">The latest refresh failed. Showing the previous data. {error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Bookings created" value={analytics.bookings.total.value} detail="Recorded booking activity" change={analytics.bookings.total.changePercentage} icon={CalendarCheck} />
        <MetricCard label="Appointments completed" value={analytics.bookings.completed.value} detail="Completed appointment outcomes" change={analytics.bookings.completed.changePercentage} icon={CheckCircle2} />
        <MetricCard label="Completion proxy" value={conversionProxy.completionRate === null ? '—' : `${conversionProxy.completionRate.toFixed(1)}%`} detail="Completed ÷ recorded bookings" icon={Gauge} />
        <MetricCard label="Net recorded revenue" value={formatMoney(analytics.revenue.netRecordedRevenue.value, analytics.currency)} detail="Revenue less recorded refunds" change={analytics.revenue.netRecordedRevenue.changePercentage} icon={PoundSterling} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <section className={`${surface} overflow-hidden`}>
          <div className="flex flex-col gap-3 border-b border-slate-800 px-6 py-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Performance trend</p>
              <h2 className="mt-1 text-xl font-black text-white">Bookings over time</h2>
            </div>
            <div className="flex gap-5 text-xs">
              <span className="text-slate-500"><strong className="text-white">{analytics.clients.uniqueClients.value}</strong> unique clients</span>
              <span className="text-slate-500"><strong className="text-white">{analytics.clients.newClients.value}</strong> new</span>
            </div>
          </div>
          {analytics.dailyTrend.length ? (
            <div className="p-6">
              <div className="flex h-56 items-end gap-1.5" aria-label="Booking trend chart">
                {analytics.dailyTrend.map(item => (
                  <div key={item.date} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
                    <div className="relative flex h-48 w-full items-end">
                      <div className="w-full rounded-t-md bg-gradient-to-t from-violet-700 to-fuchsia-400 transition group-hover:from-violet-600" style={{ height: `${Math.max(item.bookings ? 8 : 2, (item.bookings / maxTrendBookings) * 100)}%` }} title={`${formatDate(item.date)}: ${item.bookings} bookings, ${item.completedAppointments} completed`} />
                    </div>
                    <span className="hidden text-[9px] text-slate-600 2xl:block">{new Date(item.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <EmptyState title="No trend data yet" detail="Daily booking activity will appear here as soon as the workspace records bookings." />}
        </section>

        <section className={`${surface} overflow-hidden`}>
          <div className="border-b border-slate-800 px-6 py-5">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">Booking outcomes</p>
            <h2 className="mt-1 text-xl font-black text-white">Conversion and drop-off proxy</h2>
          </div>
          <div className="space-y-5 p-6">
            {conversionProxy.outcomes.map(outcome => (
              <div key={outcome.key}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-bold text-slate-300">{outcome.label}</span>
                  <span className="font-black text-white">{outcome.value} <small className="text-slate-500">({outcome.percentage === null ? '—' : `${outcome.percentage.toFixed(1)}%`})</small></span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(0, outcome.percentage ?? 0)}%` }} />
                </div>
              </div>
            ))}
            <p className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs leading-5 text-slate-500">{conversionProxy.limitation}</p>
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className={`${surface} overflow-hidden`}>
          <div className="border-b border-slate-800 px-6 py-5">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">Recommended actions</p>
            <h2 className="mt-1 text-xl font-black text-white">Areas for improvement</h2>
          </div>
          {improvements.length ? <div className="divide-y divide-slate-800">{improvements.map(item => <ImprovementLink key={`${item.title}-${item.href}`} item={item} />)}</div> : <EmptyState title="No urgent improvements identified" detail="The selected period has no obvious operational or technical warning signals." />}
        </section>

        <section className={`${surface} p-6`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Setup and launch</p>
              <h2 className="mt-1 text-xl font-black text-white">{onboarding.completionPercentage}% complete</h2>
            </div>
            <StatusBadge value={onboarding.status} />
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400" style={{ width: `${Math.max(3, onboarding.completionPercentage)}%` }} />
          </div>
          <dl className="mt-5 space-y-4">
            <div className="flex items-start justify-between gap-4"><dt className="text-sm text-slate-500">Current stage</dt><dd className="text-right text-sm font-black text-white">{humanise(onboarding.currentStage)}</dd></div>
            <div className="flex items-start justify-between gap-4"><dt className="text-sm text-slate-500">Target launch</dt><dd className="text-right text-sm font-black text-white">{formatDate(onboarding.targetLaunchAt)}</dd></div>
            <div className="flex items-start justify-between gap-4"><dt className="text-sm text-slate-500">Blockers</dt><dd className={`text-right text-sm font-black ${onboarding.blockers.length ? 'text-rose-200' : 'text-emerald-200'}`}>{onboarding.blockers.length || 'None'}</dd></div>
          </dl>
          {onboarding.nextAction ? <p className="mt-5 rounded-xl border border-violet-400/20 bg-violet-400/10 p-3 text-sm leading-6 text-violet-100"><strong>Next action:</strong> {onboarding.nextAction}</p> : null}
          <Link to={`/agency/tenants/${tenantId}/onboarding`} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-black text-white hover:bg-violet-500">Open setup checklist <ArrowRight className="h-4 w-4" /></Link>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={`${surface} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-slate-800 px-6 py-5">
            <div><p className="text-xs font-black uppercase tracking-widest text-slate-500">Client-specific monitoring</p><h2 className="mt-1 text-xl font-black text-white">Latest errors</h2></div>
            <Link to={`/agency/tenants/${tenantId}/health`} className="text-xs font-black text-violet-300 hover:text-violet-200">Technical health</Link>
          </div>
          {latestErrors.length ? (
            <div className="divide-y divide-slate-800">
              {latestErrors.map(item => (
                <div key={item.id} className="flex items-start gap-4 px-6 py-4">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-rose-500/15 text-rose-200"><CircleAlert className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-black text-white">{humanise(item.jobType)}</p><StatusBadge value={item.status} /></div>
                    <p className="mt-1 text-xs text-slate-500">{item.failureCode ? humanise(item.failureCode) : 'No failure code'} · attempt {item.attemptCount} · {formatDate(item.lastFailedAt, true)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No current failed jobs" detail="There are no unresolved background-job errors associated with this client." />}
        </section>

        <section className={`${surface} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-slate-800 px-6 py-5">
            <div><p className="text-xs font-black uppercase tracking-widest text-slate-500">Support</p><h2 className="mt-1 text-xl font-black text-white">Active support tickets</h2></div>
            <Headphones className="h-5 w-5 text-violet-300" />
          </div>
          {supportCases.length ? (
            <div className="divide-y divide-slate-800">
              {supportCases.map(item => (
                <div key={item.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="font-black text-white">{item.title}</p><p className="mt-1 text-sm leading-6 text-slate-500">{item.summary || 'No support summary has been added.'}</p></div>
                    <StatusBadge value={item.severity} />
                  </div>
                  <p className="mt-3 text-xs text-slate-600">Opened {formatDate(item.startedAt, true)} · {humanise(item.status)}</p>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No active support tickets" detail="No open client-specific incidents are recorded for this workspace." />}
        </section>
      </div>

      <section className={`${surface} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-5">
          <div><p className="text-xs font-black uppercase tracking-widest text-slate-500">Workspace history</p><h2 className="mt-1 text-xl font-black text-white">Recent activity</h2></div>
          <Activity className="h-5 w-5 text-violet-300" />
        </div>
        {recentActivity.length ? (
          <div className="divide-y divide-slate-800">
            {recentActivity.map(item => (
              <div key={item.id} className="flex items-start gap-4 px-6 py-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-800 text-slate-300"><Clock3 className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-black text-white">{item.description || humanise(item.action)}</p><StatusBadge value={item.outcome} /></div>
                  <p className="mt-1 text-xs text-slate-500">{humanise(item.targetType)} · {formatDate(item.occurredAt, true)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState title="No recent workspace activity" detail="Agency and system activity for this client will be listed here." />}
      </section>
    </div>
  );
};

export default AgencyClientWorkspaceOverviewPage;
