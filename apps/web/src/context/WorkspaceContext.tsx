import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Booking, BusinessTenant } from '../data/types.js';
import { getDataProvider } from '../data/data-provider.js';
import { useAuth } from '../auth/index.js';

interface WorkspaceContextType {
  tenants: BusinessTenant[];
  activeTenant: BusinessTenant | null;
  setActiveTenant: (tenant: BusinessTenant) => void;
  bookings: Booking[];
  loadBookings: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const activeTenant = useMemo<BusinessTenant | null>(() => auth.authUserId ? {
    id: auth.businessReference, name: auth.tenantName, subdomain: auth.tenantSubdomain,
    primaryColor: '#0f172a', secondaryColor: '#475569', timezone: 'Europe/London', currency: 'GBP',
    plan: 'Starter', paymentPolicy: 'CustomerChoice', depositPercentage: 0,
  } : null, [auth.authUserId, auth.businessReference, auth.tenantName, auth.tenantSubdomain]);

  const loadBookings = useCallback(() => {
    if (!auth.authUserId || window.location.pathname.startsWith('/agency') || window.location.pathname.startsWith('/customer')) return;
    void getDataProvider().getBookings().then(setBookings).catch(() => setBookings([]));
  }, [auth.authUserId]);

  useEffect(() => {
    loadBookings();
    window.addEventListener('ks-bookings-updated', loadBookings);
    window.addEventListener('ks-events-updated', loadBookings);
    return () => {
      window.removeEventListener('ks-bookings-updated', loadBookings);
      window.removeEventListener('ks-events-updated', loadBookings);
    };
  }, [loadBookings]);

  return <WorkspaceContext.Provider value={{
    tenants: activeTenant ? [activeTenant] : [], activeTenant,
    // Workspace switching is deliberately performed by /select-business and
    // persisted by the server; components cannot switch it with local state.
    setActiveTenant: () => undefined, bookings, loadBookings,
  }}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
};
