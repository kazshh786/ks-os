import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CreditCard, LockKeyhole, RefreshCw } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { currentPublicBookingIdentifier } from '../../lib/workspace-hostname.js';

export default function PaymentCancel() {
  const { subdomain } = useParams();
  const [searchParams] = useSearchParams();
  const reference = searchParams.get('reference');
  const bookingIdentifier = subdomain || currentPublicBookingIdentifier();
  const bookingPath = useMemo(() => subdomain ? `/book/${subdomain}` : '/book', [subdomain]);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRetry = async () => {
    if (!bookingIdentifier || !reference) {
      setError('The booking reference is missing. Return to the booking page and contact the business if you need help.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(
        `/api/v1/public/${encodeURIComponent(bookingIdentifier)}/bookings/${encodeURIComponent(reference)}/payment-session`,
        { method: 'POST' },
      );
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.error?.message || 'A new secure payment session could not be created.');
      }

      if (typeof body.checkoutUrl !== 'string' || !body.checkoutUrl) {
        throw new Error('The payment provider did not return a secure checkout address.');
      }

      window.location.assign(body.checkoutUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment could not be restarted. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="mx-auto mt-6 w-full max-w-3xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl shadow-slate-300/40" aria-live="polite">
      <div className="px-6 py-10 text-center sm:px-10">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-amber-50 text-amber-600 shadow-inner">
          <AlertTriangle className="h-9 w-9" aria-hidden="true" />
        </div>
        <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-amber-700">Payment not completed</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Your appointment still needs payment</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
          No successful payment was recorded. Use the same booking reference to reopen secure checkout without creating a duplicate appointment.
        </p>

        {reference ? (
          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">Booking reference</p>
            <p className="mt-1 break-all font-mono text-base font-black text-slate-950">{reference}</p>
          </div>
        ) : null}

        <div className="mx-auto mt-5 flex max-w-xl gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-slate-700" aria-hidden="true" />
          <div>
            <p className="text-sm font-black text-slate-950">Safe payment retry</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Retrying creates a fresh payment session for this booking. It does not submit the booking form again or intentionally create another charge.
            </p>
          </div>
        </div>

        {error ? (
          <div role="alert" className="mx-auto mt-5 max-w-xl rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
            {error}
          </div>
        ) : null}

        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void handleRetry()}
            disabled={isLoading || !reference || !bookingIdentifier}
            aria-busy={isLoading}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-6 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CreditCard className="h-4 w-4" aria-hidden="true" />}
            {isLoading ? 'Opening secure payment…' : 'Retry secure payment'}
          </button>

          <Link
            to={bookingPath}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 text-sm font-black text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Return to booking page
          </Link>
        </div>
      </div>
    </main>
  );
}
