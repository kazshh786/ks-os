import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { BusinessTenant } from '../data/types';
import { useAuth } from '../auth/useAuth';
import { fetchWithAuth } from '../api/client.js';

interface WorkspaceContextType {
  tenants: BusinessTenant[];
  activeTenant: BusinessTenant | null;
  setActiveTenant: (tenant: BusinessTenant) => void;
  refreshWorkspace: () => Promise<void>;
  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const fallbackTenant = useMemo<BusinessTenant | null>(() => auth.authUserId ? {
    id: auth.businessReference,
    name: auth.tenantName,
    subdomain: auth.tenantSubdomain,
    primaryColor: '#0f172a',
    secondaryColor: '#475569',
    timezone: 'Europe/London',
    currency: 'GBP',
    plan: 'Starter',
    paymentPolicy: 'CustomerChoice',
    depositPercentage: 0,
  } : null, [auth.authUserId, auth.businessReference, auth.tenantName, auth.tenantSubdomain]);
  const [activeTenant, setActiveTenantState] = useState<BusinessTenant | null>(fallbackTenant);
  const [loading, setLoading] = useState(Boolean(auth.authUserId));

  const refreshWorkspace = useCallback(async () => {
    if (!auth.authUserId) {
      setActiveTenantState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetchWithAuth('/api/v1/workspace');
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || 'Business settings could not be loaded.');
      if (body.data?.profile) setActiveTenantState(body.data.profile as BusinessTenant);
    } finally {
      setLoading(false);
    }
  }, [auth.authUserId]);

  useEffect(() => {
    setActiveTenantState(fallbackTenant);
    void refreshWorkspace().catch(() => undefined);
  }, [fallbackTenant, refreshWorkspace]);

  return <WorkspaceContext.Provider value={{
    tenants: activeTenant ? [activeTenant] : [],
    activeTenant,
    // Workspace switching is deliberately performed by /select-business or the
    // authenticated multi-membership selector; it is never local browser state.
    setActiveTenant: () => undefined,
    refreshWorkspace,
    loading,
  }}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
};
