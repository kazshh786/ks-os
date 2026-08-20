import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { currentPublicBookingIdentifier } from '../../lib/workspace-hostname.js';

const SUCCESSFUL_PAYMENT_STATES = new Set(['SUCCEEDED', 'COMPLETED', 'PAID']);
const FAILED_PAYMENT_STATES = new Set(['FAILED', 'CANCELLED', 'EXPIRED']);
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 60;

type PaymentConfirmationState = 'LOADING' | 'SUCCESS' | 'DELAYED' | 'FAILED';

export default function PaymentSuccess() {
  const { subdomain } = useParams();
  const [searchParams] = useSearchParams();
  const reference = searchParams.get('reference');
  const bookingIdentifier = subdomain || currentPublicBookingIdentifier();
  const bookingPath = useMemo(() => subdomain ? `/book/${subdomain}` : '/book', [subdomain]);

  const [status, setStatus] = useState<PaymentConfirmationState>('LOADING');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!bookingIdentifier || !reference) {
      setStatus('DELAYED');
      return;
    }

    let active = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setStatus('LOADING');

    const waitForAnotherCheck = (checkStatus: () => Promise<void>) => {
      if (attempts < MAX_POLL_ATTEMPTS) {
        timer = setTimeout(checkStatus, POLL_INTERVAL_MS);
        return;
      }

      // The first check runs immediately. Holding the loading state for one
      // final polling interval means customers receive the full two-minute
      // verification window before we present the neutral delayed state.
      timer = setTimeout(() => {
        if (active) setStatus('DELAYED');
      }, POLL_INTERVAL_MS);
    };

    const checkStatus = async () => {
      attempts += 1;
      try {
        const response = await fetch(
          `/api/v1/public/${encodeURIComponent(bookingIdentifier)}/bookings/${encodeURIComponent(reference)}/payment-status`,
        );
        const body = await response.json().catch(() => ({}));
        if (!active) return;

        if (!response.ok) {
          waitForAnotherCheck(checkStatus);
          return;
        }

        const paymentStatus = String(body.paymentStatus || '').toUpperCase();
        if (SUCCESSFUL_PAYMENT_STATES.has(paymentStatus)) {
          setStatus('SUCCESS');
          return;
        }

        if (FAILED_PAYMENT_STATES.has(paymentStatus)) {
          setStatus('FAILED');
          return;
        }

        // OPEN, PENDING, PROCESSING, REQUIRES_ACTION and any temporarily
        // unknown state are not failures. Keep reassuring the customer while
        // the Stripe webhook and KS OS payment record are being reconciled.
        waitForAnotherCheck(checkStatus);
      } catch {
        if (!active) return;
        // A transient request failure must never be presented as a failed
        // payment. Continue checking for the remainder of the two-minute
        // verification window instead.
        waitForAnotherCheck(checkStatus);
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
            Your payment has been submitted. We&apos;re waiting for confirmation from our payment provider and will update this page automatically.
          </p>
          <div className="mx-auto mt-6 max-w-xl rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
            <p className="text-sm font-black text-slate-950">Please stay on this page</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">Confirmation can take up to 2 minutes. You do not need to refresh, go back, or make another payment.</p>
          </div>
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

      {status === 'DELAYED' ? (
        <div className="px-6 py-12 text-center sm:px-10">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-amber-50 text-amber-700 shadow-inner">
            <Clock3 className="h-11 w-11" aria-hidden="true" />
          </div>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-amber-700">Still checking</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">We&apos;re still confirming your payment</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
            Confirmation is taking longer than usual. Your payment may already have been received, so please don&apos;t make another payment.
          </p>
          {reference ? (
            <div className="mx-auto mt-6 max-w-md rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">Booking reference</p>
              <p className="mt-1 break-all font-mono text-base font-black text-slate-950">{reference}</p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setRetryKey(value => value + 1)}
            disabled={!bookingIdentifier || !reference}
            className="mt-8 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-6 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:w-auto"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Check payment again
          </button>
        </div>
      ) : null}

      {status === 'FAILED' ? (
        <div className="px-6 py-12 text-center sm:px-10">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-rose-50 text-rose-600 shadow-inner">
            <AlertTriangle className="h-11 w-11" aria-hidden="true" />
          </div>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-rose-700">Payment not completed</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Your payment wasn&apos;t completed</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
            The payment provider has reported that this payment was not completed. No successful payment has been confirmed for this booking.
          </p>
          {reference ? (
            <div className="mx-auto mt-6 max-w-md rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">Booking reference</p>
              <p className="mt-1 break-all font-mono text-base font-black text-slate-950">{reference}</p>
            </div>
          ) : null}
          <Link to={bookingPath} className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 text-sm font-black text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 sm:w-auto">
            Return to booking page
          </Link>
        </div>
      ) : null}
    </main>
  );
}
