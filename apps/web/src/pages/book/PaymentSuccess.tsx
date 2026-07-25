import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { getDataProvider } from '../../data/data-provider';

export default function PaymentSuccess() {
  const { subdomain } = useParams();
  const [searchParams] = useSearchParams();
  const reference = searchParams.get('reference');

  const [status, setStatus] = useState<'LOADING' | 'SUCCESS' | 'FAILED'>('LOADING');

  useEffect(() => {
    if (!subdomain || !reference) {
      setStatus('FAILED');
      return;
    }

    let active = true;
    const checkStatus = async () => {
      try {
        const provider = getDataProvider();
        const data = await provider.getPublicBookingStatus(subdomain, reference);
        if (!active) return;

        // Backend might return the status at root or inside a booking object
        const paymentStatus = data.paymentStatus || data.booking?.paymentStatus;

        if (paymentStatus === 'PAID' || paymentStatus === 'SUCCEEDED') {
          setStatus('SUCCESS');
        } else if (paymentStatus === 'PROCESSING') {
          // Poll again after 2 seconds
          setTimeout(checkStatus, 2000);
        } else {
          setStatus('FAILED');
        }
      } catch (err) {
        if (active) setStatus('FAILED');
      }
    };

    checkStatus();

    return () => {
      active = false;
    };
  }, [subdomain, reference]);

  return (
    <div className="w-full max-w-3xl mx-auto bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden p-8 text-center mt-10">
      {status === 'LOADING' && (
        <div className="py-10">
          <Loader2 className="w-16 h-16 animate-spin text-indigo-500 mx-auto mb-6" />
          <h3 className="text-2xl font-bold text-slate-800">Verifying Payment...</h3>
          <p className="text-slate-500 mt-2">Please wait while we confirm your transaction.</p>
        </div>
      )}

      {status === 'SUCCESS' && (
        <div className="py-10">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner animate-bounce">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h3 className="text-2xl font-bold text-slate-800">Payment Successful!</h3>
          <p className="text-slate-500 mt-2">
            Your booking is confirmed. Reference: <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-1 rounded">{reference}</span>
          </p>
          <Link to={`/book/${subdomain}`} className="mt-8 inline-block px-6 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition">
            Book Another Appointment
          </Link>
        </div>
      )}

      {status === 'FAILED' && (
        <div className="py-10">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
            <AlertTriangle className="w-10 h-10" />
          </div>
          <h3 className="text-2xl font-bold text-slate-800">Payment Unsuccessful</h3>
          <p className="text-slate-500 mt-2">We could not verify your payment. Please contact the salon or try again.</p>
          <Link to={`/book/${subdomain}`} className="mt-8 inline-block px-6 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition">
            Return to Booking
          </Link>
        </div>
      )}
    </div>
  );
}
