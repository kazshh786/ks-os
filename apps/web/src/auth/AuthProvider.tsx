import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Permission } from '@ks-os/auth';
import { AuthContext, type AuthContextType } from './useAuth';
import { fetchWithAuth } from '../api/client';
import { supabase } from '../lib/supabase';

type State = Omit<AuthContextType, 'signOut' | 'signOutAll' | 'selectWorkspace' | 'reload' | 'isLoading'>;

const ignoresTenantContext = (pathname: string) => pathname.startsWith('/agency') || pathname.startsWith('/customer');

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authState, setAuthState] = useState<State | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedRef = useRef(false);

  const reload = useCallback(async () => {
    const isInitialLoad = !hasLoadedRef.current;
    if (ignoresTenantContext(window.location.pathname)) {
      setAuthState(null);
      hasLoadedRef.current = true;
      setIsLoading(false);
      return;
    }
    if (isInitialLoad) setIsLoading(true);
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session) {
        if (isInitialLoad) setAuthState(null);
        return;
      }
      const response = await fetchWithAuth('/api/v1/workspace/session', { authContext: 'TENANT' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.data) {
        // Do not throw away a working browser session because a background
        // workspace check raced token rotation or the API briefly returned 401.
        if (isInitialLoad) setAuthState(null);
        return;
      }
      const workspace = body.data;
      const business = workspace.business;
      setAuthState({
        authUserId: business ? workspace.memberships.find((item: any) => item.selected)?.membershipReference || '' : '',
        email: workspace.user.email,
        membershipReference: workspace.memberships.find((item: any) => item.selected)?.membershipReference || '',
        businessReference: business?.businessReference || '',
        tenantId: business?.businessReference || '',
        tenantName: business?.name || '',
        tenantSubdomain: business?.slug || '',
        role: workspace.user.role || 'staff',
        permissions: Object.keys(workspace.user.permissions || {}).filter(key => workspace.user.permissions[key]) as Permission[],
        workspaceSelectionRequired: workspace.selectionRequired,
        memberships: workspace.memberships,
      });
    } catch {
      if (isInitialLoad) setAuthState(null);
    } finally {
      hasLoadedRef.current = true;
      if (isInitialLoad) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void reload();
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT') { setAuthState(null); setIsLoading(false); }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') void reload();
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, [reload]);

  const selectWorkspace = async (businessReference: string) => {
    const response = await fetchWithAuth('/api/v1/auth/select-workspace', {
      method: 'POST', authContext: 'TENANT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessReference }),
    });
    if (!response.ok) throw new Error('That business is no longer available.');
    await reload();
  };

  const signOut = async () => {
    await fetchWithAuth('/api/v1/auth/logout', { method: 'POST', authContext: 'TENANT' }).catch(() => undefined);
    await supabase.auth.signOut({ scope: 'local' });
    setAuthState(null);
  };
  const signOutAll = async () => {
    await fetchWithAuth('/api/v1/auth/logout-all', { method: 'POST', authContext: 'TENANT' }).catch(() => undefined);
    await supabase.auth.signOut({ scope: 'global' });
    setAuthState(null);
  };

  const value = {
    ...(authState || {
      authUserId: '', email: null, tenantId: '', tenantName: '', tenantSubdomain: '', role: 'staff' as const,
      permissions: [], membershipReference: '', businessReference: '', workspaceSelectionRequired: false, memberships: [],
    }),
    reload, selectWorkspace, signOut, signOutAll, isLoading,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
