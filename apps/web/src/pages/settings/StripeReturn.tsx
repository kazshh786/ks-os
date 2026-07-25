import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { getDataProvider } from '../../data/data-provider.js';

export function StripeReturn() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const syncAndRedirect = async () => {
      try {
        const provider = getDataProvider();
        await provider.syncStripe();
        if (mounted) {
          navigate('/app/settings/payments', { replace: true });
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || 'Failed to sync Stripe status');
        }
      }
    };

    syncAndRedirect();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center">
      {error ? (
        <div className="max-w-md w-full">
          <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6">
            {error}
          </div>
          <button
            onClick={() => navigate('/app/settings/payments')}
            className="bg-gray-200 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-300"
          >
            Return to Payments Settings
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <h2 className="text-xl font-semibold mb-2">Verifying your Stripe account...</h2>
          <p className="text-gray-500">Please wait while we sync your connection status.</p>
        </div>
      )}
    </div>
  );
}
