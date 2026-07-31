from pathlib import Path
from textwrap import dedent


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, value: str) -> None:
    Path(path).write_text(value)


def replace_once(path: str, old: str, new: str) -> None:
    value = read(path)
    if old not in value:
      raise RuntimeError(f'Expected text not found in {path}: {old[:160]!r}')
    write(path, value.replace(old, new, 1))


# Appointment POS.
appointment = 'apps/web/src/components/POSCheckout.tsx'
replace_once(appointment, "  Radio,\n  ReceiptText,", "  QrCode,\n  Radio,\n  ReceiptText,")
replace_once(appointment, "  UserRound,\n  Wifi,", "  UserRound,\n  WalletCards,\n  Wifi,")
replace_once(
    appointment,
    """  PosConfig,\n  PosStripePaymentStatus,\n  PosStripeReader,""",
    """  PosConfig,\n  PosStripeOnlinePaymentSession,\n  PosStripeOnlinePaymentStatus,\n  PosStripePaymentStatus,\n  PosStripeReader,""",
)
replace_once(
    appointment,
    "import { fetchWithAuth } from '../api/client.js';",
    "import { fetchWithAuth } from '../api/client.js';\nimport { EmbeddedPosCheckout, PaymentLinkPanel } from './PosOnlinePayment.js';",
)
replace_once(
    appointment,
    "type PaymentChoice = 'READER' | 'TAP_TO_PAY' | 'MANUAL_TERMINAL';\ntype PaymentStage = 'choose' | 'instructions' | 'sending' | 'waiting' | 'finalising';",
    "type PaymentChoice = 'READER' | 'ONLINE' | 'PAYMENT_LINK' | 'TAP_TO_PAY' | 'MANUAL_TERMINAL';\ntype PaymentStage = 'choose' | 'instructions' | 'sending' | 'waiting' | 'online' | 'finalising';",
)
replace_once(
    appointment,
    "  const [manualReference, setManualReference] = useState('');\n  const [completedSale, setCompletedSale]",
    "  const [manualReference, setManualReference] = useState('');\n  const [onlineSession, setOnlineSession] = useState<PosStripeOnlinePaymentSession | null>(null);\n  const [completedSale, setCompletedSale]",
)
replace_once(
    appointment,
    """  const finaliseSale = async (\n    stripePayment: NonNullable<CheckoutRequest['stripePayment']>,\n    source?: PendingStripeSale,\n  ) => {""",
    """  const finaliseSale = async (\n    stripePayment: NonNullable<CheckoutRequest['stripePayment']>,\n    source?: PendingStripeSale,\n    paymentMethod: 'STRIPE_TERMINAL' | 'STRIPE_ONLINE' = 'STRIPE_TERMINAL',\n  ) => {""",
)
replace_once(
    appointment,
    """        appointmentId,\n        paymentMethod: 'STRIPE_TERMINAL',\n        tipAmountInCents:""",
    """        appointmentId,\n        paymentMethod,\n        tipAmountInCents:""",
)
online_appointment = dedent("""
  const pollOnlinePayment = async (session: PosStripeOnlinePaymentSession) => {
    setPaymentMessage('Waiting for Stripe to confirm the online payment…');
    for (let attempt = 0; attempt < 620 && mountedRef.current; attempt += 1) {
      try {
        const response = await apiRequest<{ success: true; data: PosStripeOnlinePaymentStatus }>(
          `/api/v1/pos/stripe/online-sessions/${encodeURIComponent(session.sessionId)}`,
        );
        if (response.data.succeeded && response.data.paymentIntentId) {
          setPaymentMessage('Payment approved. Completing the sale…');
          await finaliseSale({
            mode: 'ONLINE_CHECKOUT',
            paymentIntentId: response.data.paymentIntentId,
          }, undefined, 'STRIPE_ONLINE');
          return;
        }
        if (response.data.failed || response.data.expired) {
          setOnlineSession(null);
          setPaymentStage('choose');
          setError(response.data.failureMessage || (response.data.expired
            ? 'The payment link expired. Create a new one to try again.'
            : 'Stripe did not approve the online payment.'));
          return;
        }
      } catch (statusError) {
        setPaymentMessage(statusError instanceof Error
          ? `${statusError.message} Retrying safely…`
          : 'Checking Stripe again…');
      }
      await new Promise(resolve => window.setTimeout(resolve, 3_000));
    }
    if (mountedRef.current) {
      setOnlineSession(null);
      setPaymentStage('choose');
      setError('Stripe is still processing this payment. Check Stripe before starting another charge.');
    }
  };

  const startOnlinePayment = async (presentation: 'EMBEDDED' | 'HOSTED') => {
    if (!selectedAppointmentId || !serverTotals || !config?.stripe.onlinePaymentsReady) return;
    setPaymentStage('sending');
    setPaymentMessage(presentation === 'EMBEDDED'
      ? 'Opening secure card payment…'
      : 'Creating a secure payment link…');
    setError('');
    try {
      const response = await apiRequest<{ success: true; data: PosStripeOnlinePaymentSession }>(
        '/api/v1/pos/stripe/online-sessions',
        {
          method: 'POST',
          body: JSON.stringify({
            appointmentId: selectedAppointmentId,
            idempotencyKey: checkoutIdempotencyRef.current,
            presentation,
            tipAmountInCents,
            purchasedProducts,
          }),
        },
      );
      if (!mountedRef.current) return;
      setOnlineSession(response.data);
      setPaymentStage('online');
      setPaymentMessage(presentation === 'EMBEDDED'
        ? 'Complete payment below. KS OS will finish the sale automatically.'
        : 'Waiting for the customer to pay through the secure link…');
      void pollOnlinePayment(response.data);
    } catch (startError) {
      setPaymentStage('choose');
      setError(startError instanceof Error ? startError.message : 'The online payment could not be started.');
    }
  };

""")
replace_once(
    appointment,
    "  const confirmManualStripePayment = async () => {",
    online_appointment + "  const confirmManualStripePayment = async () => {",
)
replace_once(
    appointment,
    "setPaymentChoice(onlineReaders.length > 0 ? 'READER' : 'TAP_TO_PAY');",
    "setPaymentChoice(onlineReaders.length > 0 ? 'READER' : config.stripe.onlinePaymentsReady ? 'ONLINE' : 'TAP_TO_PAY');",
)
replace_once(
    appointment,
    """    setManualConfirmed(false);\n    setManualReference('');\n    setError('');""",
    """    setManualConfirmed(false);\n    setManualReference('');\n    setOnlineSession(null);\n    setError('');""",
)
replace_once(
    appointment,
    """    setManualConfirmed(false);\n    setManualReference('');\n    checkoutIdempotencyRef.current""",
    """    setManualConfirmed(false);\n    setManualReference('');\n    setOnlineSession(null);\n    checkoutIdempotencyRef.current""",
)
appointment_choices = dedent("""
                    <button type="button" onClick={() => setPaymentChoice('ONLINE')} disabled={!config?.stripe.onlinePaymentsReady} className={`flex min-h-[92px] w-full items-center gap-4 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${paymentChoice === 'ONLINE' ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'}`}>
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-600 text-white"><WalletCards className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-black text-slate-900">Pay on this screen</p><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">Automatic</span></div><p className="mt-1 text-xs leading-5 text-slate-500">Open Stripe's secure card form inside the POS. Apple Pay or Google Pay appears when supported.</p></div>{paymentChoice === 'ONLINE' && <CheckCircle2 className="h-5 w-5 shrink-0 text-indigo-600" />}
                    </button>
                    <button type="button" onClick={() => setPaymentChoice('PAYMENT_LINK')} disabled={!config?.stripe.onlinePaymentsReady} className={`flex min-h-[92px] w-full items-center gap-4 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${paymentChoice === 'PAYMENT_LINK' ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'}`}>
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-cyan-600 text-white"><QrCode className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-black text-slate-900">Payment link or QR code</p><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">Automatic</span></div><p className="mt-1 text-xs leading-5 text-slate-500">Let the customer scan a QR code or open a secure Stripe link on their own phone.</p></div>{paymentChoice === 'PAYMENT_LINK' && <CheckCircle2 className="h-5 w-5 shrink-0 text-indigo-600" />}
                    </button>
""")
replace_once(
    appointment,
    "                    <button type=\"button\" onClick={() => setPaymentChoice('TAP_TO_PAY')}",
    appointment_choices + "                    <button type=\"button\" onClick={() => setPaymentChoice('TAP_TO_PAY')}",
)
replace_once(
    appointment,
    """<button type="button" onClick={() => setPaymentStage('instructions')} disabled={paymentChoice === 'READER' && !selectedReaderId}""",
    """<button type="button" onClick={() => paymentChoice === 'ONLINE' ? void startOnlinePayment('EMBEDDED') : paymentChoice === 'PAYMENT_LINK' ? void startOnlinePayment('HOSTED') : setPaymentStage('instructions')} disabled={(paymentChoice === 'READER' && !selectedReaderId) || ((paymentChoice === 'ONLINE' || paymentChoice === 'PAYMENT_LINK') && !config?.stripe.onlinePaymentsReady)}""",
)
appointment_online_ui = dedent("""
              {paymentStage === 'online' && onlineSession && paymentChoice === 'ONLINE' && (
                <>
                  <div className="rounded-2xl bg-indigo-50 px-4 py-3 text-center"><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Secure online payment</p><p className="mt-1 text-sm font-semibold text-slate-700">The exact {money(grandTotal, currency)} total was sent to Stripe automatically.</p></div>
                  <EmbeddedPosCheckout session={onlineSession} />
                  <div className="flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600"><Loader2 className="h-4 w-4 animate-spin text-indigo-600" />{paymentMessage}</div>
                </>
              )}

              {paymentStage === 'online' && onlineSession && paymentChoice === 'PAYMENT_LINK' && (
                <PaymentLinkPanel session={onlineSession} message={paymentMessage} />
              )}

""")
replace_once(
    appointment,
    "              {paymentStage === 'instructions' && paymentChoice !== 'READER' && (",
    appointment_online_ui + "              {paymentStage === 'instructions' && (paymentChoice === 'TAP_TO_PAY' || paymentChoice === 'MANUAL_TERMINAL') && (",
)
replace_once(
    appointment,
    "disabled={paymentStage === 'sending' || paymentStage === 'waiting' || paymentStage === 'finalising'}",
    "disabled={paymentStage === 'sending' || paymentStage === 'waiting' || paymentStage === 'online' || paymentStage === 'finalising'}",
)

# Standalone retail POS.
retail = 'apps/web/src/components/RetailPOSCheckout.tsx'
replace_once(retail, "  Plus,\n  RefreshCw,", "  Plus,\n  QrCode,\n  RefreshCw,")
replace_once(retail, "  Smartphone,\n  X,", "  Smartphone,\n  WalletCards,\n  X,")
replace_once(
    retail,
    """  PosConfig,\n  PosStripePaymentStatus,\n  PosStripeReader,""",
    """  PosConfig,\n  PosStripeOnlinePaymentSession,\n  PosStripeOnlinePaymentStatus,\n  PosStripePaymentStatus,\n  PosStripeReader,""",
)
replace_once(
    retail,
    "import { fetchWithAuth } from '../api/client.js';",
    "import { fetchWithAuth } from '../api/client.js';\nimport { EmbeddedPosCheckout, PaymentLinkPanel } from './PosOnlinePayment.js';",
)
replace_once(
    retail,
    "type PaymentChoice = 'READER' | 'TAP_TO_PAY' | 'MANUAL_TERMINAL';\ntype PaymentStage = 'choose' | 'sending' | 'waiting' | 'instructions' | 'finalising';",
    "type PaymentChoice = 'READER' | 'ONLINE' | 'PAYMENT_LINK' | 'TAP_TO_PAY' | 'MANUAL_TERMINAL';\ntype PaymentStage = 'choose' | 'sending' | 'waiting' | 'instructions' | 'online' | 'finalising';",
)
replace_once(
    retail,
    "  const [manualReference, setManualReference] = useState('');\n  const [completedSale, setCompletedSale]",
    "  const [manualReference, setManualReference] = useState('');\n  const [onlineSession, setOnlineSession] = useState<PosStripeOnlinePaymentSession | null>(null);\n  const [completedSale, setCompletedSale]",
)
replace_once(
    retail,
    """      mode: 'AUTOMATED_TERMINAL' | 'TAP_TO_PAY_MANUAL' | 'TERMINAL_MANUAL';""",
    """      mode: 'AUTOMATED_TERMINAL' | 'ONLINE_CHECKOUT' | 'TAP_TO_PAY_MANUAL' | 'TERMINAL_MANUAL';""",
)
replace_once(
    retail,
    """    source?: PendingSale,\n  ) => {""",
    """    source?: PendingSale,\n    paymentMethod: 'STRIPE_TERMINAL' | 'STRIPE_ONLINE' = 'STRIPE_TERMINAL',\n  ) => {""",
)
replace_once(
    retail,
    """          idempotencyKey: source?.idempotencyKey || idempotencyRef.current,\n          paymentMethod: 'STRIPE_TERMINAL',""",
    """          idempotencyKey: source?.idempotencyKey || idempotencyRef.current,\n          paymentMethod,""",
)
online_retail = dedent("""
  const pollOnlinePayment = async (session: PosStripeOnlinePaymentSession) => {
    setPaymentMessage('Waiting for Stripe to confirm the online payment…');
    for (let attempt = 0; attempt < 620 && mountedRef.current; attempt += 1) {
      try {
        const response = await request<{ success: true; data: PosStripeOnlinePaymentStatus }>(
          `/api/v1/pos/stripe/online-sessions/${encodeURIComponent(session.sessionId)}`,
        );
        if (response.data.succeeded && response.data.paymentIntentId) {
          setPaymentMessage('Payment approved. Completing the retail sale…');
          await finalise({
            mode: 'ONLINE_CHECKOUT',
            paymentIntentId: response.data.paymentIntentId,
          }, undefined, 'STRIPE_ONLINE');
          return;
        }
        if (response.data.failed || response.data.expired) {
          setOnlineSession(null);
          setPaymentStage('choose');
          setError(response.data.failureMessage || (response.data.expired
            ? 'The payment link expired. Create a new one to try again.'
            : 'Stripe did not approve the online payment.'));
          return;
        }
      } catch (cause) {
        setPaymentMessage(cause instanceof Error ? `${cause.message} Retrying safely…` : 'Checking Stripe again…');
      }
      await new Promise(resolve => window.setTimeout(resolve, 3_000));
    }
    if (mountedRef.current) {
      setOnlineSession(null);
      setPaymentStage('choose');
      setError('Stripe is still processing this payment. Check Stripe before starting another charge.');
    }
  };

  const startOnlinePayment = async (presentation: 'EMBEDDED' | 'HOSTED') => {
    if (!totals || !purchasedProducts.length || !config?.stripe.onlinePaymentsReady) return;
    setPaymentStage('sending');
    setPaymentMessage(presentation === 'EMBEDDED' ? 'Opening secure card payment…' : 'Creating a secure payment link…');
    setError('');
    try {
      const response = await request<{ success: true; data: PosStripeOnlinePaymentSession }>(
        '/api/v1/pos/retail/stripe/online-sessions',
        {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: idempotencyRef.current,
            presentation,
            tipAmountInCents: 0,
            purchasedProducts,
          }),
        },
      );
      if (!mountedRef.current) return;
      setOnlineSession(response.data);
      setPaymentStage('online');
      setPaymentMessage(presentation === 'EMBEDDED'
        ? 'Complete payment below. KS OS will finish the sale automatically.'
        : 'Waiting for the customer to pay through the secure link…');
      void pollOnlinePayment(response.data);
    } catch (cause) {
      setPaymentStage('choose');
      setError(cause instanceof Error ? cause.message : 'The online retail payment could not be started.');
    }
  };

""")
replace_once(retail, "  const openPayment = () => {", online_retail + "  const openPayment = () => {")
replace_once(
    retail,
    "setPaymentChoice(onlineReaders.length ? 'READER' : 'TAP_TO_PAY');",
    "setPaymentChoice(onlineReaders.length ? 'READER' : config.stripe.onlinePaymentsReady ? 'ONLINE' : 'TAP_TO_PAY');",
)
replace_once(
    retail,
    """    setManualConfirmed(false);\n    setManualReference('');\n    setError('');""",
    """    setManualConfirmed(false);\n    setManualReference('');\n    setOnlineSession(null);\n    setError('');""",
)
replace_once(
    retail,
    """    setManualConfirmed(false);\n    setManualReference('');\n    idempotencyRef.current""",
    """    setManualConfirmed(false);\n    setManualReference('');\n    setOnlineSession(null);\n    idempotencyRef.current""",
)
retail_choices = (
    "</button><button type=\"button\" onClick={() => setPaymentChoice('ONLINE')} disabled={!config?.stripe.onlinePaymentsReady} className={`flex min-h-[88px] w-full items-center gap-4 rounded-2xl border p-4 text-left disabled:opacity-50 ${paymentChoice === 'ONLINE' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200'}`}><div className=\"grid h-12 w-12 place-items-center rounded-2xl bg-violet-600 text-white\"><WalletCards className=\"h-5 w-5\" /></div><div className=\"flex-1\"><p className=\"font-black\">Pay on this screen</p><p className=\"mt-1 text-xs text-slate-500\">Open Stripe's secure card form with the exact retail total.</p></div>{paymentChoice === 'ONLINE' && <CheckCircle2 className=\"h-5 w-5 text-indigo-600\" />}</button>"
    "<button type=\"button\" onClick={() => setPaymentChoice('PAYMENT_LINK')} disabled={!config?.stripe.onlinePaymentsReady} className={`flex min-h-[88px] w-full items-center gap-4 rounded-2xl border p-4 text-left disabled:opacity-50 ${paymentChoice === 'PAYMENT_LINK' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200'}`}><div className=\"grid h-12 w-12 place-items-center rounded-2xl bg-cyan-600 text-white\"><QrCode className=\"h-5 w-5\" /></div><div className=\"flex-1\"><p className=\"font-black\">Payment link or QR code</p><p className=\"mt-1 text-xs text-slate-500\">Let the customer pay securely on their own phone.</p></div>{paymentChoice === 'PAYMENT_LINK' && <CheckCircle2 className=\"h-5 w-5 text-indigo-600\" />}</button>"
    "<button type=\"button\" onClick={() => setPaymentChoice('TAP_TO_PAY')}"
)
replace_once(
    retail,
    "</button><button type=\"button\" onClick={() => setPaymentChoice('TAP_TO_PAY')}",
    retail_choices,
)
replace_once(
    retail,
    "onClick={() => setPaymentStage('instructions')}",
    "onClick={() => paymentChoice === 'ONLINE' ? void startOnlinePayment('EMBEDDED') : paymentChoice === 'PAYMENT_LINK' ? void startOnlinePayment('HOSTED') : setPaymentStage('instructions')}",
)
retail_online_ui = (
    "{paymentStage === 'online' && onlineSession && paymentChoice === 'ONLINE' && <><div className=\"rounded-2xl bg-indigo-50 px-4 py-3 text-center\"><p className=\"text-xs font-bold uppercase tracking-wider text-indigo-600\">Secure online payment</p><p className=\"mt-1 text-sm font-semibold text-slate-700\">The exact {money(grandTotal, currency)} total was sent to Stripe automatically.</p></div><EmbeddedPosCheckout session={onlineSession} /><div className=\"flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600\"><Loader2 className=\"h-4 w-4 animate-spin text-indigo-600\" />{paymentMessage}</div></>}"
    "{paymentStage === 'online' && onlineSession && paymentChoice === 'PAYMENT_LINK' && <PaymentLinkPanel session={onlineSession} message={paymentMessage} />}"
)
replace_once(
    retail,
    "{paymentStage === 'instructions' && paymentChoice !== 'READER' &&",
    retail_online_ui + "{paymentStage === 'instructions' && (paymentChoice === 'TAP_TO_PAY' || paymentChoice === 'MANUAL_TERMINAL') &&",
)
replace_once(
    retail,
    "disabled={['sending', 'waiting', 'finalising'].includes(paymentStage)}",
    "disabled={['sending', 'waiting', 'online', 'finalising'].includes(paymentStage)}",
)

# Public hosted Checkout completion page.
app = 'apps/web/src/App.tsx'
replace_once(
    app,
    "import PaymentCancel from './pages/book/PaymentCancel.js';",
    "import PaymentCancel from './pages/book/PaymentCancel.js';\nimport PosPaymentCompletePage from './pages/PosPaymentCompletePage.js';",
)
replace_once(
    app,
    "        <Route path=\"/fact-finding\" element={<ClientFactFindingPage />} />",
    "        <Route path=\"/fact-finding\" element={<ClientFactFindingPage />} />\n        <Route path=\"/pos-payment-complete\" element={<PosPaymentCompletePage />} />",
)

# UI regression checks live with the API test suite so the monorepo test command covers them.
write('apps/api/tests/pos-online-payment-ui.test.ts', dedent("""
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const web = (path: string) => readFileSync(resolve(process.cwd(), `../web/src/${path}`), 'utf8');

test('appointment POS offers embedded and payment-link Stripe flows', () => {
  const source = web('components/POSCheckout.tsx');
  assert.match(source, /Pay on this screen/);
  assert.match(source, /Payment link or QR code/);
  assert.match(source, /startOnlinePayment\('EMBEDDED'\)/);
  assert.match(source, /startOnlinePayment\('HOSTED'\)/);
  assert.match(source, /paymentMethod: 'STRIPE_ONLINE'/);
  assert.match(source, /mode: 'ONLINE_CHECKOUT'/);
});

test('retail POS offers the same server-calculated online payment routes', () => {
  const source = web('components/RetailPOSCheckout.tsx');
  assert.match(source, /pos\/retail\/stripe\/online-sessions/);
  assert.match(source, /EmbeddedPosCheckout/);
  assert.match(source, /PaymentLinkPanel/);
  assert.match(source, /'STRIPE_ONLINE'/);
});

test('hosted POS payment result page is publicly routed', () => {
  const app = web('App.tsx');
  assert.match(app, /path="\/pos-payment-complete"/);
  assert.match(app, /PosPaymentCompletePage/);
});
"""))
