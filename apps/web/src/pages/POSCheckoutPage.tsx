import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext.js';
import POSCheckout from '../components/POSCheckout.js';

export const POSCheckoutPage: React.FC = () => {
  const { activeTenant } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();

  if (!activeTenant) return null;

  const preloadedBooking = location.state?.booking || null;

  return (
    <POSCheckout
      tenant={activeTenant}
      preloadedBooking={preloadedBooking}
      onCheckoutCompleted={() => navigate('/app/calendar')}
    />
  );
};
export default POSCheckoutPage;
