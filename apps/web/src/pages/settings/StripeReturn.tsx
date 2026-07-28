import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router';
import { fetchWithAuth } from '../../api/client.js';

export function StripeReturn() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);

  const syncAndReturn = async () => {
    setError('');
    setRetrying(true);
    try {
      const response = await fetchWithAuth('/api/v1/integrations/stripe/sync', { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error?.message || 'Stripe status could not be refreshed.');
      }
      navigate('/app/settings/payments?stripe=returned', { replace: true });
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Stripe status could not be refreshed.');
      setRetrying(false);
    }
  };

  useEffect(() => {
    void syncAndReturn();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid min-h-[520px] place-items-center p-4 sm:p-6">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        {error ? (
          <>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-rose-50 text-rose-600"><AlertCircle className="h-8 w-8" /></div>
            <h1 className="mt-5 text-2xl font-black text-slate-950">We could not confirm the update</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Your Stripe details may still have been saved. Try checking the status again.</p>
            <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-left text-sm text-rose-800">{error}</div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={() => void syncAndReturn()} disabled={retrying} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 text-sm font-black text-white hover:bg-indigo-700 disabled:bg-slate-300">
                {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Check again
              </button>
              <button type="button" onClick={() => navigate('/app/settings/payments', { replace: true })} className="min-h-12 flex-1 rounded-2xl border border-slate-200 px-5 text-sm font-black text-slate-700 hover:bg-slate-50">Back to payments</button>
            </div>
          </>
        ) : (
          <>
            <div className="relative mx-auto h-20 w-20">
              <div className="absolute inset-0 animate-ping rounded-full bg-indigo-100" />
              <div className="relative grid h-20 w-20 place-items-center rounded-full bg-indigo-600 text-white"><CheckCircle2 className="h-9 w-9" /></div>
            </div>
            <h1 className="mt-6 text-2xl font-black text-slate-950">Checking your Stripe setup</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">We are confirming which payment and payout features Stripe has enabled.</p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Refreshing secure account status</div>
          </>
        )}
      </div>
    </div>
  );
}
