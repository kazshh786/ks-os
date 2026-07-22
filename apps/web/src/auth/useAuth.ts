import { createContext, useContext } from 'react';
import { Permission } from '@ks-os/auth';

export interface AuthContextType {
  authUserId: string;
  email: string | null;
  tenantId: string;
  tenantName: string;
  tenantSubdomain: string;
  role: 'owner' | 'staff';
  permissions: Permission[];
  membershipReference: string;
  businessReference: string;
  workspaceSelectionRequired: boolean;
  memberships: Array<{ membershipReference: string; businessReference: string; businessName: string; businessSlug: string; role: 'owner' | 'staff'; selected: boolean }>;
  reload: () => Promise<void>;
  selectWorkspace: (businessReference: string) => Promise<void>;
  signOut: () => Promise<void>;
  signOutAll: () => Promise<void>;
  isLoading: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
