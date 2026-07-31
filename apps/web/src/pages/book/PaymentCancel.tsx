import React, { useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router';
import { AlertTriangle, RefreshCw } from 'lucide-react';
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
      setError('Missing booking reference.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const res = await fetch(
        `/api/v1/public/${encodeURIComponent(bookingIdentifier)}/bookings/${encodeURIComponent(reference)}/payment-session`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error?.message || 'A new payment session could not be created.');
      }

      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
      } else {
        setError('No checkout address was returned.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'An error occurred while retrying payment.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden p-8 text-center mt-10">
      <div className="py-10">
        <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
          <AlertTriangle className="w-10 h-10" />
        </div>
        <h3 className="text-2xl font-bold text-slate-800">Payment cancelled</h3>
        <p className="text-slate-500 mt-2">
          Your payment was not completed. Your booking is held but still requires payment before it can be confirmed.
        </p>

        {error && (
          <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm font-medium">
            {error}
          </div>
        )}

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={handleRetry}
            disabled={isLoading || !reference || !bookingIdentifier}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : null}
            Retry payment
          </button>

          <Link to={bookingPath} className="px-6 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition">
            Start a new booking
          </Link>
        </div>
      </div>
    </div>
  );
}
