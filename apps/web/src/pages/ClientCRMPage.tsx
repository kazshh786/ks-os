import React from 'react';
import { RoleRoute } from '../auth';
import { Customer360Page } from '../features/customer-360/Customer360Page.js';
import { Routes, Route } from 'react-router';
import { useWorkspace } from '../context/WorkspaceContext.js';
import ClientCRM from '../components/ClientCRM.js';

export const ClientCRMPage: React.FC = () => {
  const { activeTenant } = useWorkspace();

  if (!activeTenant) return null;

  return (
    <Routes>
      <Route path="/" element={<ClientCRM tenant={activeTenant} />} />
      <Route path=":reference" element={<Customer360Page key={activeTenant.id} />} />
      <Route path=":clientId/details" element={<RoleRoute allowedRoles={['owner']}><ClientCRM tenant={activeTenant} /></RoleRoute>} />
    </Routes>
  );
};
export default ClientCRMPage;
