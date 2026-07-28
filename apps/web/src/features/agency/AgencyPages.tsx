import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';
import { ManualTenantUserDialog } from './ManualTenantUserDialog';

const money=(value:any,currency='GBP')=>new Intl.NumberFormat('en-GB',{style:'currency',currency,maximumFractionDigits:0}).format(Number(value||0)/100);
const date=(value:any)=>value?new Date(value).toLocaleDateString('en-GB'):'—';
export const Panel:React.FC<{title:string;children:React.ReactNode;action?:React.ReactNode}>=({title,children,action})=><section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex items-center justify-between gap-3 mb-4"><h2 className="text-xs uppercase tracking-widest text-slate-400 font-black">{title}</h2>{action}</div>{children}</section>;
export const Status:React.FC<{value:string}>=({value})=><span className="inline-flex rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-black text-slate-300">{value.replaceAll('_',' ')}</span>;
function useLive<T>(loader:()=>Promise<T>,deps:any[]=[]){const[data,setData]=useState<T|null>(null);const[error,setError]=useState<string|null>(null);const[loading,setLoading]=useState(true);const reload=async()=>{setLoading(true);setError(null);try{setData(await loader());}catch(e:any){setError(e.message);}finally{setLoading(false);}};useEffect(()=>{void reload();},deps);return{data,error,loading,reload};}
const State:React.FC<{loading:boolean;error:string|null;children:React.ReactNode}>=({loading,error,children})=>loading?<p className="text-sm text-slate-400">Loading live platform data…</p>:error?<p className="rounded-xl border border-rose-900 bg-rose-950/30 p-4 text-sm text-rose-300">{error}</p>:<>{children}</>;

export const AgencyOverviewPage:React.FC=()=>{const live=useLive(async()=>{const[analytics,tenants,support]=await Promise.all([agencyFetch('/analytics'),agencyFetch('/tenants'),agencyFetch('/support/overview')]);return{analytics,tenants,support};},[]);return <State loading={live.loading} error={live.error}><div className="space-y-5"><div className="grid gap-4 md:grid-cols-4"><Metric label="GoCardless MRR" value={money(live.data?.analytics.revenue.mrr_minor)}/><Metric label="Active subscriptions" value={live.data?.analytics.revenue.active_subscriptions||0}/><Metric label="Client businesses" value={live.data?.tenants.length||0}/><Metric label="Open deliverables" value={live.data?.analytics.workload.open_deliverables||0}/></div><div className="grid gap-5 lg:grid-cols-2"><Panel title="Commercial truth"><dl className="grid grid-cols-2 gap-3 text-sm"><Fact label="At-risk MRR" value={money(live.data?.analytics.revenue.at_risk_mrr_minor)}/><Fact label="Revenue source" value="GoCardless only"/><Fact label="Launched" value={live.data?.analytics.activation.launched||0}/><Fact label="Median launch" value={`${Math.round(live.data?.analytics.activation.median_days_to_launch||0)} days`}/></dl></Panel><Panel title="Platform operations"><dl className="grid grid-cols-2 gap-3 text-sm"><Fact label="Failed jobs" value={live.data?.support.failedJobs.length||0}/><Fact label="Open incidents" value={live.data?.support.incidents.length||0}/><Fact label="Webhook pending" value={live.data?.support.webhooks?.pending||0}/><Fact label="Appointments (30d)" value={live.data?.analytics.usage.appointments_30d||0}/></dl></Panel></div></div></State>;};
const Metric=({label,value}:{label:string;value:any})=><div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-[10px] uppercase tracking-widest text-slate-500 font-black">{label}</p><p className="mt-2 text-2xl font-black text-white">{value}</p></div>;
const Fact=({label,value}:{label:string;value:any})=><div className="rounded-xl bg-slate-950 p-3"><dt className="text-[10px] uppercase text-slate-500 font-bold">{label}</dt><dd className="mt-1 font-bold text-slate-200">{value}</dd></div>;

export const AgencyTenantsPage: React.FC = () => {
  const { session } = useAgencyAuth();
  const live = useLive<any[]>(() => agencyFetch('/tenants'), []);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const rows = useMemo(() => {
    return (live.data || []).filter(t => {
      const matchSearch = `${t.name} ${t.subdomain} ${t.legalBusinessName || ''} ${t.primaryContactEmail || ''}`
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchStatus = statusFilter === 'ALL' || t.lifecycleStatus === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [live.data, search, statusFilter]);

  const activeCount = useMemo(() => (live.data || []).filter(t => t.lifecycleStatus === 'ACTIVE').length, [live.data]);
  const onboardingCount = useMemo(() => (live.data || []).filter(t => t.lifecycleStatus === 'ONBOARDING').length, [live.data]);
  const suspendedCount = useMemo(() => (live.data || []).filter(t => t.lifecycleStatus === 'SUSPENDED').length, [live.data]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Total Client Businesses" value={live.data?.length || 0} />
        <Metric label="Active Workspaces" value={activeCount} />
        <Metric label="In Onboarding" value={onboardingCount} />
        <Metric label="Suspended" value={suspendedCount} />
      </div>

      <Panel
        title="Client Business Management Directory"
        action={
          session?.capabilities.includes('tenants.manage') ? (
            <Link to="/agency/tenants/new" className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-black text-white hover:bg-violet-500 shadow-md">
              + Onboard new client
            </Link>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-5">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by business name, subdomain, or contact..."
            className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
          />

          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className="text-slate-400">Filter status:</span>
            {['ALL', 'ACTIVE', 'ONBOARDING', 'SUSPENDED'].map(status => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`rounded-lg px-3 py-1.5 font-bold transition ${
                  statusFilter === status
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        <State loading={live.loading} error={live.error}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <tr>
                  <th className="p-3">Client Business</th>
                  <th>Subdomain / Domain</th>
                  <th>Lifecycle Status</th>
                  <th>Package Plan</th>
                  <th>Primary Contact</th>
                  <th className="text-right p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      No client businesses found matching filters.
                    </td>
                  </tr>
                ) : (
                  rows.map(t => (
                    <tr key={t.id} className="border-t border-slate-800/80 hover:bg-slate-950/50 transition">
                      <td className="p-3">
                        <strong className="text-white font-bold">{t.name}</strong>
                        {t.legalBusinessName && (
                          <div className="text-xs text-slate-500">{t.legalBusinessName}</div>
                        )}
                      </td>
                      <td>
                        <span className="font-mono text-xs font-semibold text-indigo-300">
                          {t.subdomain}.kasimshah.com
                        </span>
                      </td>
                      <td>
                        <Status value={t.lifecycleStatus} />
                      </td>
                      <td>
                        <span className="inline-flex rounded-full border border-violet-800/60 bg-violet-950/40 px-2.5 py-0.5 text-xs font-black text-violet-300">
                          {t.planKey || 'CORE'}
                        </span>
                      </td>
                      <td className="text-xs text-slate-400">
                        {t.primaryContactName && <div className="font-semibold text-slate-300">{t.primaryContactName}</div>}
                        {t.primaryContactEmail || '—'}
                      </td>
                      <td className="text-right p-3">
                        <Link
                          to={`/agency/tenants/${t.id}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-black text-violet-300 hover:bg-violet-900 hover:text-white transition"
                        >
                          Manage →
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </State>
      </Panel>
    </div>
  );
};

export const AgencyTenantCreatePage: React.FC = () => {
  const plans = useLive<any[]>(() => agencyFetch('/plans'), []);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [subdomain, setSubdomain] = useState('');
  const [selectedPlanVersionId, setSelectedPlanVersionId] = useState('');

  const versions = plans.data?.filter(x => x.version?.status === 'ACTIVE') || [];

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!versions.length) {
      setError('No active package is available. Publish a package version before creating a client business.');
      return;
    }
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form);
    payload.subdomain = String(payload.subdomain).trim().toLowerCase();
    try {
      const result = await agencyFetch('/tenants', { method: 'POST', body: JSON.stringify(payload) });
      navigate(`/agency/tenants/${result.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Onboard New Client Business</h1>
          <p className="text-xs text-slate-400 mt-1">
            Provision a client workspace, assign package tier entitlements, and initiate onboarding.
          </p>
        </div>
        <Link to="/agency/tenants" className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300">
          ← Back to client list
        </Link>
      </div>

      <Panel title="Client Business Onboarding Wizard">
        <form onSubmit={submit} className="space-y-6">
          {error && (
            <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm font-semibold text-rose-300">
              {error}
            </p>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Field name="name" label="Trading Business Name" />
            <Field name="legalBusinessName" label="Legal Entity Name" />
            
            <label className="text-xs text-slate-400">
              Workspace Subdomain
              <input
                name="subdomain"
                required
                value={subdomain}
                onChange={e => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="e.g. apexsalon"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white font-mono text-sm"
              />
              <span className="mt-1 block text-[11px] font-mono text-indigo-400">
                Live URL: {subdomain || 'subdomain'}.kasimshah.com
              </span>
            </label>

            <Field name="businessType" label="Business Type (e.g. Hair Salon, Aesthetics, Clinic)" />
            <Field name="primaryContactName" label="Primary Contact Name" />
            <Field name="primaryContactEmail" label="Contact Email Address" type="email" />
          </div>

          <input type="hidden" name="timezone" value="Europe/London" />
          <input type="hidden" name="currency" value="GBP" />

          <div>
            <label className="block text-xs font-bold text-slate-400 mb-3">
              Select Package Tier & Entitlements
            </label>
            <div className="grid gap-4 md:grid-cols-3">
              {[
                { key: 'CORE', name: 'Core Tier', price: '£49/mo', bookings: '500 bookings/mo', staff: '5 staff members', loc: '1 location', desc: 'Complete booking system, POS, manual and online bookings.' },
                { key: 'GROWTH', name: 'Growth Tier', price: '£149/mo', bookings: '2,500 bookings/mo', staff: '15 staff members', loc: '3 locations', desc: 'Adds custom automations, advanced analytics and priority support.' },
                { key: 'SCALE', name: 'Scale Tier', price: '£399/mo', bookings: '20,000 bookings/mo', staff: '100 staff members', loc: '20 locations', desc: 'Enterprise volume, multi-location control and strategic support.' },
              ].map(tier => {
                const matchedVersion = versions.find(v => v.plan.name.toUpperCase().includes(tier.key));
                const valueId = matchedVersion?.version?.id || versions[0]?.version?.id;
                const isSelected = selectedPlanVersionId === valueId;

                return (
                  <button
                    key={tier.key}
                    type="button"
                    onClick={() => valueId && setSelectedPlanVersionId(valueId)}
                    className={`rounded-2xl border p-4 text-left transition flex flex-col justify-between ${
                      isSelected
                        ? 'border-violet-500 bg-violet-950/40 shadow-lg shadow-violet-950/50'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase text-violet-400">{tier.name}</span>
                        <span className="text-sm font-black text-white">{tier.price}</span>
                      </div>
                      <p className="mt-2 text-xs text-slate-300 font-semibold">{tier.desc}</p>
                      <ul className="mt-3 text-[11px] space-y-1 text-slate-400">
                        <li>✓ {tier.bookings}</li>
                        <li>✓ {tier.staff}</li>
                        <li>✓ {tier.loc}</li>
                      </ul>
                    </div>
                    {isSelected && (
                      <span className="mt-4 block text-center rounded-lg bg-violet-600 py-1 text-[10px] font-black uppercase text-white">
                        Selected Package
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            
            <input type="hidden" name="planVersionId" value={selectedPlanVersionId || (versions[0]?.version?.id || '')} />
          </div>

          <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
            <Link to="/agency/tenants" className="rounded-xl border border-slate-700 px-5 py-3 text-xs font-bold text-slate-300">
              Cancel
            </Link>
            <button
              disabled={busy || plans.loading || !versions.length}
              className="rounded-xl bg-violet-600 px-6 py-3 text-xs font-black text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {busy ? 'Provisioning client workspace…' : 'Create client'}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
};
const Field=({name,label,type='text'}:{name:string;label:string;type?:string})=><label className="text-xs text-slate-400">{label}<input name={name} type={type} required className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white"/></label>;

type LaunchCheck = { key: string; ok: boolean; detail: string };

export const AgencyTenantDetailPageFixed: React.FC = () => {
  const { tenantId } = useParams();
  const live = useLive<any>(() => agencyFetch(`/tenants/${tenantId}`), [tenantId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<LaunchCheck[]>([]);

  // Dialog states
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');

  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supportReason, setSupportReason] = useState('');

  const command = async (label: string, path: string, body?: any) => {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      const result = await agencyFetch(path, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      await live.reload();
      return result;
    } catch (e: any) {
      setError(e.message);
      if (Array.isArray(e.details)) setChecks(e.details);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runChecks = async () => {
    const result = await command('checks', `/tenants/${tenantId}/launch-checks`);
    if (result) {
      setChecks(result.checks || []);
      setMessage(
        result.ready
          ? '✓ All launch checks passed! This client business is fully ready for activation.'
          : '⚠️ Launch checks found items requiring attention before client activation.'
      );
    }
    return result;
  };

  const launch = async () => {
    const result = await runChecks();
    if (!result?.ready) return;
    const launched = await command('launch', `/tenants/${tenantId}/launch`);
    if (launched) setMessage('🎉 Client workspace launched successfully! Live access is active.');
  };

  const submitInviteOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteName) return;
    const result = await command('invite', `/tenants/${tenantId}/owner-invitations`, {
      email: inviteEmail,
      displayName: inviteName,
    });
    if (result) {
      setMessage(`Invitation sent to ${inviteEmail} (${inviteName}).`);
      setShowInviteModal(false);
      setInviteEmail('');
      setInviteName('');
    }
  };

  const submitSupportSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supportReason) return;
    const result = await command('support', `/support-sessions`, {
      tenantId,
      reason: supportReason,
      durationMinutes: 30,
      scope: 'STANDARD_SUPPORT',
    });
    if (result?.token) {
      sessionStorage.setItem('ks-os-support-session', result.token);
      sessionStorage.setItem(
        'ks-os-support-metadata',
        JSON.stringify({
          tenantName: live.data.tenant.name,
          reason: result.reason,
          expiresAt: result.expiresAt,
        })
      );
      window.location.assign('/app/calendar?support=1');
    }
  };

  if (!live.data) return <State loading={live.loading} error={live.error}><></></State>;
  const d = live.data;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <Panel
        title={`Client Management Workstation · ${d.tenant.name}`}
        action={
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-indigo-300 font-semibold">{d.tenant.subdomain}.kasimshah.com</span>
            <Status value={d.tenant.lifecycleStatus} />
          </div>
        }
      >
        <p className="mb-4 text-xs text-slate-400">
          Complete onboarding milestones, run launch readiness audits, and manage tenant authentication and support access.
        </p>

        {error && (
          <p role="alert" className="mb-4 rounded-xl border border-rose-900 bg-rose-950/40 p-3.5 text-xs font-semibold text-rose-300">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="mb-4 rounded-xl border border-emerald-900 bg-emerald-950/40 p-3.5 text-xs font-semibold text-emerald-200">
            {message}
          </p>
        )}

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-800 pb-5">
          <button
            type="button"
            onClick={() => setShowSupportModal(true)}
            className="rounded-xl bg-amber-400 px-3.5 py-2 text-xs font-black text-slate-950 hover:bg-amber-300 transition"
          >
            🔑 Start audited support session
          </button>
          <button
            type="button"
            onClick={() => setShowInviteModal(true)}
            className="rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-black text-white hover:bg-violet-500 transition"
          >
            + Invite initial owner
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={runChecks}
            className="rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            {busy === 'checks' ? 'Running audits…' : 'Run launch checks'}
          </button>
          <button
            type="button"
            disabled={!!busy || d.tenant.lifecycleStatus === 'ACTIVE'}
            onClick={launch}
            className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy === 'launch' ? 'Activating…' : d.tenant.lifecycleStatus === 'ACTIVE' ? '✓ Workspace Active' : 'Check launch'}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => command('suspend', `/tenants/${tenantId}/suspend`)}
            className="rounded-xl border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs font-bold text-rose-300 hover:bg-rose-900/50 disabled:opacity-50"
          >
            Suspend workspace
          </button>
          {d.tenant.lifecycleStatus === 'SUSPENDED' && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => command('reactivate', `/tenants/${tenantId}/reactivate`)}
              className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200"
            >
              Reactivate
            </button>
          )}
        </div>

        {/* Commercial Overview Cards */}
        <dl className="mt-5 grid gap-3 md:grid-cols-4">
          <Fact label="Assigned Package" value={d.plan.plan?.name ? `${d.plan.plan.name} Plan` : 'Unassigned'} />
          <Fact label="GoCardless Subscription" value={d.subscription?.status || 'Not started'} />
          <Fact label="Mandate Status" value={d.billing?.mandateStatus || 'Not created'} />
          <Fact label="Workspace Launched" value={date(d.tenant.launchedAt)} />
        </dl>

        {/* Launch Checks Output */}
        {!!checks.length && (
          <div className="mt-5 space-y-2 border-t border-slate-800 pt-4">
            <h4 className="text-xs font-black uppercase text-slate-400">Launch Readiness Audit Results</h4>
            {checks.map(check => (
              <div
                key={check.key}
                className={`rounded-xl border p-3 text-xs ${
                  check.ok
                    ? 'border-emerald-900/80 bg-emerald-950/30 text-emerald-200'
                    : 'border-rose-900/80 bg-rose-950/30 text-rose-200'
                }`}
              >
                <div className="flex items-center gap-2 font-bold">
                  <span>{check.ok ? '✓ Passed' : '⚠️ Attention Required'}</span>
                  <span>·</span>
                  <span>{check.key.replaceAll('_', ' ')}</span>
                </div>
                <p className="mt-1 opacity-80">{check.detail}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* User Accounts Section */}
      <AgencyTenantUsersPanel tenantId={tenantId!} tenantName={d.tenant.name} onInviteRequest={() => setShowInviteModal(true)} />

      {/* Onboarding Workflow */}
      <Panel title="Client Onboarding Milestone Workflow">
        <p className="mb-4 text-xs text-slate-400">
          Track onboarding progress across key setup stages from sale handover to production launch.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {d.onboarding.map((stage: any) => (
            <div
              key={stage.id}
              className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 p-3.5 text-left"
            >
              <div>
                <span className="text-xs font-bold text-white">
                  {stage.sequence}. {stage.stageKey.replaceAll('_', ' ')}
                </span>
                {stage.blockerNote && (
                  <p className="mt-1 text-[11px] text-amber-400">Blocker: {stage.blockerNote}</p>
                )}
              </div>
              <Status value={stage.status} />
            </div>
          ))}
        </div>
      </Panel>

      {/* Deliverables */}
      <Panel title="Managed-Service Deliverables">
        <div className="space-y-2">
          {d.deliverables.length ? (
            d.deliverables.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between rounded-xl bg-slate-950 p-3 text-sm">
                <div>
                  <span className="font-bold text-white">{item.title}</span>
                  <small className="block text-xs text-slate-500">
                    {item.type} · due {date(item.dueAt)}
                  </small>
                </div>
                <Status value={item.status} />
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-500">No managed-service deliverables recorded for this business.</p>
          )}
        </div>
      </Panel>

      {/* Invite Owner Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <form onSubmit={submitInviteOwner} className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl space-y-4">
            <h3 className="text-lg font-black">Invite Initial Business Owner</h3>
            <p className="text-xs text-slate-400">
              Send an invitation email to the client owner to set up their password and sign in.
            </p>
            <label className="block text-xs text-slate-400">
              Owner Name
              <input
                required
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                placeholder="e.g. Sarah Jenkins"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white text-sm"
              />
            </label>
            <label className="block text-xs text-slate-400">
              Owner Email
              <input
                required
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="sarah@clientbusiness.com"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white text-sm"
              />
            </label>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-black text-white hover:bg-violet-500"
              >
                Send Invitation
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Support Session Modal */}
      {showSupportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <form onSubmit={submitSupportSession} className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl space-y-4">
            <h3 className="text-lg font-black text-amber-400">Start Audited Support Session</h3>
            <p className="text-xs text-slate-400">
              Grant temporary administrative support access to troubleshoot this client workspace. All support actions are audit-logged.
            </p>
            <label className="block text-xs text-slate-400">
              Audited Reason (Required)
              <textarea
                required
                rows={3}
                value={supportReason}
                onChange={e => setSupportReason(e.target.value)}
                placeholder="e.g. Assisting client owner with Stripe Connect onboarding configuration."
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white text-sm"
              />
            </label>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowSupportModal(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-black text-slate-950 hover:bg-amber-300"
              >
                Confirm Support Access
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

const AgencyTenantUsersPanel: React.FC<{ tenantId: string; tenantName: string; onInviteRequest?: () => void }> = ({ tenantId, tenantName, onInviteRequest }) => {
  const live = useLive<any[]>(() => agencyFetch(`/tenants/${tenantId}/users`), [tenantId]);
  const [manualOpen, setManualOpen] = useState(false);

  const command = async (id: string, action: 'suspend' | 'reactivate' | 'revoke-sessions') =>
    agencyFetch(`/tenants/${tenantId}/users/${id}/${action}`, { method: 'POST' })
      .then(live.reload)
      .catch(e => alert(e.message));

  return <>
    <Panel
      title="Business Account Access"
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
          >
            + Add user manually
          </button>
          {onInviteRequest && (
            <button
              type="button"
              onClick={onInviteRequest}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500"
            >
              + Invite Owner
            </button>
          )}
        </div>
      }
    >
      <State loading={live.loading} error={live.error}>
        {!live.data || live.data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/60 p-6 text-center">
            <p className="text-sm font-bold text-slate-300">No business accounts provisioned yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Add a user directly without email, or invite the initial owner to complete setup by email.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => setManualOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-500"
              >
                + Add user manually
              </button>
              {onInviteRequest && (
                <button
                  type="button"
                  onClick={onInviteRequest}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-black text-white hover:bg-violet-500"
                >
                  + Invite Initial Owner
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {live.data.map(user => (
              <div
                key={user.id}
                className="flex flex-col gap-3 rounded-xl bg-slate-950 p-3.5 text-sm md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <strong className="text-white font-bold">{user.displayName}</strong>
                  <small className="block text-xs text-slate-500">{user.email}</small>
                </div>
                <span className="flex flex-wrap items-center gap-2">
                  <Status value={user.role} />
                  <Status value={user.status} />
                  <button
                    type="button"
                    onClick={() => command(user.id, user.status === 'SUSPENDED' ? 'reactivate' : 'suspend')}
                    className="rounded-lg border border-slate-700 px-2.5 py-1 text-[10px] font-bold text-slate-300 hover:text-white"
                  >
                    {user.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
                  </button>
                  <button
                    type="button"
                    onClick={() => command(user.id, 'revoke-sessions')}
                    className="rounded-lg border border-slate-700 px-2.5 py-1 text-[10px] font-bold text-slate-300 hover:text-white"
                  >
                    Revoke sessions
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </State>
    </Panel>
    <ManualTenantUserDialog
      open={manualOpen}
      tenantId={tenantId}
      tenantName={tenantName}
      onClose={() => setManualOpen(false)}
      onCreated={live.reload}
    />
  </>;
};

export const AgencyTenantDetailPage: React.FC = () => {
  return <AgencyTenantDetailPageFixed />;
};

export const AgencyPlansPage:React.FC=()=>{const live=useLive<any[]>(()=>agencyFetch('/plans'),[]);return <State loading={live.loading} error={live.error}><div className="grid gap-4 lg:grid-cols-3">{live.data?.filter(x=>x.version).map(x=><Panel key={x.version.id} title={`${x.plan.name} · v${x.version.version}`}><p className="text-3xl font-black">{money(x.version.monthlyPriceMinor,x.version.currency)}<small className="text-xs text-slate-500"> / month</small></p><div className="mt-4"><Status value={x.version.status}/></div><p className="mt-3 text-xs text-slate-500">Immutable version effective {date(x.version.effectiveFrom)}</p></Panel>)}</div></State>;};
export const AgencySupportPage:React.FC=()=>{const live=useLive<any>(()=>agencyFetch('/support/overview'),[]);return <State loading={live.loading} error={live.error}><div className="grid gap-5 lg:grid-cols-2"><Panel title="Failed jobs"><div className="space-y-2">{live.data?.failedJobs.map((j:any)=><div key={j.id} className="rounded-xl bg-slate-950 p-3 text-xs"><div className="flex justify-between"><strong>{j.jobType}</strong><Status value={j.status}/></div><p className="text-slate-500">{j.failureCode}</p>{j.safeRetryKind&&<button onClick={async()=>{const reason=prompt('Retry reason');if(reason)await agencyFetch(`/support/failed-jobs/${j.id}/retry`,{method:'POST',body:JSON.stringify({reason})}).then(live.reload).catch(e=>alert(e.message));}} className="mt-2 text-violet-300 font-bold">Queue safe retry</button>}</div>)}</div></Panel><Panel title="Open incidents"><div className="space-y-2">{live.data?.incidents.map((i:any)=><div key={i.id} className="rounded-xl bg-slate-950 p-3 text-xs"><strong>{i.title}</strong><p className="text-slate-500">{i.severity} · {date(i.startedAt)}</p></div>)}</div></Panel></div></State>;};
export const AgencyAnalyticsPage:React.FC=()=>{const live=useLive<any>(()=>agencyFetch('/analytics'),[]);return <State loading={live.loading} error={live.error}><div className="space-y-5"><div className="grid gap-4 md:grid-cols-3"><Metric label="GoCardless MRR" value={money(live.data?.revenue.mrr_minor)}/><Metric label="MRR at risk" value={money(live.data?.revenue.at_risk_mrr_minor)}/><Metric label="30d active tenants" value={live.data?.usage.active_tenants_30d||0}/></div><Panel title="Metric provenance"><p className="text-sm text-slate-300">Subscription revenue is calculated exclusively from GoCardless-backed tenant subscriptions. Stripe Connect appointment revenue is intentionally excluded.</p></Panel></div></State>;};
export const AgencyAuditPage:React.FC=()=>{const live=useLive<any[]>(()=>agencyFetch('/audit'),[]);return <Panel title="Append-only agency audit"><State loading={live.loading} error={live.error}><div className="space-y-2">{live.data?.map(e=><div key={e.id} className="grid gap-2 rounded-xl bg-slate-950 p-3 text-xs md:grid-cols-5"><strong>{e.action}</strong><span>{e.targetType}</span><span>{e.outcome}</span><span>{e.tenantId||'Platform'}</span><span>{new Date(e.occurredAt).toLocaleString()}</span></div>)}</div></State></Panel>;};
export const AgencyUsersPage:React.FC=()=>{const{session}=useAgencyAuth();const live=useLive<any[]>(()=>agencyFetch('/users'),[]);const command=async(id:string,action:'suspend'|'reactivate'|'revoke-sessions')=>agencyFetch(`/users/${id}/${action}`,{method:'POST'}).then(live.reload).catch(e=>alert(e.message));return <Panel title="Agency identities"><p className="mb-4 text-xs text-slate-500">Roles are server-owned. Privileged roles require Supabase MFA at AAL2.</p><State loading={live.loading} error={live.error}><div className="space-y-2">{live.data?.map(u=><div key={u.id} className="flex flex-col gap-3 rounded-xl bg-slate-950 p-3 text-sm md:flex-row md:items-center md:justify-between"><span><strong>{u.displayName}</strong><small className="block text-slate-500">{u.email}</small></span><span className="flex flex-wrap items-center gap-2"><Status value={u.role}/><Status value={u.status}/>{session?.user.role==='PLATFORM_OWNER'&&<><button onClick={()=>command(u.id,u.status==='SUSPENDED'?'reactivate':'suspend')} className="rounded-lg border border-slate-700 px-2 py-1 text-[10px] font-bold">{u.status==='SUSPENDED'?'Reactivate':'Suspend'}</button><button onClick={()=>command(u.id,'revoke-sessions')} className="rounded-lg border border-slate-700 px-2 py-1 text-[10px] font-bold">Revoke sessions</button></>}</span></div>)}</div></State>{session?.user.role!=='PLATFORM_OWNER'&&<p className="mt-3 text-xs text-slate-500">Only the platform owner can invite or suspend agency identities.</p>}</Panel>;};
export const AgencyWorkQueuePage:React.FC<{mode:'ONBOARDING'|'BILLING'|'FULFILMENT'}>=({mode})=>{const live=useLive<any[]>(()=>agencyFetch('/tenants'),[mode]);const filtered=mode==='ONBOARDING'?live.data?.filter(t=>t.lifecycleStatus==='ONBOARDING'):live.data;return <Panel title={`${mode.toLowerCase()} work queue`}><State loading={live.loading} error={live.error}><div className="grid gap-3 md:grid-cols-2">{filtered?.map(t=><Link key={t.id} to={`/agency/tenants/${t.id}`} className="rounded-xl bg-slate-950 p-4"><div className="flex justify-between"><strong>{t.name}</strong><Status value={t.lifecycleStatus}/></div><p className="mt-1 text-xs text-slate-500">{t.planKey||'No plan'} · {t.primaryContactEmail||'No contact'}</p></Link>)}</div></State></Panel>;};

export const AgencyPlanCreatePage:React.FC=()=>{const navigate=useNavigate();const[error,setError]=useState<string|null>(null);const submit=async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const entitlements=JSON.parse(String(f.get('entitlements')));await agencyFetch('/plans/versions',{method:'POST',body:JSON.stringify({planKey:f.get('planKey'),version:Number(f.get('version')),name:f.get('name'),monthlyPriceMinor:Number(f.get('monthlyPriceMinor')),setupFeeAmountMinor:Number(f.get('setupFeeAmountMinor')),currency:'GBP',effectiveFrom:new Date(String(f.get('effectiveFrom'))).toISOString(),status:'DRAFT',entitlements})});navigate('/agency/plans');}catch(e:any){setError(e.message);}};return <Panel title="Create immutable plan version"><form onSubmit={submit} className="grid gap-4 md:grid-cols-2">{error&&<p className="md:col-span-2 text-rose-300">{error}</p>}<label className="text-xs text-slate-400">Plan<select name="planKey" className="mt-1 w-full rounded-xl bg-slate-950 border border-slate-700 p-3"><option>CORE</option><option>GROWTH</option><option>SCALE</option></select></label><Field name="version" label="Version number" type="number"/><Field name="name" label="Version name"/><Field name="setupFeeAmountMinor" label="Setup fee (minor units)" type="number"/><Field name="monthlyPriceMinor" label="Monthly amount (minor units)" type="number"/><Field name="effectiveFrom" label="Effective date" type="date"/><label className="md:col-span-2 text-xs text-slate-400">Entitlements JSON<textarea name="entitlements" required rows={10} defaultValue={'[{"key":"staff.limit","name":"Active staff","type":"QUANTITY","availability":"GENERALLY_AVAILABLE","value":{"limit":5}}]'} className="mt-1 w-full rounded-xl bg-slate-950 border border-slate-700 p-3 font-mono text-xs"/></label><button className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-black">Create draft version</button></form></Panel>;};

export const AgencyUserInvitePage:React.FC=()=>{const navigate=useNavigate();const[error,setError]=useState<string|null>(null);const submit=async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await agencyFetch('/users',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});navigate('/agency/users');}catch(e:any){setError(e.message);}};return <Panel title="Invite agency identity"><form onSubmit={submit} className="grid gap-4 md:grid-cols-2">{error&&<p className="md:col-span-2 text-rose-300">{error}</p>}<Field name="displayName" label="Display name"/><Field name="email" label="Email" type="email"/><label className="text-xs text-slate-400">Role<select name="role" className="mt-1 w-full rounded-xl bg-slate-950 border border-slate-700 p-3"><option>AGENCY_ADMINISTRATOR</option><option>SUPPORT_ADMINISTRATOR</option><option>FULFILMENT_ADMINISTRATOR</option></select></label><div className="md:col-span-2"><button className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-black">Send secure invite</button></div></form></Panel>;};

export const AgencyTenantBillingPage:React.FC=()=>{const{tenantId}=useParams();const live=useLive<any>(()=>agencyFetch(`/tenants/${tenantId}/billing`),[tenantId]);const plans=useLive<any[]>(()=>agencyFetch('/plans'),[]);const[selected,setSelected]=useState('');useEffect(()=>{const first=plans.data?.find(x=>x.version?.status==='ACTIVE');if(first&&!selected)setSelected(first.version.id);},[plans.data]);const command=async(path:string,body:any)=>agencyFetch(path,{method:'POST',body:JSON.stringify(body)}).then(live.reload).catch(e=>alert(e.message));return <div className="space-y-5"><Panel title="GoCardless commercial billing"><div className="flex flex-wrap gap-2"><button onClick={()=>command(`/tenants/${tenantId}/billing-request`,{description:'KS OS setup fee',successRedirectUrl:window.location.href,exitRedirectUrl:window.location.href})} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold">Create setup + mandate flow</button><select value={selected} onChange={e=>setSelected(e.target.value)} className="rounded-lg bg-slate-950 border border-slate-700 px-3 text-xs">{plans.data?.filter(x=>x.version?.status==='ACTIVE').map(x=><option key={x.version.id} value={x.version.id}>{x.plan.name} v{x.version.version}</option>)}</select><button onClick={()=>command(`/tenants/${tenantId}/subscriptions`,{planVersionId:selected})} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold">Activate subscription</button>{(['pause','resume','cancel'] as const).map(action=><button key={action} onClick={()=>{const reason=prompt(`${action} reason`);if(reason)void command(`/tenants/${tenantId}/subscription-actions/${action}`,{reason});}} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold capitalize">{action}</button>)}</div><p className="mt-3 text-xs text-slate-500">All amounts resolve from the assigned plan version. Stripe Connect appointment revenue is not shown here.</p></Panel><State loading={live.loading} error={live.error}><Panel title="Billing state"><dl className="grid gap-3 md:grid-cols-3"><Fact label="Mandate" value={live.data?.account?.mandateStatus||'NOT CREATED'}/><Fact label="Subscription" value={live.data?.subscriptions?.[0]?.status||'NONE'}/><Fact label="Monthly" value={money(live.data?.subscriptions?.[0]?.amountMinor)}/></dl></Panel></State></div>;};

export const AgencyTenantEntitlementsPage:React.FC=()=>{const{tenantId}=useParams();const live=useLive<any>(()=>agencyFetch(`/tenants/${tenantId}/entitlements`),[tenantId]);return <Panel title="Resolved backend entitlements"><State loading={live.loading} error={live.error}><p className="mb-4 text-sm font-bold">{live.data?.plan?.name||'No active plan'}</p><div className="space-y-2">{Object.entries(live.data?.entitlements||{}).map(([key,value])=><div key={key} className="flex justify-between rounded-xl bg-slate-950 p-3 text-xs"><strong>{key}</strong><code>{JSON.stringify(value)}</code></div>)}</div><button onClick={async()=>{const entitlementKey=prompt('Entitlement key');const value=prompt('Override JSON');const reason=prompt('Reason');if(entitlementKey&&value&&reason)await agencyFetch(`/tenants/${tenantId}/entitlement-overrides`,{method:'POST',body:JSON.stringify({entitlementKey,value:JSON.parse(value),reason,expiresAt:new Date(Date.now()+7*86400000).toISOString()})}).then(live.reload).catch(e=>alert(e.message));}} className="mt-4 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold">Add seven-day override</button></State></Panel>;};

export const AgencyTenantHealthPage:React.FC=()=>{const{tenantId}=useParams();const live=useLive<any>(()=>agencyFetch(`/tenants/${tenantId}/health`),[tenantId]);return <Panel title="Tenant health"><State loading={live.loading} error={live.error}><dl className="grid gap-3 md:grid-cols-4"><Fact label="Lifecycle" value={live.data?.tenant.lifecycleStatus}/><Fact label="GoCardless" value={live.data?.billing.subscriptionStatus}/><Fact label="Stripe Connect" value={live.data?.stripe?.status||'NOT CONNECTED'}/><Fact label="Failed jobs" value={live.data?.failedJobs.length||0}/></dl></State></Panel>;};

export const AgencyComplianceAuditPage:React.FC=()=>{const[filters,setFilters]=useState({search:'',category:'',outcome:'',from:'',to:''});const[cursor,setCursor]=useState('');const[selected,setSelected]=useState<any>(null);const[notice,setNotice]=useState('');const query=useMemo(()=>{const q=new URLSearchParams({limit:'50'});for(const[k,v]of Object.entries(filters))if(v)q.set(k,v);if(cursor)q.set('cursor',cursor);return q.toString();},[filters,cursor]);const live=useLive<any>(()=>agencyFetch(`/compliance/audit?${query}`),[query]);const update=(key:string,value:string)=>{setCursor('');setFilters(v=>({...v,[key]:value}));};return <div className="space-y-5"><Panel title="Compliance audit log" action={<button onClick={async()=>{try{await agencyFetch('/analytics/exports',{method:'POST',body:JSON.stringify({exportType:'AUDIT',filters})});setNotice('Audit export queued. It will appear in export history when ready.');}catch(e:any){setNotice(e.message);}}} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-black">Export CSV</button>}><p className="mb-4 text-xs text-slate-400">Append-only security, privacy, financial and administrative events. Protected values are replaced with [REDACTED].</p>{notice&&<p role="status" className="mb-3 rounded-lg bg-slate-950 p-3 text-xs text-slate-300">{notice}</p>}<div className="mb-4 grid gap-2 md:grid-cols-5"><input value={filters.search} onChange={e=>update('search',e.target.value)} placeholder="Audit ID, entity or description" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs"/><select value={filters.category} onChange={e=>update('category',e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs"><option value="">All categories</option>{['AUTHENTICATION','AUTHORISATION','ADMINISTRATION','FINANCIAL','PRIVACY','CONSENT','SECURITY','BOOKING','INTEGRATION','RETENTION','DATA_ACCESS'].map(x=><option key={x}>{x}</option>)}</select><select value={filters.outcome} onChange={e=>update('outcome',e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs"><option value="">All outcomes</option><option>SUCCESS</option><option>FAILED</option><option>DENIED</option></select><input aria-label="From date" type="date" value={filters.from} onChange={e=>update('from',e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs"/><input aria-label="To date" type="date" value={filters.to} onChange={e=>update('to',e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs"/></div><State loading={live.loading} error={live.error}><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="uppercase text-slate-500"><tr><th className="p-2">Time</th><th>Category</th><th>Event</th><th>Target</th><th>Result</th><th></th></tr></thead><tbody>{live.data?.rows?.map((event:any)=><tr key={event.id} className="border-t border-slate-800"><td className="p-2 whitespace-nowrap">{new Date(event.occurredAt).toLocaleString()}</td><td>{event.eventCategory}</td><td><strong>{event.action}</strong><small className="block max-w-md text-slate-500">{event.description||event.reason}</small></td><td>{event.targetType}<small className="block text-slate-500">{event.targetId}</small></td><td><Status value={event.outcome}/></td><td><button onClick={()=>setSelected(event)} className="font-bold text-violet-300">Details</button></td></tr>)}</tbody></table></div>{live.data?.nextCursor&&<button onClick={()=>setCursor(live.data.nextCursor)} className="mt-4 rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold">Next page</button>}</State></Panel>{selected&&<Panel title={`Audit event ${selected.id}`} action={<button onClick={()=>setSelected(null)} className="text-xs">Close</button>}><dl className="grid gap-3 md:grid-cols-3"><Fact label="Actor role" value={selected.actorRole||'System'}/><Fact label="Tenant" value={selected.tenantId||'Platform'}/><Fact label="Request ID" value={selected.requestId||'—'}/></dl>{selected.containsRedactions&&<p className="mt-3 rounded-lg bg-amber-950/40 p-3 text-xs text-amber-200">Protected fields were redacted before this event was stored.</p>}<div className="mt-4 grid gap-3 md:grid-cols-2"><pre className="overflow-auto rounded-lg bg-slate-950 p-3 text-xs">Before{`\n`}{JSON.stringify(selected.previousValues,null,2)}</pre><pre className="overflow-auto rounded-lg bg-slate-950 p-3 text-xs">After{`\n`}{JSON.stringify(selected.newValues,null,2)}</pre></div><pre className="mt-3 overflow-auto rounded-lg bg-slate-950 p-3 text-xs">Metadata{`\n`}{JSON.stringify(selected.metadata,null,2)}</pre></Panel>}</div>;};

export const AgencyFulfilmentPage:React.FC=()=>{const live=useLive<any[]>(()=>agencyFetch('/fulfilment'),[]);return <Panel title="Managed-service fulfilment"><State loading={live.loading} error={live.error}><div className="space-y-2">{live.data?.map(row=><Link key={row.deliverable.id} to={`/agency/tenants/${row.deliverable.tenantId}/fulfilment`} className="flex justify-between rounded-xl bg-slate-950 p-3 text-xs"><span><strong>{row.deliverable.title}</strong><small className="block text-slate-500">{row.tenantName} · {row.deliverable.type}</small></span><Status value={row.deliverable.status}/></Link>)}</div></State></Panel>;};

export const AgencyWebhooksPage:React.FC=()=>{const live=useLive<any[]>(()=>agencyFetch('/webhooks'),[]);return <Panel title="Provider webhook operations"><State loading={live.loading} error={live.error}><div className="space-y-2">{live.data?.map(event=><div key={`${event.provider}-${event.id}`} className="grid gap-2 rounded-xl bg-slate-950 p-3 text-xs md:grid-cols-5"><strong>{event.provider}</strong><span>{event.eventType}</span><span>{event.action||'—'}</span><Status value={event.status}/><span>{date(event.receivedAt)}{event.provider==='GOCARDLESS'&&event.status==='FAILED'&&<button onClick={async()=>{const reason=prompt('Replay reason');if(reason)await agencyFetch(`/webhooks/${event.id}/replay`,{method:'POST',body:JSON.stringify({reason})}).then(live.reload).catch(e=>alert(e.message));}} className="ml-3 text-violet-300">Requeue</button>}</span></div>)}</div></State></Panel>;};
export const AgencyJobsPage:React.FC=()=>{const live=useLive<any[]>(()=>agencyFetch('/jobs'),[]);return <Panel title="Background jobs"><State loading={live.loading} error={live.error}><div className="space-y-2">{live.data?.map(job=><div key={job.id} className="flex justify-between rounded-xl bg-slate-950 p-3 text-xs"><span><strong>{job.jobType}</strong><small className="block text-slate-500">{job.failureCode} · attempt {job.attemptCount}</small></span><span><Status value={job.status}/>{job.status==='FAILED'&&job.safeRetryKind&&<button onClick={async()=>{const reason=prompt('Retry reason');if(reason)await agencyFetch(`/jobs/${job.id}/retry`,{method:'POST',body:JSON.stringify({reason})}).then(live.reload).catch(e=>alert(e.message));}} className="ml-3 text-violet-300">Retry safely</button>}</span></div>)}</div></State></Panel>;};
