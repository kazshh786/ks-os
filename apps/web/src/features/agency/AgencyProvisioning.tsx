import React, { useEffect, useState } from 'react';
import { Building2, Loader2, Plus, Rocket } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { agencyFetch } from './AgencyAuth';
import { AgencyWorkspaceLaunchPipeline } from './AgencyWorkspaceLaunchPipeline';

const isRemovedWorkspace = (tenant: any) => tenant.lifecycleStatus === 'OFFBOARDED'
  && tenant.name === 'Deleted workspace'
  && String(tenant.subdomain || '').startsWith('deleted-');

export function AgencyProvisioningPage() {
  const [params, setParams] = useSearchParams();
  const tenantId = params.get('tenant');
  if (tenantId) {
    return <AgencyWorkspaceLaunchPipeline
      tenantIdOverride={tenantId}
      onBack={() => setParams({})}
    />;
  }
  return <ClientLaunchDirectory onSelect={reference => setParams({ tenant: reference })} />;
}

function ClientLaunchDirectory({ onSelect }: { onSelect: (reference: string) => void }) {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void agencyFetch('/tenants')
      .then((rows: any[]) => setTenants(rows.filter(row => !isRemovedWorkspace(row))))
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  return <div className="space-y-6">
    <section className="rounded-3xl border border-violet-800/60 bg-gradient-to-br from-violet-950 via-slate-950 to-slate-900 p-6 shadow-2xl sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-300">One client launch path</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-white">Create booking and website together</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Open a client to complete fact finding, reuse or add booking services, choose the website design, build the ten-page launch site, review the staging subdomain and connect the production domain.</p>
        </div>
        <Link to="/agency/tenants/new" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-black text-slate-950 hover:bg-emerald-400">
          <Plus className="h-4 w-4" />Create new client
        </Link>
      </div>
    </section>

    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
      <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
        <Rocket className="h-5 w-5 text-violet-300" />
        <div><h2 className="text-base font-black text-white">Client launch workspaces</h2><p className="mt-1 text-xs text-slate-500">Every client continues in the same governed timeline.</p></div>
      </div>
      {loading ? <p className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading clients…</p> : error ? <p role="alert" className="mt-5 rounded-xl border border-rose-800 bg-rose-950/35 p-4 text-sm text-rose-200">{error}</p> : tenants.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-slate-700 bg-slate-950 p-8 text-center"><Building2 className="mx-auto h-8 w-8 text-slate-500" /><h3 className="mt-3 text-sm font-black text-white">Create the first client</h3><p className="mt-2 text-xs text-slate-500">Client details, fact finding, booking and website delivery all begin here.</p></div> : <div className="mt-5 grid gap-3 lg:grid-cols-2">{tenants.map(tenant => <button key={tenant.id} type="button" onClick={() => onSelect(tenant.id)} className="group rounded-2xl border border-slate-800 bg-slate-950 p-5 text-left transition hover:border-violet-600 hover:bg-violet-950/20">
        <div className="flex items-start justify-between gap-4"><div><strong className="text-base text-white">{tenant.name}</strong><p className="mt-1 font-mono text-xs text-indigo-300">{tenant.subdomain}.sites.kasimshah.com</p></div><span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] font-black text-slate-300">{String(tenant.lifecycleStatus).replaceAll('_', ' ')}</span></div>
        <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4 text-xs text-slate-500"><span>{tenant.planKey || 'Plan pending'} · {tenant.primaryContactEmail || 'Contact pending'}</span><span className="font-black text-violet-300 group-hover:text-white">Continue launch →</span></div>
      </button>)}</div>}
    </section>
  </div>;
}
