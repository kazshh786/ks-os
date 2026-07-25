import React from 'react';
import { useNavigate } from 'react-router';
import { useWorkspace } from '../context/WorkspaceContext.js';
import ReceptionDesk from '../components/ReceptionDesk.js';

export const ReceptionPage: React.FC = () => {
  const { activeTenant } = useWorkspace();
  const navigate = useNavigate();

  if (!activeTenant) return null;

  return (
    <ReceptionDesk
      tenant={activeTenant}
      onBookingCompleted={() => navigate('/app/calendar')}
    />
  );
};
export default ReceptionPage;
