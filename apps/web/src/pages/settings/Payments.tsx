import { useState, useEffect } from 'react';
import { getDataProvider } from '../../data/data-provider.js';
import { useAuth } from '../../auth/useAuth.js';

export function Payments() {
  const { role } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [stripeData, setStripeData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    if (role === 'staff') {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const provider = getDataProvider();
      const res = await provider.getStripeConnection();
      setStripeData(res);
      setStatus(res?.status || 'NOT_CONNECTED');
    } catch (err: any) {
      if (err.message === 'Failed to get Stripe connection') {
        setStatus('NOT_CONNECTED');
      } else {
        setError(err.message || 'Failed to load Stripe status');
        setStatus('ERROR');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [role]);

  const handleConnect = async () => {
    try {
      setActionLoading(true);
      setError(null);
      const provider = getDataProvider();
      const res = await provider.connectStripe();
      if (res?.url) {
        window.location.href = res.url;
      } else if (res?.accountLink?.url) {
        window.location.href = res.accountLink.url;
      } else {
        throw new Error('No redirect URL received');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect Stripe');
      setActionLoading(false);
    }
  };

  const handleResumeOnboarding = async () => {
    try {
      setActionLoading(true);
      setError(null);
      const provider = getDataProvider();
      const res = await provider.generateOnboardingLink();
      if (res?.url) {
        window.location.href = res.url;
      } else if (res?.accountLink?.url) {
        window.location.href = res.accountLink.url;
      } else {
        throw new Error('No redirect URL received');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to resume onboarding');
      setActionLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      setActionLoading(true);
      setError(null);
      const provider = getDataProvider();
      const res = await provider.syncStripe();
      setStripeData(res);
      setStatus(res?.status || 'NOT_CONNECTED');
    } catch (err: any) {
      setError(err.message || 'Failed to sync Stripe');
    } finally {
      setActionLoading(false);
    }
  };

  if (role === 'staff') {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-4">Payment Settings</h2>
        <div className="bg-red-50 text-red-600 p-4 rounded-md">
          You do not have permission to view payment settings. Only account owners can access this page.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-4">Payments</h2>
        <div className="text-gray-500">Loading Stripe status...</div>
      </div>
    );
  }

  const formatRequirement = (req: string) => req.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const maskAccountId = (id?: string) => {
    if (!id) return '';
    if (id.length < 10) return id;
    return `${id.slice(0, 5)}...${id.slice(-4)}`;
  };

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-bold mb-6">Payment Settings</h2>
      
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow border p-6">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Stripe Integration</h3>
            <p className="text-sm text-gray-500 mt-1">
              Connect your Stripe account to accept online payments and deposits for bookings.
            </p>
          </div>
          <div className="flex items-center">
            {status === 'READY' && (
              <span className="px-3 py-1 bg-green-100 text-green-800 text-sm font-medium rounded-full">
                Connected
              </span>
            )}
            {(status === 'ONBOARDING' || status === 'ACTION_REQUIRED') && (
              <span className="px-3 py-1 bg-yellow-100 text-yellow-800 text-sm font-medium rounded-full">
                Action Required
              </span>
            )}
            {status === 'PENDING_VERIFICATION' && (
              <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                Pending Verification
              </span>
            )}
            {status === 'RESTRICTED' && (
              <span className="px-3 py-1 bg-red-100 text-red-800 text-sm font-medium rounded-full">
                Restricted
              </span>
            )}
            {(status === 'NOT_CONNECTED' || status === 'ERROR' || !status) && (
              <span className="px-3 py-1 bg-gray-100 text-gray-800 text-sm font-medium rounded-full">
                Not Connected
              </span>
            )}
          </div>
        </div>

        <div className="border-t pt-6">
          <div className="mb-6 p-4 rounded-lg border bg-slate-50 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">Online Booking Payments</span>
              <span className={`px-2 py-1 rounded text-xs font-bold ${status === 'READY' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                {status === 'READY' ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Note: KS OS Application Fees are managed securely in the backend environment.
            </p>
          </div>

          {status === 'READY' && (
            <div>
              <p className="text-gray-700 mb-4">
                Your Stripe account is successfully connected. Payments and payouts are enabled.
              </p>
              {stripeData?.stripeAccountId && (
                <p className="text-sm text-gray-600 mb-4 font-mono">
                  Account ID: {maskAccountId(stripeData.stripeAccountId)}
                </p>
              )}
              <a
                href={stripeData?.stripeAccountId ? `https://dashboard.stripe.com/${stripeData.stripeAccountId}` : 'https://dashboard.stripe.com/'}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:text-blue-800 font-medium text-sm inline-flex items-center"
              >
                Open Stripe Dashboard &rarr;
              </a>
            </div>
          )}

          {status === 'ONBOARDING' && (
            <div>
              <p className="text-gray-700 mb-4">
                You have started connecting to Stripe but further action is required to complete your onboarding.
              </p>
              {stripeData?.lastSyncedAt && (
                <p className="text-sm text-gray-500 mb-4">
                  Last synced: {new Date(stripeData.lastSyncedAt).toLocaleString()}
                </p>
              )}
              <button
                onClick={handleResumeOnboarding}
                disabled={actionLoading}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {actionLoading ? 'Redirecting...' : 'Resume Setup'}
              </button>
            </div>
          )}

          {status === 'ACTION_REQUIRED' && (
            <div>
              <p className="text-gray-700 mb-4">
                Stripe requires additional information to keep your account active.
              </p>
              {stripeData?.currentlyDue && stripeData.currentlyDue.length > 0 && (
                <div className="mb-4 bg-gray-50 p-4 rounded-md border border-gray-200">
                  <p className="font-medium text-sm text-gray-800 mb-2">Outstanding Requirements:</p>
                  <ul className="list-disc pl-5 text-sm text-gray-600">
                    {stripeData.currentlyDue.map((req: string) => (
                      <li key={req}>{formatRequirement(req)}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                onClick={handleResumeOnboarding}
                disabled={actionLoading}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {actionLoading ? 'Redirecting...' : 'Resume Setup'}
              </button>
            </div>
          )}

          {status === 'PENDING_VERIFICATION' && (
            <div>
              <p className="text-gray-700 mb-4">
                Stripe review in progress. Please note that the review process depends entirely on Stripe and may take some time.
              </p>
              <button
                onClick={handleSync}
                disabled={actionLoading}
                className="bg-gray-100 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-200 border border-gray-300 disabled:opacity-50"
              >
                {actionLoading ? 'Refreshing...' : 'Refresh Status'}
              </button>
            </div>
          )}

          {status === 'RESTRICTED' && (
            <div>
              <p className="text-red-700 font-medium mb-2">Account Restricted</p>
              <p className="text-gray-700 mb-4">
                Your Stripe account has been restricted. 
                {stripeData?.disabledReason && (
                  <span className="block mt-2 font-medium text-red-600">
                    Reason: {formatRequirement(stripeData.disabledReason)}
                  </span>
                )}
              </p>
              <div className="bg-gray-50 p-4 rounded-md text-sm text-gray-700 border mb-4">
                Please contact our support team or check your Stripe dashboard to resolve this issue.
              </div>
              <a
                href="https://dashboard.stripe.com/"
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:text-blue-800 font-medium text-sm inline-flex items-center"
              >
                Open Stripe Dashboard &rarr;
              </a>
            </div>
          )}

          {(status === 'NOT_CONNECTED' || status === 'ERROR' || (!status && !loading)) && (
            <div>
              <p className="text-gray-700 mb-4">
                You need to connect a Stripe account to enable payments.
              </p>
              <div className="bg-gray-50 border border-gray-200 p-4 rounded-md text-sm text-gray-600 mb-6">
                <p className="font-medium text-gray-800 mb-1 flex items-center">
                  <svg className="w-4 h-4 mr-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Security Note
                </p>
                <p>KS OS never receives your Stripe password. Stripe securely collects your business and bank details.</p>
              </div>
              <button
                onClick={handleConnect}
                disabled={actionLoading}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {actionLoading ? 'Connecting...' : 'Connect with Stripe'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
