import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Loader2, Plus, Rocket, X } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { agencyFetch, useAgencyAuth } from './AgencyAuth';
import { AgencyLaunchCommandCenter } from './AgencyLaunchCommandCenter';
import { WorkspaceDataControls } from './WorkspaceDataControls';

const isRemovedWorkspace = (tenant: any) => tenant.lifecycleStatus === 'OFFBOARDED'
  && tenant.name === 'Deleted workspace'
  && String(tenant.subdomain || '').startsWith('deleted-');

export function AgencyProvisioningPage() {
  const [params, setParams] = useSearchParams();
  const tenantId = params.get('tenant');
  if (tenantId) {
    return <SelectedClientLaunchWorkspace
      tenantId={tenantId}
      onBack={() => setParams({})}
    />;
  }
  return <ClientLaunchDirectory onSelect={reference => setParams({ tenant: reference })} />;
}

function SelectedClientLaunchWorkspace({ tenantId, onBack }: { tenantId: string; onBack: () => void }) {
  const { session } = useAgencyAuth();
  const [detail, setDetail] = useState<any>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadDetail = async () => {
    const nextDetail = await agencyFetch(`/tenants/${tenantId}`);
    setDetail(nextDetail);
  };

  useEffect(() => {
    void loadDetail().catch((cause: Error) => setError(cause.message));
  }, [tenantId]);

  const tenant = detail?.tenant;
  const canManage = Boolean(session?.capabilities.includes('tenants.manage'));
  const isPlatformOwner = session?.user.role === 'PLATFORM_OWNER';

  return <div className="space-y-6">
    <AgencyLaunchCommandCenter tenantId={tenantId} onBack={onBack} />
    {error ? <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/35 p-4 text-sm text-rose-200">{error}</p> : null}
    {notice ? <p role="status" className="rounded-xl border border-emerald-800 bg-emerald-950/35 p-4 text-sm text-emerald-200">{notice}</p> : null}
    {tenant ? <WorkspaceDataControls
      tenantId={tenantId}
      tenantName={tenant.name}
      lifecycleStatus={tenant.lifecycleStatus}
      canManage={canManage}
      isPlatformOwner={isPlatformOwner}
      onDeleted={onBack}
      onRefresh={loadDetail}
      onNotice={setNotice}
      onError={setError}
    /> : null}
  </div>;
}

function ClientLaunchDirectory({ onSelect }: { onSelect: (reference: string) => void }) {
  const [tenants, setTenants] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [subdomain, setSubdomain] = useState('');
  const activePlans = useMemo(() => plans.filter(item => item.version?.status === 'ACTIVE'), [plans]);

  const load = () => Promise.all([agencyFetch('/tenants'), agencyFetch('/plans')])
    .then(([rows, planRows]: [any[], any[]]) => {
      setTenants(rows.filter(row => !isRemovedWorkspace(row)));
      setPlans(planRows);
    });

  useEffect(() => {
    void load()
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  const createClient = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true); setError('');
    try {
      const form = new FormData(event.currentTarget);
      const created = await agencyFetch('/tenants', {
        method: 'POST',
        body: JSON.stringify({
          name: String(form.get('name') || '').trim(),
          legalBusinessName: String(form.get('legalBusinessName') || '').trim(),
          subdomain: String(form.get('subdomain') || '').trim().toLowerCase(),
          businessType: String(form.get('businessType') || '').trim(),
          primaryContactName: String(form.get('primaryContactName') || '').trim(),
          primaryContactEmail: String(form.get('primaryContactEmail') || '').trim(),
          planVersionId: String(form.get('planVersionId') || ''),
          timezone: 'Europe/London',
          currency: 'GBP',
        }),
      });
      onSelect(created.id || created.agencyReference);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The client could not be created.');
    } finally { setCreating(false); }
  };

  return <div className="space-y-6">
    <section className="rounded-3xl border border-violet-800/60 bg-gradient-to-br from-violet-950 via-slate-950 to-slate-900 p-6 shadow-2xl sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-300">Governed client delivery</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-white">Launch command centre</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Move each client through explicit discovery, fact, booking, blueprint, Search Intelligence, generation, review, quality and publication gates. Human approvals stay visible and separate.</p>
        </div>
        <button type="button" onClick={() => setShowCreate(true)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-black text-slate-950 hover:bg-emerald-400">
          <Plus className="h-4 w-4" />Create new client
        </button>
      </div>
    </section>

    {error ? <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/35 p-4 text-sm text-rose-200">{error}</p> : null}

    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
      <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
        <Rocket className="h-5 w-5 text-violet-300" />
        <div><h2 className="text-base font-black text-white">Client launch workspaces</h2><p className="mt-1 text-xs text-slate-500">Every client continues in the same governed timeline.</p></div>
      </div>
      {loading ? <p className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading clients…</p> : tenants.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-slate-700 bg-slate-950 p-8 text-center"><Building2 className="mx-auto h-8 w-8 text-slate-500" /><h3 className="mt-3 text-sm font-black text-white">Create the first client</h3><p className="mt-2 text-xs text-slate-500">Client details, fact finding, booking and website delivery all begin here.</p><button type="button" onClick={() => setShowCreate(true)} className="mt-4 min-h-11 rounded-xl bg-violet-600 px-4 text-xs font-black text-white">Create client</button></div> : <div className="mt-5 grid gap-3 lg:grid-cols-2">{tenants.map(tenant => <button key={tenant.id} type="button" onClick={() => onSelect(tenant.id)} className="group rounded-2xl border border-slate-800 bg-slate-950 p-5 text-left transition hover:border-violet-600 hover:bg-violet-950/20">
        <div className="flex items-start justify-between gap-4"><div><strong className="text-base text-white">{tenant.name}</strong><p className="mt-1 font-mono text-xs text-indigo-300">{tenant.subdomain}.sites.kasimshah.com</p></div><span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] font-black text-slate-300">{String(tenant.lifecycleStatus).replaceAll('_', ' ')}</span></div>
        <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4 text-xs text-slate-500"><span>{tenant.planKey || 'Plan pending'} · {tenant.primaryContactEmail || 'Contact pending'}</span><span className="font-black text-violet-300 group-hover:text-white">Continue launch →</span></div>
      </button>)}</div>}
    </section>

    {showCreate ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/85 p-4" role="dialog" aria-modal="true" aria-labelledby="create-client-heading"><form onSubmit={createClient} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Start client launch</p><h2 id="create-client-heading" className="mt-2 text-2xl font-black text-white">Create the client workspace</h2><p className="mt-2 text-xs leading-5 text-slate-400">After creation, this form opens the same client's commercial, fact-finding, booking, website and domain timeline.</p></div><button type="button" onClick={() => setShowCreate(false)} aria-label="Close create client" className="grid h-11 w-11 place-items-center rounded-xl border border-slate-700 text-slate-300"><X className="h-4 w-4" /></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><Field name="name" label="Trading business name" /><Field name="legalBusinessName" label="Legal entity name" /><label className="text-xs font-bold text-slate-300">Workspace subdomain<input name="subdomain" required value={subdomain} onChange={event => setSubdomain(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 font-mono text-white" /><span className="mt-1 block font-mono text-[10px] text-indigo-400">{subdomain || 'client'}.sites.kasimshah.com</span></label><Field name="businessType" label="Business type" /><Field name="primaryContactName" label="Primary contact name" /><Field name="primaryContactEmail" label="Primary contact email" type="email" /><label className="text-xs font-bold text-slate-300 sm:col-span-2">Package<select name="planVersionId" required className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"><option value="">Choose active package…</option>{activePlans.map(item => <option key={item.version.id} value={item.version.id}>{item.plan.name || item.plan.key} · version {item.version.version}</option>)}</select></label></div><button disabled={creating || activePlans.length === 0} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-black text-slate-950 disabled:opacity-40">{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}{creating ? 'Creating client…' : 'Create and open launch pipeline'}</button></form></div> : null}
  </div>;
}

function Field({ name, label, type = 'text' }: { name: string; label: string; type?: string }) {
  return <label className="text-xs font-bold text-slate-300">{label}<input name={name} type={type} required className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" /></label>;
}
