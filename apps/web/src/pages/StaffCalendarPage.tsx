import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext.js';
import StaffCalendar from '../components/StaffCalendar.js';

export const StaffCalendarPage: React.FC = () => {
  const { activeTenant } = useWorkspace();
  const navigate = useNavigate();

  if (!activeTenant) return null;

  return (
    <StaffCalendar
      tenant={activeTenant}
      onLaunchManualBooking={() => navigate('/app/reception')}
      onLaunchCheckout={(booking) => navigate('/app/pos', { state: { booking } })}
    />
  );
};
export default StaffCalendarPage;
