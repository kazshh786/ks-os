import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { agencyFetch } from './AgencyAuth';
import { AgencyLaunchCommandCenter } from './AgencyLaunchCommandCenter';

type TenantSummary = {
  id: string;
  agencyReference: string;
};

type TenantDetail = {
  tenant: TenantSummary & {
    name: string;
    lifecycleStatus: string;
  };
  [key: string]: unknown;
};

type ResolvedLaunchTenant = {
  detail: TenantDetail;
  reload: () => Promise<void>;
};

export async function resolveAgencyLaunchTenant(identifier: string): Promise<TenantDetail> {
  const tenants = await agencyFetch('/tenants') as TenantSummary[];
  const selected = tenants.find(tenant => (
    tenant.agencyReference === identifier || tenant.id === identifier
  ));
  if (!selected) throw new Error('Client business was not found.');

  const detail = await agencyFetch(`/tenants/${selected.id}`) as TenantDetail;
  if (!detail?.tenant?.agencyReference) {
    throw new Error('The client public reference was not returned.');
  }
  return detail;
}

export function AgencyLaunchTenantResolver({
  tenantIdentifier,
  onBack,
  onCanonicalReference,
  children,
}: {
  tenantIdentifier: string;
  onBack: () => void;
  onCanonicalReference?: (reference: string) => void;
  children?: (resolved: ResolvedLaunchTenant) => React.ReactNode;
}) {
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const detailMatchesIdentifier = useMemo(() => Boolean(detail && (
    detail.tenant.id === tenantIdentifier || detail.tenant.agencyReference === tenantIdentifier
  )), [detail, tenantIdentifier]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextDetail = await resolveAgencyLaunchTenant(tenantIdentifier);
      setDetail(nextDetail);
      if (nextDetail.tenant.agencyReference !== tenantIdentifier) {
        onCanonicalReference?.(nextDetail.tenant.agencyReference);
      }
    } catch (cause) {
      setDetail(null);
      setError(cause instanceof Error ? cause.message : 'The client launch workspace could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [onCanonicalReference, tenantIdentifier]);

  useEffect(() => {
    if (detailMatchesIdentifier) return;
    void load();
  }, [detailMatchesIdentifier, load]);

  if (loading || !detailMatchesIdentifier) {
    if (error && !loading) {
      return <div role="alert" className="rounded-3xl border border-rose-800 bg-rose-950/35 p-8 text-sm text-rose-200">
        <p>{error}</p>
        <button type="button" onClick={() => void load()} className="mt-4 min-h-11 rounded-xl border border-rose-700 px-4 text-xs font-black text-rose-100">Retry</button>
      </div>;
    }
    return <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-sm text-slate-400">Loading governed launch workspace…</div>;
  }

  return <div className="space-y-6">
    <AgencyLaunchCommandCenter
      tenantReference={detail.tenant.agencyReference}
      tenantDetail={detail}
      onBack={onBack}
    />
    {children?.({ detail, reload: load })}
  </div>;
}
