import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { Permission, hasPermission } from '@ks-os/auth';

export const RoleRoute: React.FC<{ 
  allowedRoles?: ('owner' | 'staff')[];
  requiredPermission?: Permission;
  children: React.ReactNode;
}> = ({ allowedRoles, requiredPermission, children }) => {
  const { role, permissions, isLoading, authUserId } = useAuth();

  if (isLoading) {
    return null; // Let ProtectedRoute handle loading state if nested
  }

  if (!authUserId) {
    return <Navigate to="/login" replace />;
  }

  // Phase 2 constraint: only owner and staff are mapped
  if (allowedRoles && !allowedRoles.includes(role as any)) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (requiredPermission && !permissions.includes(requiredPermission)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
};
