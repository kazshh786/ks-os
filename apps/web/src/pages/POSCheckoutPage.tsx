import React from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext.js';
import POSCheckout from '../components/POSCheckout.js';

export const POSCheckoutPage: React.FC = () => {
  const { activeTenant } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  if (!activeTenant) return null;

  const appointmentId = location.state?.booking?.id || searchParams.get('appointmentId');
  const preloadedBooking = appointmentId ? { id: appointmentId } : null;

  return (
    <POSCheckout
      tenant={activeTenant}
      preloadedBooking={preloadedBooking}
      onCheckoutCompleted={() => navigate('/app/calendar')}
    />
  );
};
export default POSCheckoutPage;
