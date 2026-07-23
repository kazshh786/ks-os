import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import type { Permission } from '@ks-os/auth';

export const RoleRoute: React.FC<{ 
  allowedRoles?: ('owner' | 'staff')[];
  requiredPermission?: Permission;
  requiredPermissionsAny?: Permission[];
  children: React.ReactNode;
}> = ({ allowedRoles, requiredPermission, requiredPermissionsAny, children }) => {
  const { role, permissions, isLoading, authUserId } = useAuth();

  if (isLoading) {
    return null; // Let ProtectedRoute handle loading state if nested
  }

  if (!authUserId) {
    return <Navigate to="/login" replace />;
  }

  // Phase 2 constraint: only owner and staff are mapped
  if (allowedRoles && !allowedRoles.includes(role as any)) {
    return <Navigate to="/access-denied?context=tenant" replace />;
  }

  if (role !== 'owner' && requiredPermission && !permissions.includes(requiredPermission)) {
    return <Navigate to="/access-denied?context=tenant" replace />;
  }

  if (role !== 'owner' && requiredPermissionsAny?.length && !requiredPermissionsAny.some(permission => permissions.includes(permission))) {
    return <Navigate to="/access-denied?context=tenant" replace />;
  }

  return <>{children}</>;
};
