import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
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
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!bookingIdentifier || !reference) {
      setStatus('FAILED');
      return;
    }

    let active = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setStatus('LOADING');

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
  }, [bookingIdentifier, reference, retryKey]);

  return (
    <main className="mx-auto mt-4 w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-300/40 sm:mt-6 sm:rounded-[2rem]" aria-live="polite" aria-busy={status === 'LOADING'}>
      {status === 'LOADING' ? (
        <div className="px-6 py-14 text-center sm:px-10">
          <Loader2 className="mx-auto h-14 w-14 animate-spin text-slate-700" aria-hidden="true" />
          <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-slate-500">Secure verification</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Confirming your payment</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
            The payment provider and booking system are being reconciled. Keep this page open until the confirmation appears.
          </p>
          {reference ? <p className="mt-5 text-xs font-bold text-slate-500">Booking reference: <span className="font-mono text-slate-800">{reference}</span></p> : null}
        </div>
      ) : null}

      {status === 'SUCCESS' ? (
        <div className="px-6 py-12 text-center sm:px-10">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-50 text-emerald-600 shadow-inner">
            <CheckCircle2 className="h-11 w-11" aria-hidden="true" />
          </div>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Payment received</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Your booking is confirmed</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
            Payment has been verified and the appointment is secured. Keep the reference below for any future changes.
          </p>
          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">Booking reference</p>
            <p className="mt-1 break-all font-mono text-base font-black text-slate-950">{reference}</p>
          </div>
          <div className="mx-auto mt-5 flex max-w-xl gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left text-emerald-950">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p className="text-xs leading-5">A confirmation and secure booking-management link will be sent using the contact details supplied during booking.</p>
          </div>
          <Link to={bookingPath} className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-slate-950 px-6 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 sm:w-auto">
            Book another appointment
          </Link>
        </div>
      ) : null}

      {status === 'FAILED' ? (
        <div className="px-6 py-12 text-center sm:px-10">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-rose-50 text-rose-600 shadow-inner">
            <AlertTriangle className="h-11 w-11" aria-hidden="true" />
          </div>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-rose-700">Verification delayed</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Payment could not be confirmed yet</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
            Keep your booking reference. Do not submit a second booking solely because verification is delayed; check the payment status again first.
          </p>
          {reference ? (
            <div className="mx-auto mt-6 max-w-md rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">Booking reference</p>
              <p className="mt-1 break-all font-mono text-base font-black text-slate-950">{reference}</p>
            </div>
          ) : null}
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => setRetryKey(value => value + 1)}
              disabled={!bookingIdentifier || !reference}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-6 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Check payment again
            </button>
            <Link to={bookingPath} className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 text-sm font-black text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2">
              Return to booking page
            </Link>
          </div>
        </div>
      ) : null}
    </main>
  );
}
