import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { currentPublicBookingIdentifier } from '../../lib/workspace-hostname.js';

const SUCCESSFUL_PAYMENT_STATES = new Set(['SUCCEEDED', 'COMPLETED', 'PAID']);
const PENDING_PAYMENT_STATES = new Set(['OPEN', 'PENDING', 'PROCESSING', 'REQUIRES_ACTION']);

export default function PaymentSuccess() {
  const { subdomain } = useParams();
  const [searchParams] = useSearchParams();
  const reference = searchParams.get('reference');
  const bookingIdentifier = subdomain || currentPublicBookingIdentifier();
  const bookingPath = useMemo(() => subdomain ? `/book/${subdomain}` : '/book', [subdomain]);

  const [status, setStatus] = useState<'LOADING' | 'SUCCESS' | 'FAILED'>('LOADING');

  useEffect(() => {
    if (!bookingIdentifier || !reference) {
      setStatus('FAILED');
      return;
    }

    let active = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const checkStatus = async () => {
      attempts += 1;
      try {
        const response = await fetch(
          `/api/v1/public/${encodeURIComponent(bookingIdentifier)}/bookings/${encodeURIComponent(reference)}/payment-status`,
        );
        const body = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) {
          if (attempts < 20 && response.status === 404) {
            timer = setTimeout(checkStatus, 2_000);
            return;
          }
          setStatus('FAILED');
          return;
        }

        const paymentStatus = String(body.paymentStatus || '').toUpperCase();
        if (SUCCESSFUL_PAYMENT_STATES.has(paymentStatus)) {
          setStatus('SUCCESS');
        } else if (PENDING_PAYMENT_STATES.has(paymentStatus) && attempts < 20) {
          timer = setTimeout(checkStatus, 2_000);
        } else {
          setStatus('FAILED');
        }
      } catch {
        if (!active) return;
        if (attempts < 20) timer = setTimeout(checkStatus, 2_000);
        else setStatus('FAILED');
      }
    };

    void checkStatus();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [bookingIdentifier, reference]);

  return (
    <div className="w-full max-w-3xl mx-auto bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden p-8 text-center mt-10">
      {status === 'LOADING' && (
        <div className="py-10">
          <Loader2 className="w-16 h-16 animate-spin text-indigo-500 mx-auto mb-6" />
          <h3 className="text-2xl font-bold text-slate-800">Verifying payment...</h3>
          <p className="text-slate-500 mt-2">Please wait while we confirm your transaction.</p>
        </div>
      )}

      {status === 'SUCCESS' && (
        <div className="py-10">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner animate-bounce">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h3 className="text-2xl font-bold text-slate-800">Payment successful</h3>
          <p className="text-slate-500 mt-2">
            Your booking is confirmed. Reference: <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-1 rounded">{reference}</span>
          </p>
          <Link to={bookingPath} className="mt-8 inline-block px-6 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition">
            Book another appointment
          </Link>
        </div>
      )}

      {status === 'FAILED' && (
        <div className="py-10">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
            <AlertTriangle className="w-10 h-10" />
          </div>
          <h3 className="text-2xl font-bold text-slate-800">Payment could not be confirmed</h3>
          <p className="text-slate-500 mt-2">Your booking reference is still valid. Return to the booking page or contact the business for help.</p>
          <Link to={bookingPath} className="mt-8 inline-block px-6 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition">
            Return to booking
          </Link>
        </div>
      )}
    </div>
  );
}
