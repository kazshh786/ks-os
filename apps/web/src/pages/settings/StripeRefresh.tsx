import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router';
import { fetchWithAuth } from '../../api/client.js';

export function StripeRefresh() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);

  const refreshLink = async () => {
    setError('');
    setRetrying(true);
    try {
      const response = await fetchWithAuth('/api/v1/integrations/stripe/onboarding-link', { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error?.message || 'A new Stripe setup link could not be created.');
      }
      if (!body?.url) throw new Error('Stripe did not return a secure setup link.');
      window.location.assign(body.url);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'A new Stripe setup link could not be created.');
      setRetrying(false);
    }
  };

  useEffect(() => {
    void refreshLink();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid min-h-[520px] place-items-center p-4 sm:p-6">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        {error ? (
          <>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-rose-50 text-rose-600"><AlertCircle className="h-8 w-8" /></div>
            <h1 className="mt-5 text-2xl font-black text-slate-950">The Stripe link expired</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Generate a fresh secure link to continue from where you stopped.</p>
            <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-left text-sm text-rose-800">{error}</div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={() => void refreshLink()} disabled={retrying} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 text-sm font-black text-white hover:bg-indigo-700 disabled:bg-slate-300">
                {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Generate new link
              </button>
              <button type="button" onClick={() => navigate('/app/settings/payments', { replace: true })} className="min-h-12 flex-1 rounded-2xl border border-slate-200 px-5 text-sm font-black text-slate-700 hover:bg-slate-50">Back to payments</button>
            </div>
          </>
        ) : (
          <>
            <div className="relative mx-auto h-20 w-20">
              <div className="absolute inset-0 animate-ping rounded-full bg-indigo-100" />
              <div className="relative grid h-20 w-20 place-items-center rounded-full bg-indigo-600 text-white"><RefreshCw className="h-8 w-8 animate-spin" /></div>
            </div>
            <h1 className="mt-6 text-2xl font-black text-slate-950">Creating a fresh Stripe link</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">You will return to Stripe’s secure setup and continue with the same connected account.</p>
          </>
        )}
      </div>
    </div>
  );
}
