/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  CreditCard,
  Loader2,
  Minus,
  Package,
  Plus,
  Radio,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  UserRound,
  Wifi,
  X,
} from 'lucide-react';
import type {
  CheckoutCandidate,
  CheckoutRequest,
  CheckoutResponse,
  PosConfig,
  PosStripePaymentStatus,
  PosStripeReader,
  Product,
} from '@ks-os/contracts';
import type { BusinessTenant, POSItem } from '../data/types.js';
import { getDataProvider } from '../data/data-provider.js';
import { fetchWithAuth } from '../api/client.js';

interface POSCheckoutProps {
  tenant: BusinessTenant;
  preloadedBooking?: { id: string } | null;
  onCheckoutCompleted: () => void;
}

type PaymentChoice = 'READER' | 'TAP_TO_PAY' | 'MANUAL_TERMINAL';
type PaymentStage = 'choose' | 'instructions' | 'sending' | 'waiting' | 'finalising';

interface PendingStripeSale {
  paymentIntentId: string;
  readerId: string;
  amountInCents: number;
  appointmentId: string;
  idempotencyKey: string;
  tipAmountInCents: number;
  purchasedProducts: Array<{ productId: string; quantity: number }>;
}


const money = (amountInCents: number, currency = 'GBP') => new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency,
}).format(amountInCents / 100);

const safeJson = async (response: Response) => response.json().catch(() => ({}));

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithAuth(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.error || 'The request could not be completed.');
  }
  return body as T;
}

export default function POSCheckout({ tenant, preloadedBooking, onCheckoutCompleted }: POSCheckoutProps) {
  const [config, setConfig] = useState<PosConfig | null>(null);
  const [candidates, setCandidates] = useState<CheckoutCandidate[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [readers, setReaders] = useState<PosStripeReader[]>([]);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(preloadedBooking?.id || null);
  const [selectedReaderId, setSelectedReaderId] = useState('');
  const [cart, setCart] = useState<POSItem[]>([]);
  const [appointmentSearch, setAppointmentSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [tipPercent, setTipPercent] = useState(0);
  const [customTip, setCustomTip] = useState('');
  const [serverTotals, setServerTotals] = useState<{
    serviceAmountInCents: number;
    retailAmountInCents: number;
    tipAmountInCents: number;
    grandTotalInCents: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState('');
  const [basketOpen, setBasketOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>('READER');
  const [paymentStage, setPaymentStage] = useState<PaymentStage>('choose');
  const [paymentMessage, setPaymentMessage] = useState('');
  const [manualConfirmed, setManualConfirmed] = useState(false);
  const [manualReference, setManualReference] = useState('');
  const [completedSale, setCompletedSale] = useState<CheckoutResponse['data'] | null>(null);

  const mountedRef = useRef(true);
  const finalisingRef = useRef(false);
  const checkoutIdempotencyRef = useRef(crypto.randomUUID());

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const selectedCandidate = useMemo(
    () => candidates.find(candidate => candidate.appointmentId === selectedAppointmentId) || null,
    [candidates, selectedAppointmentId],
  );

  const purchasedProducts = useMemo(() => cart.map(item => ({
    productId: item.id,
    quantity: item.quantity,
  })), [cart]);

  const localServiceAmount = selectedCandidate?.quotedAmount || 0;
  const localRetailAmount = cart.reduce((total, item) => total + Math.round(item.price * 100) * item.quantity, 0);
  const customTipInCents = Math.max(0, Math.round((Number.parseFloat(customTip) || 0) * 100));
  const tipAmountInCents = customTip
    ? customTipInCents
    : Math.round((localServiceAmount + localRetailAmount) * (tipPercent / 100));

  const currency = config?.plan?.currency || tenant.currency || 'GBP';
  const grandTotal = serverTotals?.grandTotalInCents ?? localServiceAmount + localRetailAmount + tipAmountInCents;
  const onlineReaders = readers.filter(reader => reader.online && reader.supportsServerDriven);

  useEffect(() => {
    checkoutIdempotencyRef.current = crypto.randomUUID();
  }, [selectedAppointmentId, purchasedProducts, tipAmountInCents]);

  const loadReaders = async () => {
    if (!config?.stripe.ready) return;
    try {
      const response = await apiRequest<{ success: true; data: PosStripeReader[] }>('/api/v1/pos/stripe/readers');
      if (!mountedRef.current) return;
      setReaders(response.data);
      const preferred = response.data.find(reader => reader.online && reader.supportsServerDriven);
      setSelectedReaderId(current => current || preferred?.id || '');
    } catch (readerError) {
      if (mountedRef.current) setPaymentMessage(readerError instanceof Error ? readerError.message : 'Stripe readers are unavailable.');
    }
  };

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const [configResponse, candidateResponse] = await Promise.all([
          apiRequest<{ success: true; data: PosConfig }>('/api/v1/pos/config'),
          getDataProvider().getCheckoutAppointments(),
        ]);
        if (!mountedRef.current) return;

        setConfig(configResponse.data);
        setCandidates(candidateResponse.data);
        if (!selectedAppointmentId && candidateResponse.data.length === 1) {
          setSelectedAppointmentId(candidateResponse.data[0].appointmentId);
        }

        if (configResponse.data.inventoryEnabled) {
          const productResponse = await getDataProvider().searchProducts();
          if (mountedRef.current) setProducts(productResponse.data);
        }

        if (configResponse.data.stripe.ready) {
          const readerResponse = await apiRequest<{ success: true; data: PosStripeReader[] }>('/api/v1/pos/stripe/readers').catch(() => null);
          if (mountedRef.current && readerResponse) {
            setReaders(readerResponse.data);
            const preferred = readerResponse.data.find(reader => reader.online && reader.supportsServerDriven);
            setSelectedReaderId(preferred?.id || '');
          }
        }
      } catch (loadError) {
        if (mountedRef.current) setError(loadError instanceof Error ? loadError.message : 'The POS could not be loaded.');
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    };

    void load();
  // selectedAppointmentId is deliberately excluded so loading does not reset a sale.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.id]);

  useEffect(() => {
    if (!selectedAppointmentId) {
      setServerTotals(null);
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsPreviewing(true);
      setError('');
      try {
        const response = await getDataProvider().previewCheckout({
          appointmentId: selectedAppointmentId,
          paymentMethod: 'STRIPE_TERMINAL',
          tipAmountInCents,
          purchasedProducts,
        });
        if (mountedRef.current) setServerTotals(response.data);
      } catch (previewError) {
        if (mountedRef.current) {
          setServerTotals(null);
          setError(previewError instanceof Error ? previewError.message : 'The total could not be calculated.');
        }
      } finally {
        if (mountedRef.current) setIsPreviewing(false);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [selectedAppointmentId, purchasedProducts, tipAmountInCents]);

  const refreshCandidates = async () => {
    const response = await getDataProvider().getCheckoutAppointments();
    if (mountedRef.current) setCandidates(response.data);
  };

  const addProduct = (product: Product) => {
    setCart(current => {
      const existing = current.find(item => item.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stockQuantity) return current;
        return current.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      if (product.stockQuantity < 1) return current;
      return [...current, {
        id: product.id,
        name: product.name,
        type: 'Product',
        price: product.priceInCents / 100,
        quantity: 1,
      }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(current => current.flatMap(item => {
      if (item.id !== productId) return [item];
      const product = products.find(candidate => candidate.id === productId);
      const nextQuantity = item.quantity + delta;
      if (nextQuantity <= 0) return [];
      if (product && nextQuantity > product.stockQuantity) return [item];
      return [{ ...item, quantity: nextQuantity }];
    }));
  };

  const finaliseSale = async (
    stripePayment: NonNullable<CheckoutRequest['stripePayment']>,
    source?: PendingStripeSale,
  ) => {
    if (finalisingRef.current) return;
    const appointmentId = source?.appointmentId || selectedAppointmentId;
    if (!appointmentId) return;

    finalisingRef.current = true;
    setPaymentStage('finalising');
    setPaymentMessage('Confirming the sale…');
    setError('');

    try {
      const response = await getDataProvider().completeCheckout({
        idempotencyKey: source?.idempotencyKey || checkoutIdempotencyRef.current,
        appointmentId,
        paymentMethod: 'STRIPE_TERMINAL',
        tipAmountInCents: source?.tipAmountInCents ?? tipAmountInCents,
        purchasedProducts: source?.purchasedProducts || purchasedProducts,
        stripePayment,
      });
      if (!mountedRef.current) return;
      setCompletedSale(response.data);
      setPaymentOpen(false);
      setBasketOpen(false);
      window.dispatchEvent(new CustomEvent('ks-bookings-updated'));
    } catch (checkoutError) {
      if (mountedRef.current) {
        setPaymentStage('instructions');
        setError(checkoutError instanceof Error ? checkoutError.message : 'The sale could not be confirmed.');
      }
    } finally {
      finalisingRef.current = false;
    }
  };

  const pollStripePayment = async (pending: PendingStripeSale) => {
    setPaymentOpen(true);
    setPaymentChoice('READER');
    setPaymentStage('waiting');
    setPaymentMessage('Waiting for the customer to complete payment on the Stripe reader…');

    for (let attempt = 0; attempt < 120 && mountedRef.current; attempt += 1) {
      try {
        const response = await apiRequest<{ success: true; data: PosStripePaymentStatus }>(
          `/api/v1/pos/stripe/payment-intents/${encodeURIComponent(pending.paymentIntentId)}`,
        );
        if (response.data.succeeded) {
          setPaymentMessage('Payment approved. Completing the sale…');
          await finaliseSale({
            mode: 'AUTOMATED_TERMINAL',
            paymentIntentId: pending.paymentIntentId,
          }, pending);
          return;
        }
        if (response.data.failed) {
              setPaymentStage('instructions');
          setError(response.data.failureMessage || 'Stripe did not approve the payment.');
          return;
        }
      } catch (statusError) {
        setPaymentMessage(statusError instanceof Error
          ? `${statusError.message} Retrying safely…`
          : 'Checking Stripe again…');
      }
      await new Promise(resolve => window.setTimeout(resolve, 1500));
    }

    if (mountedRef.current) {
      setPaymentStage('instructions');
      setError('Stripe is still processing this payment. Use Check payment status before starting another sale.');
    }
  };

  const startReaderPayment = async () => {
    if (!selectedAppointmentId || !serverTotals || !selectedReaderId) return;
    setPaymentStage('sending');
    setPaymentMessage(`Sending ${money(serverTotals.grandTotalInCents, currency)} to the Stripe reader…`);
    setError('');

    try {
      const idempotencyKey = checkoutIdempotencyRef.current;
      const response = await apiRequest<{
        success: true;
        data: {
          paymentIntentId: string;
          readerId: string;
          amountInCents: number;
          currency: string;
          status: string;
        };
      }>('/api/v1/pos/stripe/payment-intents', {
        method: 'POST',
        body: JSON.stringify({
          appointmentId: selectedAppointmentId,
          readerId: selectedReaderId,
          idempotencyKey,
          tipAmountInCents,
          purchasedProducts,
        }),
      });

      const pending: PendingStripeSale = {
        paymentIntentId: response.data.paymentIntentId,
        readerId: response.data.readerId,
        amountInCents: response.data.amountInCents,
        appointmentId: selectedAppointmentId,
        idempotencyKey,
        tipAmountInCents,
        purchasedProducts,
      };
      await pollStripePayment(pending);
    } catch (startError) {
      setPaymentStage('instructions');
      setError(startError instanceof Error ? startError.message : 'The reader payment could not be started.');
    }
  };

  const confirmManualStripePayment = async () => {
    if (!manualConfirmed) return;
    await finaliseSale({
      mode: paymentChoice === 'TAP_TO_PAY' ? 'TAP_TO_PAY_MANUAL' : 'TERMINAL_MANUAL',
      manuallyConfirmed: true,
      manualReference: manualReference.trim() || undefined,
    });
  };

  const openPayment = () => {
    if (!selectedAppointmentId || !serverTotals || !config?.stripe.ready) return;
    setPaymentChoice(onlineReaders.length > 0 ? 'READER' : 'TAP_TO_PAY');
    setPaymentStage('choose');
    setPaymentMessage('');
    setManualConfirmed(false);
    setManualReference('');
    setError('');
    setPaymentOpen(true);
  };

  const resetSale = async () => {
    setCompletedSale(null);
    setCart([]);
    setTipPercent(0);
    setCustomTip('');
    setSelectedAppointmentId(null);
    setServerTotals(null);
    setManualConfirmed(false);
    setManualReference('');
    checkoutIdempotencyRef.current = crypto.randomUUID();
    await refreshCandidates().catch(() => undefined);
  };

  const copyAmount = async () => {
    const value = (grandTotal / 100).toFixed(2);
    await navigator.clipboard?.writeText(value).catch(() => undefined);
    setPaymentMessage(`Copied ${value}`);
  };

  const filteredCandidates = candidates.filter(candidate => {
    const query = appointmentSearch.trim().toLowerCase();
    if (!query) return true;
    return [candidate.clientName, candidate.serviceName, candidate.staffName]
      .filter(Boolean)
      .some(value => value!.toLowerCase().includes(query));
  });

  const filteredProducts = products.filter(product => product.name.toLowerCase().includes(productSearch.trim().toLowerCase()));

  if (isLoading) {
    return (
      <div className="min-h-[560px] rounded-3xl border border-slate-200 bg-white grid place-items-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-600" />
          <p className="mt-3 text-sm font-semibold text-slate-700">Opening your POS…</p>
        </div>
      </div>
    );
  }

  if (completedSale) {
    return (
      <div className="min-h-[560px] rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-8">
        <div className="mx-auto max-w-xl overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-sm">
          <div className="bg-emerald-50 px-6 py-8 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-200">
              <Check className="h-8 w-8" strokeWidth={3} />
            </div>
            <h1 className="mt-4 text-2xl font-black text-slate-950">Payment confirmed</h1>
            <p className="mt-1 text-sm text-slate-600">The sale is complete and the appointment has been closed.</p>
            <p className="mt-5 text-4xl font-black tracking-tight text-slate-950">
              {money(completedSale.calculation.grandTotalInCents, currency)}
            </p>
          </div>

          <div className="space-y-5 p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 text-sm">
              <div>
                <p className="font-bold text-slate-900">{completedSale.appointment.clientName || 'Walk-in customer'}</p>
                <p className="text-slate-500">{completedSale.appointment.serviceName}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-slate-800">Stripe</p>
                <p className="font-mono text-xs text-slate-400">{completedSale.transactionId.slice(0, 8)}</p>
              </div>
            </div>

            <div className="space-y-3">
              {completedSale.items.map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-semibold text-slate-800">{item.name}</p>
                    {item.quantity > 1 && <p className="text-xs text-slate-400">Quantity {item.quantity}</p>}
                  </div>
                  <p className="font-bold text-slate-900">{money(item.totalInCents, currency)}</p>
                </div>
              ))}
              {completedSale.calculation.tipAmountInCents > 0 && (
                <div className="flex items-center justify-between text-sm text-slate-600">
                  <span>Tip</span>
                  <span>{money(completedSale.calculation.tipAmountInCents, currency)}</span>
                </div>
              )}
            </div>

            <button type="button" onClick={() => void resetSale()} className="min-h-12 w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-200">
              New sale
            </button>
            <button type="button" onClick={onCheckoutCompleted} className="min-h-11 w-full rounded-2xl px-5 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-100">
              Back to calendar
            </button>
          </div>
        </div>
      </div>
    );
  }

  const BasketContents = ({ mobile = false }: { mobile?: boolean }) => (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Current sale</p>
          <h2 className="mt-1 text-lg font-black text-slate-950">{selectedCandidate?.clientName || 'Select a customer'}</h2>
        </div>
        {mobile && (
          <button type="button" onClick={() => setBasketOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Close basket">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {selectedCandidate ? (
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-indigo-500">Service</p>
                <p className="mt-1 font-bold text-slate-900">{selectedCandidate.serviceName || 'Custom service'}</p>
                <p className="mt-1 text-xs text-slate-500">With {selectedCandidate.staffName || 'assigned staff'}</p>
              </div>
              <p className="font-black text-slate-950">{money(selectedCandidate.quotedAmount, currency)}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Choose an appointment to begin.</div>
        )}

        {cart.map(item => (
          <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><Package className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-900">{item.name}</p>
              <p className="text-xs text-slate-500">{money(Math.round(item.price * 100), currency)} each</p>
            </div>
            <div className="flex items-center rounded-xl border border-slate-200">
              <button type="button" onClick={() => updateQuantity(item.id, -1)} className="grid h-10 w-10 place-items-center text-slate-600 hover:bg-slate-50" aria-label={`Remove one ${item.name}`}><Minus className="h-4 w-4" /></button>
              <span className="w-7 text-center text-sm font-bold text-slate-900">{item.quantity}</span>
              <button type="button" onClick={() => updateQuantity(item.id, 1)} className="grid h-10 w-10 place-items-center text-slate-600 hover:bg-slate-50" aria-label={`Add one ${item.name}`}><Plus className="h-4 w-4" /></button>
            </div>
          </div>
        ))}

        {selectedCandidate && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Add a tip</p>
            <div className="grid grid-cols-4 gap-2">
              {[0, 10, 15, 20].map(percent => (
                <button key={percent} type="button" onClick={() => { setTipPercent(percent); setCustomTip(''); }} className={`min-h-11 rounded-xl border px-2 text-sm font-bold transition ${tipPercent === percent && !customTip ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
                  {percent === 0 ? 'None' : `${percent}%`}
                </button>
              ))}
            </div>
            <div className="relative mt-2">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-slate-400">£</span>
              <input inputMode="decimal" value={customTip} onChange={event => { setCustomTip(event.target.value.replace(/[^0-9.]/g, '')); setTipPercent(0); }} placeholder="Custom tip" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-white px-5 py-5">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-slate-500"><span>Service</span><span>{money(serverTotals?.serviceAmountInCents || localServiceAmount, currency)}</span></div>
          {(serverTotals?.retailAmountInCents || localRetailAmount) > 0 && <div className="flex justify-between text-slate-500"><span>Products</span><span>{money(serverTotals?.retailAmountInCents || localRetailAmount, currency)}</span></div>}
          {(serverTotals?.tipAmountInCents || tipAmountInCents) > 0 && <div className="flex justify-between text-slate-500"><span>Tip</span><span>{money(serverTotals?.tipAmountInCents || tipAmountInCents, currency)}</span></div>}
          <div className="flex items-end justify-between border-t border-slate-100 pt-3"><span className="font-bold text-slate-700">Total</span><span className="text-3xl font-black tracking-tight text-slate-950">{money(grandTotal, currency)}</span></div>
        </div>

        {!config?.stripe.ready && (
          <div className="mt-4 flex gap-2 rounded-xl bg-amber-50 p-3 text-xs font-medium text-amber-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Stripe Connect must be ready before taking a POS payment.</div>
        )}

        <button type="button" onClick={openPayment} disabled={!selectedAppointmentId || !serverTotals || isPreviewing || !config?.stripe.ready} className="mt-4 flex min-h-14 w-full items-center justify-between rounded-2xl bg-indigo-600 px-5 text-base font-black text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">
          <span>{isPreviewing ? 'Updating total…' : `Take ${money(grandTotal, currency)}`}</span>
          {isPreviewing ? <Loader2 className="h-5 w-5 animate-spin" /> : <ChevronRight className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-[680px] overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white"><ShoppingBag className="h-5 w-5" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-black text-slate-950">Point of sale</h1>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600">{config?.plan?.name || 'Core'}</span>
            </div>
            <p className="text-xs text-slate-500">{tenant.name}</p>
          </div>
        </div>

        <div className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold ${config?.stripe.ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {config?.stripe.ready ? <ShieldCheck className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {config?.stripe.ready ? `Stripe connected ${config.stripe.accountIdMasked || ''}` : 'Stripe needs attention'}
        </div>
      </header>

      {error && !paymentOpen && (
        <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 sm:mx-6">
          <div className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>
          <button type="button" onClick={() => setError('')} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-rose-100" aria-label="Dismiss error"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_390px]">
        <main className="space-y-6 p-4 pb-28 sm:p-6 sm:pb-28 lg:pb-6">
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-500">Step 1</p><h2 className="mt-1 text-xl font-black text-slate-950">Choose the appointment</h2></div>
              <span className="text-xs font-semibold text-slate-400">{candidates.length} ready</span>
            </div>

            <div className="relative mb-3">
              <Search className="pointer-events-none absolute inset-y-0 left-4 my-auto h-5 w-5 text-slate-400" />
              <input value={appointmentSearch} onChange={event => setAppointmentSearch(event.target.value)} placeholder="Search customer, service or staff" className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-sm font-medium text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" />
            </div>

            {filteredCandidates.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredCandidates.map(candidate => {
                  const selected = candidate.appointmentId === selectedAppointmentId;
                  return (
                    <button key={candidate.appointmentId} type="button" onClick={() => setSelectedAppointmentId(candidate.appointmentId)} className={`min-h-[128px] rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-4 focus:ring-indigo-100 ${selected ? 'border-indigo-600 bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'border-slate-200 bg-white text-slate-900 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm'}`}>
                      <div className="flex items-start justify-between gap-3"><div className={`grid h-10 w-10 place-items-center rounded-xl ${selected ? 'bg-white/15' : 'bg-slate-100 text-slate-600'}`}><UserRound className="h-5 w-5" /></div>{selected && <CheckCircle2 className="h-5 w-5" />}</div>
                      <p className="mt-3 truncate text-sm font-black">{candidate.clientName || 'Walk-in customer'}</p>
                      <div className={`mt-1 flex items-center justify-between gap-3 text-xs ${selected ? 'text-indigo-100' : 'text-slate-500'}`}><span className="truncate">{candidate.serviceName || 'Custom service'}</span><span className="shrink-0 font-bold">{money(candidate.quotedAmount, currency)}</span></div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><ReceiptText className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-bold text-slate-700">No appointments are ready for checkout</p><p className="mt-1 text-sm text-slate-500">Completed, cancelled and already-paid appointments are excluded.</p></div>
            )}
          </section>

          {config?.inventoryEnabled ? (
            <section>
              <div className="mb-3 flex items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-500">Optional</p><h2 className="mt-1 text-xl font-black text-slate-950">Add retail products</h2></div><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">£197+ inventory</span></div>
              <div className="relative mb-3"><Search className="pointer-events-none absolute inset-y-0 left-4 my-auto h-5 w-5 text-slate-400" /><input value={productSearch} onChange={event => setProductSearch(event.target.value)} placeholder="Search products" className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-sm font-medium text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" /></div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredProducts.map(product => (
                  <button key={product.id} type="button" onClick={() => addProduct(product)} disabled={product.stockQuantity < 1} className="group flex min-h-[104px] items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-600 transition group-hover:bg-indigo-50 group-hover:text-indigo-600"><Package className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900">{product.name}</p><div className="mt-1 flex items-center justify-between gap-2 text-xs"><span className="text-slate-400">{product.stockQuantity} in stock</span><span className="font-black text-slate-800">{money(product.priceInCents, currency)}</span></div></div>
                    <Plus className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:text-indigo-600" />
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-600"><Sparkles className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1"><p className="text-sm font-black text-slate-900">Core stays simple for service businesses</p><p className="mt-1 text-xs leading-5 text-slate-500">Products, stock, barcodes and inventory are completely hidden on Core. They are available from {money(config?.inventoryFromPriceMinor || 19700, 'GBP')}.</p></div>
            </section>
          )}
        </main>

        <aside className="hidden min-h-[680px] border-l border-slate-200 bg-white lg:block"><BasketContents /></aside>
      </div>

      <div className="fixed inset-x-3 bottom-3 z-30 lg:hidden">
        <button type="button" onClick={() => setBasketOpen(true)} className="flex min-h-16 w-full items-center justify-between rounded-2xl bg-slate-950 px-5 text-white shadow-2xl shadow-slate-400/40">
          <div className="flex items-center gap-3 text-left"><div className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><ShoppingBag className="h-5 w-5" /></div><div><p className="text-xs font-semibold text-slate-300">{selectedAppointmentId ? `${1 + cart.reduce((sum, item) => sum + item.quantity, 0)} items` : 'Build a sale'}</p><p className="font-black">View basket</p></div></div>
          <span className="text-xl font-black">{money(grandTotal, currency)}</span>
        </button>
      </div>

      {basketOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm lg:hidden" role="dialog" aria-modal="true" aria-label="Current sale"><div className="absolute inset-x-0 bottom-0 max-h-[92vh] min-h-[70vh] overflow-hidden rounded-t-3xl bg-white shadow-2xl"><BasketContents mobile /></div></div>
      )}

      {paymentOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-end bg-slate-950/50 p-0 backdrop-blur-sm sm:place-items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="payment-title">
          <div className="max-h-[96vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-3xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:px-6">
              <div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-500">Stripe payment</p><h2 id="payment-title" className="mt-1 text-xl font-black text-slate-950">Take {money(grandTotal, currency)}</h2></div>
              <button type="button" onClick={() => paymentStage === 'choose' || paymentStage === 'instructions' ? setPaymentOpen(false) : undefined} disabled={paymentStage === 'sending' || paymentStage === 'waiting' || paymentStage === 'finalising'} className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Close payment"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-5 p-5 sm:p-6">
              {error && (
                <div className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><div className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div><button type="button" onClick={() => setError('')} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-rose-100" aria-label="Dismiss error"><X className="h-4 w-4" /></button></div>
              )}

              {paymentStage === 'choose' && (
                <>
                  <div><h3 className="font-black text-slate-950">How will the customer pay?</h3><p className="mt-1 text-sm text-slate-500">All card payments use the business's existing Stripe Connect account.</p></div>

                  <div className="space-y-3">
                    <button type="button" onClick={() => setPaymentChoice('READER')} disabled={onlineReaders.length === 0} className={`flex min-h-[92px] w-full items-center gap-4 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${paymentChoice === 'READER' ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'}`}>
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-white"><CreditCard className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-black text-slate-900">Send to Stripe Terminal</p><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">Automatic</span></div><p className="mt-1 text-xs leading-5 text-slate-500">The POS sends the exact amount to a supported online Stripe reader and confirms it directly with Stripe.</p></div>{paymentChoice === 'READER' && <CheckCircle2 className="h-5 w-5 shrink-0 text-indigo-600" />}
                    </button>
                    <button type="button" onClick={() => setPaymentChoice('TAP_TO_PAY')} className={`flex min-h-[92px] w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${paymentChoice === 'TAP_TO_PAY' ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'}`}>
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white"><Smartphone className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="font-black text-slate-900">Tap to Pay in Stripe</p><p className="mt-1 text-xs leading-5 text-slate-500">Enter the displayed amount in the Stripe Dashboard mobile app, take the contactless payment, then confirm it here.</p></div>{paymentChoice === 'TAP_TO_PAY' && <CheckCircle2 className="h-5 w-5 shrink-0 text-indigo-600" />}
                    </button>
                    <button type="button" onClick={() => setPaymentChoice('MANUAL_TERMINAL')} className={`flex min-h-[92px] w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${paymentChoice === 'MANUAL_TERMINAL' ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'}`}>
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-700"><Radio className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="font-black text-slate-900">Enter amount on Stripe terminal</p><p className="mt-1 text-xs leading-5 text-slate-500">Use this when the terminal is not available for automatic handoff. Type the amount on the Stripe device and confirm success here.</p></div>{paymentChoice === 'MANUAL_TERMINAL' && <CheckCircle2 className="h-5 w-5 shrink-0 text-indigo-600" />}
                    </button>
                  </div>

                  {paymentChoice === 'READER' && onlineReaders.length > 0 && (
                    <div><label htmlFor="stripe-reader" className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">Stripe reader</label><div className="flex gap-2"><select id="stripe-reader" value={selectedReaderId} onChange={event => setSelectedReaderId(event.target.value)} className="min-h-12 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100">{onlineReaders.map(reader => <option key={reader.id} value={reader.id}>{reader.label}</option>)}</select><button type="button" onClick={() => void loadReaders()} className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label="Refresh readers"><RefreshCw className="h-4 w-4" /></button></div></div>
                  )}

                  <button type="button" onClick={() => setPaymentStage('instructions')} disabled={paymentChoice === 'READER' && !selectedReaderId} className="flex min-h-14 w-full items-center justify-between rounded-2xl bg-indigo-600 px-5 text-base font-black text-white transition hover:bg-indigo-700 disabled:bg-slate-300">Continue<ChevronRight className="h-5 w-5" /></button>
                </>
              )}

              {paymentStage === 'instructions' && paymentChoice === 'READER' && (
                <>
                  <button type="button" onClick={() => setPaymentStage('choose')} className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-bold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" />Change method</button>
                  <div className="rounded-3xl bg-slate-950 p-6 text-white"><div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10"><Wifi className="h-5 w-5" /></div><div><p className="text-sm font-semibold text-slate-300">Ready to send</p><p className="font-black">{onlineReaders.find(reader => reader.id === selectedReaderId)?.label || 'Stripe Terminal'}</p></div></div><p className="mt-8 text-sm text-slate-300">Customer total</p><p className="mt-1 text-5xl font-black tracking-tight">{money(grandTotal, currency)}</p><p className="mt-5 text-xs leading-5 text-slate-400">The amount will be created on the connected Stripe account and sent securely to the reader. Do not start a second payment while it is processing.</p></div>
                  <button type="button" onClick={() => void startReaderPayment()} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 text-base font-black text-white hover:bg-indigo-700"><CreditCard className="h-5 w-5" />Send to reader</button>
                </>
              )}

              {paymentStage === 'instructions' && paymentChoice !== 'READER' && (
                <>
                  <button type="button" onClick={() => setPaymentStage('choose')} className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-bold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" />Change method</button>
                  <div className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 p-6 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-600 text-white">{paymentChoice === 'TAP_TO_PAY' ? <Smartphone className="h-6 w-6" /> : <CreditCard className="h-6 w-6" />}</div><p className="mt-4 text-sm font-bold text-indigo-700">Enter this exact amount in Stripe</p><p className="mt-2 text-5xl font-black tracking-tight text-slate-950">{money(grandTotal, currency)}</p><button type="button" onClick={() => void copyAmount()} className="mx-auto mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 text-sm font-bold text-indigo-700 hover:bg-indigo-50"><Copy className="h-4 w-4" />Copy amount</button></div>
                  <div className="rounded-2xl border border-slate-200 p-4"><p className="font-black text-slate-900">{paymentChoice === 'TAP_TO_PAY' ? 'In the Stripe Dashboard mobile app' : 'On the Stripe terminal'}</p><ol className="mt-3 space-y-3 text-sm text-slate-600">{(paymentChoice === 'TAP_TO_PAY' ? ['Open the Stripe Dashboard mobile app.', 'Start a new card charge and enter the amount shown above.', 'Choose Tap to Pay and let the customer tap their card or phone.', 'Wait until Stripe displays a successful payment.'] : ['Start a new payment on the Stripe terminal.', 'Enter the amount shown above.', 'Let the customer pay by card or contactless.', 'Wait until the terminal displays a successful payment.']).map((instruction, index) => <li key={instruction} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-black text-slate-600">{index + 1}</span><span className="pt-0.5">{instruction}</span></li>)}</ol></div>
                  <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${manualConfirmed ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}><input type="checkbox" checked={manualConfirmed} onChange={event => setManualConfirmed(event.target.checked)} className="mt-1 h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /><span><span className="block font-black text-slate-900">Stripe shows the payment as successful</span><span className="mt-1 block text-xs leading-5 text-slate-500">Only confirm after Stripe has approved the payment. This records a staff-confirmed Stripe sale.</span></span></label>
                  <div><label htmlFor="stripe-reference" className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-400">Stripe reference (optional)</label><input id="stripe-reference" value={manualReference} onChange={event => setManualReference(event.target.value)} placeholder="Payment or receipt reference" className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" /></div>
                  <button type="button" onClick={() => void confirmManualStripePayment()} disabled={!manualConfirmed} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-base font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"><Check className="h-5 w-5" />Confirm purchase</button>
                </>
              )}

              {(paymentStage === 'sending' || paymentStage === 'waiting' || paymentStage === 'finalising') && (
                <div className="py-10 text-center"><div className="relative mx-auto h-20 w-20"><div className="absolute inset-0 animate-ping rounded-full bg-indigo-100" /><div className="relative grid h-20 w-20 place-items-center rounded-full bg-indigo-600 text-white shadow-xl shadow-indigo-200">{paymentStage === 'waiting' ? <Wifi className="h-8 w-8" /> : <Loader2 className="h-8 w-8 animate-spin" />}</div></div><h3 className="mt-6 text-xl font-black text-slate-950">{paymentStage === 'sending' ? 'Connecting to Stripe' : paymentStage === 'waiting' ? 'Present card on reader' : 'Completing sale'}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{paymentMessage}</p>{paymentStage === 'waiting' && <div className="mx-auto mt-6 flex max-w-md items-start gap-2 rounded-2xl bg-amber-50 p-4 text-left text-xs leading-5 text-amber-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Do not refresh or start another payment. If the connection drops, this POS will keep checking the same Stripe payment safely.</div>}</div>
              )}

              {paymentMessage && paymentStage === 'instructions' && <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{paymentMessage}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
