import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';

export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, devModeActive } = useAuth();
  const location = useLocation();

  // If dev auth helper is enabled and no user is authenticated, redirect to /login
  if (!user && devModeActive) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export const RequireAgency: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, devModeActive } = useAuth();
  const location = useLocation();

  if (devModeActive) {
    if (!user) {
      return <Navigate to="/login" state={{ from: location }} replace />;
    }
    if (user.role !== 'agency_admin') {
      return <Navigate to="/app/calendar" replace />;
    }
  }

  return <>{children}</>;
};
