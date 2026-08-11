import React from 'react';
import { useNavigate, useParams } from 'react-router';
import { AgencyLaunchTenantResolver } from './AgencyLaunchTenantResolver';

export function AgencyWorkspaceOnboardingPage() {
  const navigate = useNavigate();
  const { tenantId } = useParams<{ tenantId: string }>();

  if (!tenantId) {
    return <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/35 p-4 text-sm text-rose-200">
      Select a client workspace before opening Agency Launch V2.
    </p>;
  }

  return <AgencyLaunchTenantResolver
    tenantIdentifier={tenantId}
    onBack={() => navigate(`/agency/tenants/${tenantId}`)}
  />;
}

export default AgencyWorkspaceOnboardingPage;
