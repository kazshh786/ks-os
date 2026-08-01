import { useEffect, useMemo, useState } from 'react';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import QRCode from 'qrcode';
import { Copy, ExternalLink, Loader2, Share2 } from 'lucide-react';

type PosStripeOnlinePaymentSession = {
  sessionId: string;
  presentation: 'EMBEDDED' | 'HOSTED';
  clientSecret: string | null;
  checkoutUrl: string | null;
  publishableKey: string;
  stripeAccountId: string;
  amountInCents: number;
  currency: string;
  expiresAt: string;
};

export function EmbeddedPosCheckout({ session }: { session: PosStripeOnlinePaymentSession }) {
  const stripePromise = useMemo(() => loadStripe(session.publishableKey, {
    stripeAccount: session.stripeAccountId,
  }), [session.publishableKey, session.stripeAccountId]);

  if (!session.clientSecret) {
    return <p className="rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-800">Stripe did not return an embedded checkout form.</p>;
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
      <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: session.clientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}

export function PaymentLinkPanel({
  session,
  message,
}: {
  session: PosStripeOnlinePaymentSession;
  message: string;
}) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copyLabel, setCopyLabel] = useState('Copy payment link');

  useEffect(() => {
    let active = true;
    if (!session.checkoutUrl) return undefined;
    void QRCode.toDataURL(session.checkoutUrl, {
      width: 280,
      margin: 1,
      errorCorrectionLevel: 'M',
    }).then(value => {
      if (active) setQrDataUrl(value);
    });
    return () => {
      active = false;
    };
  }, [session.checkoutUrl]);

  const copyLink = async () => {
    if (!session.checkoutUrl) return;
    await navigator.clipboard?.writeText(session.checkoutUrl);
    setCopyLabel('Link copied');
    window.setTimeout(() => setCopyLabel('Copy payment link'), 1800);
  };

  const shareLink = async () => {
    if (!session.checkoutUrl || !navigator.share) return;
    await navigator.share({
      title: 'Secure payment link',
      text: 'Complete your payment securely with Stripe.',
      url: session.checkoutUrl,
    }).catch(() => undefined);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 p-5 text-center sm:p-7">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">Customer payment link</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">Ask the customer to scan this QR code, or open and share the secure Stripe checkout link.</p>
        <div className="mx-auto mt-5 grid min-h-[280px] max-w-[280px] place-items-center overflow-hidden rounded-3xl border border-white bg-white p-3 shadow-sm">
          {qrDataUrl ? <img src={qrDataUrl} alt="QR code for the secure Stripe payment link" className="h-full w-full" /> : <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />}
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <button type="button" onClick={() => void copyLink()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 text-sm font-bold text-indigo-700 hover:bg-indigo-50">
            <Copy className="h-4 w-4" />{copyLabel}
          </button>
          <button type="button" onClick={() => session.checkoutUrl && window.open(session.checkoutUrl, '_blank', 'noopener,noreferrer')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 text-sm font-bold text-indigo-700 hover:bg-indigo-50">
            <ExternalLink className="h-4 w-4" />Open checkout
          </button>
          <button type="button" onClick={() => void shareLink()} disabled={!navigator.share} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 text-sm font-bold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40">
            <Share2 className="h-4 w-4" />Share link
          </button>
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />{message}
      </div>
    </div>
  );
}