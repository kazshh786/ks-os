import React, { createContext, useContext, useMemo } from 'react';
import type { BusinessTenant } from '../data/types';
import { useAuth } from '../auth/useAuth';

interface WorkspaceContextType {
  tenants: BusinessTenant[];
  activeTenant: BusinessTenant | null;
  setActiveTenant: (tenant: BusinessTenant) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const activeTenant = useMemo<BusinessTenant | null>(() => auth.authUserId ? {
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

  return <WorkspaceContext.Provider value={{
    tenants: activeTenant ? [activeTenant] : [],
    activeTenant,
    // Workspace switching is deliberately performed by /select-business or the
    // authenticated multi-membership selector; it is never local browser state.
    setActiveTenant: () => undefined,
  }}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
};
