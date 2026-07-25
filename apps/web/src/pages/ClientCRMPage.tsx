import React from 'react';
import { Routes, Route } from 'react-router';
import { useWorkspace } from '../context/WorkspaceContext.js';
import ClientCRM from '../components/ClientCRM.js';

export const ClientCRMPage: React.FC = () => {
  const { activeTenant } = useWorkspace();

  if (!activeTenant) return null;

  return (
    <Routes>
      <Route path="/" element={<ClientCRM tenant={activeTenant} />} />
      <Route path=":clientId" element={<ClientCRM tenant={activeTenant} />} />
    </Routes>
  );
};
export default ClientCRMPage;
