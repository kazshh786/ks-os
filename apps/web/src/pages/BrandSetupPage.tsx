import React from 'react';
import { useWorkspace } from '../context/WorkspaceContext.js';
import SettingsManager from '../components/SettingsManager.js';

export const BrandSetupPage: React.FC = () => {
  const { activeTenant, setActiveTenant } = useWorkspace();

  if (!activeTenant) return null;

  return (
    <SettingsManager
      tenant={activeTenant}
      onSettingsUpdated={() => {
        // Option to reload details if needed
      }}
    />
  );
};
export default BrandSetupPage;
