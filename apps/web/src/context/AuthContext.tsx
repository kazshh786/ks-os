import React, { createContext, useContext, useState, useEffect } from 'react';
import { TenantRole } from '@ks-os/contracts';

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: TenantRole;
}

interface AuthContextType {
  user: AuthUser | null;
  login: (role: TenantRole) => void;
  logout: () => void;
  devModeActive: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);

  // Check environment variables at application boundary.
  // Must be false in production mode.
  const isProduction = import.meta.env.PROD;
  const devAuthEnabledEnv = import.meta.env.VITE_DEV_AUTH_ENABLED === 'true';
  const devModeActive = !isProduction && devAuthEnabledEnv;

  // We do NOT use localStorage as proof of authenticated identity in production.
  // For development devMode, we can track in-memory state.
  const login = (role: TenantRole) => {
    if (!devModeActive) {
      console.warn('Development login adapter is disabled in production builds.');
      return;
    }

    // Role mapping dynamically based on login select (no hardcoded password or credentials)
    setUser({
      id: `dev-user-${role}`,
      name: `Developer (${role})`,
      email: `${role}@development-only.ks-os.internal`,
      role
    });
  };

  const logout = () => {
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, devModeActive }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
