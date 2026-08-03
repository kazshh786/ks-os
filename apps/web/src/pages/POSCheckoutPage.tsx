import React, { useEffect, useState } from 'react';
import { CalendarCheck, ShoppingBag } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useWorkspace } from '../context/WorkspaceContext.js';
import POSCheckout from '../components/POSCheckout.js';
import RetailPOSCheckout from '../components/RetailPOSCheckout.js';

type PosMode = 'retail' | 'appointment';

export const POSCheckoutPage: React.FC = () => {
  const { activeTenant } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const appointmentId = location.state?.booking?.id || searchParams.get('appointmentId');
  const [mode, setMode] = useState<PosMode>(appointmentId ? 'appointment' : 'retail');

  useEffect(() => {
    if (appointmentId) setMode('appointment');
  }, [appointmentId]);

  if (!activeTenant) return null;

  const preloadedBooking = appointmentId ? { id: appointmentId } : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Point of sale mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'retail'}
            onClick={() => setMode('retail')}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-black transition ${mode === 'retail' ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <ShoppingBag className="h-4 w-4" />
            Retail sale
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'appointment'}
            onClick={() => setMode('appointment')}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-black transition ${mode === 'appointment' ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <CalendarCheck className="h-4 w-4" />
            Appointment checkout
          </button>
        </div>
      </div>

      {mode === 'retail' ? (
        <RetailPOSCheckout
          tenant={activeTenant}
          onCheckoutCompleted={() => navigate('/app/inventory')}
        />
      ) : (
        <POSCheckout
          tenant={activeTenant}
          preloadedBooking={preloadedBooking}
          onCheckoutCompleted={() => navigate('/app/calendar')}
        />
      )}
    </div>
  );
};

export default POSCheckoutPage;
