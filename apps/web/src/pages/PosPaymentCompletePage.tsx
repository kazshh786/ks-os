import { CheckCircle2, XCircle } from 'lucide-react';
import { useSearchParams } from 'react-router';

export default function PosPaymentCompletePage() {
  const [searchParams] = useSearchParams();
  const cancelled = searchParams.get('cancelled') === '1';

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-12 sm:py-20">
      <div className="mx-auto max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
        <div className={`px-6 py-10 text-center ${cancelled ? 'bg-amber-50' : 'bg-emerald-50'}`}>
          <div className={`mx-auto grid h-16 w-16 place-items-center rounded-full text-white ${cancelled ? 'bg-amber-500' : 'bg-emerald-600'}`}>
            {cancelled ? <XCircle className="h-8 w-8" /> : <CheckCircle2 className="h-8 w-8" />}
          </div>
          <h1 className="mt-5 text-2xl font-black text-slate-950">
            {cancelled ? 'Payment was not completed' : 'Payment received'}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-600">
            {cancelled
              ? 'No payment was taken. Return to the staff member if you would like to try another payment method.'
              : 'Stripe has received the payment. You can close this page and return to the staff member.'}
          </p>
        </div>
        <div className="px-6 py-5 text-center text-xs font-semibold text-slate-400">Secure payment powered by Stripe and KS OS</div>
      </div>
    </main>
  );
}
