import React from 'react';
import { useWorkspace } from '../context/WorkspaceContext.js';
import BusinessProfileSettings from '../features/settings/BusinessProfileSettings.js';

export const BrandSetupPage: React.FC = () => {
  const { activeTenant, refreshWorkspace, loading } = useWorkspace();

  if (loading && !activeTenant) {
    return <div className="mx-auto max-w-4xl p-8 text-sm text-slate-500" aria-live="polite">Loading business information…</div>;
  }
  if (!activeTenant) return null;

  return <BusinessProfileSettings tenant={activeTenant} onSaved={refreshWorkspace} />;
};

export default BrandSetupPage;
