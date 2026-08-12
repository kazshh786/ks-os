import React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import AgencyClientAssetLibraryPage from './AgencyClientAssetLibraryPage';
import { AgencyLaunchTenantResolver } from './AgencyLaunchTenantResolver';

export function AgencyWorkspaceOnboardingPage() {
  const navigate = useNavigate();
  const { tenantId } = useParams<{ tenantId: string }>();
  const [params] = useSearchParams();

  if (!tenantId) {
    return <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/35 p-4 text-sm text-rose-200">
      Select a client workspace before opening the launch workspace.
    </p>;
  }

  const view = params.get('view') === 'assets' ? 'assets' : 'launch';
  return <div className="space-y-6">
    <nav aria-label="Launch workspace" className="flex gap-2 overflow-x-auto pb-1">
      <Link
        to={`/agency/tenants/${tenantId}/onboarding`}
        className={`shrink-0 rounded-xl px-4 py-2 text-xs font-black ${view === 'launch' ? 'bg-violet-600 text-white' : 'border border-slate-800 bg-slate-950 text-slate-400 hover:text-white'}`}
      >Launch plan</Link>
      <Link
        to={`/agency/tenants/${tenantId}/onboarding?view=assets`}
        className={`shrink-0 rounded-xl px-4 py-2 text-xs font-black ${view === 'assets' ? 'bg-violet-600 text-white' : 'border border-slate-800 bg-slate-950 text-slate-400 hover:text-white'}`}
      >Brand and assets</Link>
    </nav>
    {view === 'assets'
      ? <AgencyClientAssetLibraryPage />
      : <AgencyLaunchTenantResolver
          tenantIdentifier={tenantId}
          onBack={() => navigate(`/agency/tenants/${tenantId}`)}
        />}
  </div>;
}

export default AgencyWorkspaceOnboardingPage;
