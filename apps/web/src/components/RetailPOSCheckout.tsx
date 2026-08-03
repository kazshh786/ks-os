import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Loader2,
  Minus,
  Package,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  WalletCards,
  X,
} from 'lucide-react';
import type {
  PosConfig,
  PosStripeOnlinePaymentSession,
  PosStripeOnlinePaymentStatus,
  PosStripePaymentStatus,
  PosStripeReader,
  Product,
  RetailSaleCheckoutResponse,
  RetailSalePreviewResponse,
  RetailSaleSummary,
} from '@ks-os/contracts';
import type { BusinessTenant } from '../data/types.js';
import { fetchWithAuth } from '../api/client.js';
import { EmbeddedPosCheckout, PaymentLinkPanel } from './PosOnlinePayment.js';

interface RetailPOSCheckoutProps {
  tenant: BusinessTenant;
  onCheckoutCompleted: () => void;
}

type PaymentChoice = 'READER' | 'ONLINE' | 'PAYMENT_LINK' | 'TAP_TO_PAY' | 'MANUAL_TERMINAL';
type PaymentStage = 'choose' | 'sending' | 'waiting' | 'instructions' | 'online' | 'finalising';

type CartItem = Product & { quantity: number };

type PendingSale = {
  paymentIntentId: string;
  idempotencyKey: string;
};

const safeJson = async (response: Response) => response.json().catch(() => ({}));

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithAuth(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = await safeJson(response);
  if (!response.ok) throw new Error(body?.error?.message || 'The request could not be completed.');
  return body as T;
}

const money = (amountInCents: number, currency = 'GBP') => new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency,
}).format(amountInCents / 100);

export default function RetailPOSCheckout({ tenant, onCheckoutCompleted }: RetailPOSCheckoutProps) {
  const [config, setConfig] = useState<PosConfig | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [readers, setReaders] = useState<PosStripeReader[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedReaderId, setSelectedReaderId] = useState('');
  const [totals, setTotals] = useState<RetailSalePreviewResponse['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');
  const [basketOpen, setBasketOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>('READER');
  const [paymentStage, setPaymentStage] = useState<PaymentStage>('choose');
  const [paymentMessage, setPaymentMessage] = useState('');
  const [manualConfirmed, setManualConfirmed] = useState(false);
  const [manualReference, setManualReference] = useState('');
  const [onlineSession, setOnlineSession] = useState<PosStripeOnlinePaymentSession | null>(null);
  const [completedSale, setCompletedSale] = useState<RetailSaleSummary | null>(null);

  const mountedRef = useRef(true);
  const finalisingRef = useRef(false);
  const idempotencyRef = useRef(crypto.randomUUID());

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const purchasedProducts = useMemo(() => cart.map(item => ({
    productId: item.id,
    quantity: item.quantity,
  })), [cart]);

  const currency = config?.plan?.currency || tenant.currency || 'GBP';
  const onlineReaders = readers.filter(reader => reader.online && reader.supportsServerDriven);
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const localTotal = cart.reduce((total, item) => total + item.priceInCents * item.quantity, 0);
  const grandTotal = totals?.grandTotalInCents ?? localTotal;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const configResponse = await request<{ success: true; data: PosConfig }>('/api/v1/pos/config');
      if (!mountedRef.current) return;
      setConfig(configResponse.data);

      if (!configResponse.data.inventoryEnabled) {
        setProducts([]);
        return;
      }

      const [productResponse, readerResponse] = await Promise.all([
        request<{ success: true; data: Product[] }>('/api/v1/products?limit=100&inStockOnly=true'),
        configResponse.data.stripe.ready
          ? request<{ success: true; data: PosStripeReader[] }>('/api/v1/pos/stripe/readers').catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!mountedRef.current) return;
      setProducts(productResponse.data);
      if (readerResponse) {
        setReaders(readerResponse.data);
        const preferred = readerResponse.data.find(reader => reader.online && reader.supportsServerDriven);
        setSelectedReaderId(preferred?.id || '');
      }
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : 'The retail POS could not be loaded.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.id]);

  useEffect(() => {
    idempotencyRef.current = crypto.randomUUID();
  }, [purchasedProducts]);

  useEffect(() => {
    if (!purchasedProducts.length) {
      setTotals(null);
      return;
    }

    const timer = window.setTimeout(async () => {
      setPreviewing(true);
      setError('');
      try {
        const response = await request<RetailSalePreviewResponse>('/api/v1/pos/retail/preview', {
          method: 'POST',
          body: JSON.stringify({
            paymentMethod: 'STRIPE_TERMINAL',
            tipAmountInCents: 0,
            purchasedProducts,
          }),
        });
        if (mountedRef.current) setTotals(response.data);
      } catch (cause) {
        if (mountedRef.current) {
          setTotals(null);
          setError(cause instanceof Error ? cause.message : 'The retail total could not be calculated.');
        }
      } finally {
        if (mountedRef.current) setPreviewing(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [purchasedProducts]);

  const addProduct = (product: Product) => {
    setCart(current => {
      const existing = current.find(item => item.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stockQuantity) return current;
        return current.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      if (product.stockQuantity < 1) return current;
      return [...current, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(current => current.flatMap(item => {
      if (item.id !== productId) return [item];
      const next = item.quantity + delta;
      if (next <= 0) return [];
      if (next > item.stockQuantity) return [item];
      return [{ ...item, quantity: next }];
    }));
  };

  const finalise = async (
    stripePayment: {
      mode: 'AUTOMATED_TERMINAL' | 'ONLINE_CHECKOUT' | 'TAP_TO_PAY_MANUAL' | 'TERMINAL_MANUAL';
      paymentIntentId?: string;
      manuallyConfirmed?: boolean;
      manualReference?: string;
    },
    source?: PendingSale,
    paymentMethod: 'STRIPE_TERMINAL' | 'STRIPE_ONLINE' = 'STRIPE_TERMINAL',
  ) => {
    if (finalisingRef.current || !purchasedProducts.length) return;
    finalisingRef.current = true;
    setPaymentStage('finalising');
    setPaymentMessage('Confirming the retail sale…');
    setError('');

    try {
      const response = await request<RetailSaleCheckoutResponse>('/api/v1/pos/retail/checkout', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: source?.idempotencyKey || idempotencyRef.current,
          paymentMethod,
          tipAmountInCents: 0,
          purchasedProducts,
          stripePayment,
        }),
      });
      if (!mountedRef.current) return;
      setCompletedSale(response.data);
      setPaymentOpen(false);
      setBasketOpen(false);
      window.dispatchEvent(new CustomEvent('ks-inventory-updated'));
    } catch (cause) {
      if (mountedRef.current) {
        setPaymentStage('instructions');
        setError(cause instanceof Error ? cause.message : 'The retail sale could not be completed.');
      }
    } finally {
      finalisingRef.current = false;
    }
  };

  const pollPayment = async (pending: PendingSale) => {
    setPaymentStage('waiting');
    setPaymentMessage('Waiting for the customer to complete payment on the Stripe reader…');

    for (let attempt = 0; attempt < 120 && mountedRef.current; attempt += 1) {
      try {
        const response = await request<{ success: true; data: PosStripePaymentStatus }>(
          `/api/v1/pos/stripe/payment-intents/${encodeURIComponent(pending.paymentIntentId)}`,
        );
        if (response.data.succeeded) {
          setPaymentMessage('Payment approved. Completing the retail sale…');
          await finalise({
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
      } catch (cause) {
        setPaymentMessage(cause instanceof Error ? `${cause.message} Retrying safely…` : 'Checking Stripe again…');
      }
      await new Promise(resolve => window.setTimeout(resolve, 1500));
    }

    if (mountedRef.current) {
      setPaymentStage('instructions');
      setError('Stripe is still processing this payment. Check its status before starting another sale.');
    }
  };

  const startReaderPayment = async () => {
    if (!totals || !selectedReaderId || !purchasedProducts.length) return;
    setPaymentStage('sending');
    setPaymentMessage(`Sending ${money(totals.grandTotalInCents, currency)} to the Stripe reader…`);
    setError('');

    try {
      const idempotencyKey = idempotencyRef.current;
      const response = await request<{
        success: true;
        data: { paymentIntentId: string };
      }>('/api/v1/pos/retail/stripe/payment-intents', {
        method: 'POST',
        body: JSON.stringify({
          readerId: selectedReaderId,
          idempotencyKey,
          tipAmountInCents: 0,
          purchasedProducts,
        }),
      });
      await pollPayment({ paymentIntentId: response.data.paymentIntentId, idempotencyKey });
    } catch (cause) {
      setPaymentStage('instructions');
      setError(cause instanceof Error ? cause.message : 'The reader payment could not be started.');
    }
  };


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

  const openPayment = () => {
    if (!totals || !config?.stripe.ready || !purchasedProducts.length) return;
    setPaymentChoice(onlineReaders.length ? 'READER' : config.stripe.onlinePaymentsReady ? 'ONLINE' : 'TAP_TO_PAY');
    setPaymentStage('choose');
    setPaymentMessage('');
    setManualConfirmed(false);
    setManualReference('');
    setOnlineSession(null);
    setError('');
    setPaymentOpen(true);
  };

  const resetSale = async () => {
    setCompletedSale(null);
    setCart([]);
    setTotals(null);
    setManualConfirmed(false);
    setManualReference('');
    setOnlineSession(null);
    idempotencyRef.current = crypto.randomUUID();
    await load();
  };

  const filteredProducts = products.filter(product => {
    const query = search.trim().toLowerCase();
    return !query || `${product.name} ${product.sku}`.toLowerCase().includes(query);
  });

  if (loading) {
    return <div className="grid min-h-[560px] place-items-center rounded-3xl border border-slate-200 bg-white"><div className="text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-600" /><p className="mt-3 text-sm font-semibold text-slate-700">Opening retail POS…</p></div></div>;
  }

  if (completedSale) {
    return <div className="min-h-[560px] rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-8"><div className="mx-auto max-w-xl overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-sm"><div className="bg-emerald-50 px-6 py-8 text-center"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-200"><Check className="h-8 w-8" strokeWidth={3} /></div><h1 className="mt-4 text-2xl font-black text-slate-950">Retail payment confirmed</h1><p className="mt-1 text-sm text-slate-600">The product sale is complete and stock has been updated.</p><p className="mt-5 text-4xl font-black tracking-tight text-slate-950">{money(completedSale.calculation.grandTotalInCents, currency)}</p></div><div className="space-y-5 p-6"><div className="flex items-center justify-between border-b border-slate-100 pb-4 text-sm"><div><p className="font-bold text-slate-900">{completedSale.customerLabel}</p><p className="text-slate-500">Standalone retail sale</p></div><div className="text-right"><p className="font-semibold text-slate-800">Stripe</p><p className="font-mono text-xs text-slate-400">{completedSale.transactionId.slice(0, 8)}</p></div></div><div className="space-y-3">{completedSale.items.map((item, index) => <div key={`${item.name}-${index}`} className="flex items-center justify-between text-sm"><div><p className="font-semibold text-slate-800">{item.name}</p>{item.quantity > 1 && <p className="text-xs text-slate-400">Quantity {item.quantity}</p>}</div><p className="font-bold text-slate-900">{money(item.totalInCents, currency)}</p></div>)}</div><button type="button" onClick={() => void resetSale()} className="min-h-12 w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white">New retail sale</button><button type="button" onClick={onCheckoutCompleted} className="min-h-11 w-full rounded-2xl px-5 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-100">Back to inventory</button></div></div></div>;
  }

  const Basket = ({ mobile = false }: { mobile?: boolean }) => <div className="flex h-full flex-col"><div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Current sale</p><h2 className="mt-1 text-lg font-black text-slate-950">Walk-in retail customer</h2></div>{mobile && <button type="button" onClick={() => setBasketOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Close basket"><X className="h-5 w-5" /></button>}</div><div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">{cart.length ? cart.map(item => <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><Package className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900">{item.name}</p><p className="text-xs text-slate-500">{money(item.priceInCents, currency)} each</p></div><div className="flex items-center rounded-xl border border-slate-200"><button type="button" onClick={() => updateQuantity(item.id, -1)} className="grid h-10 w-10 place-items-center" aria-label={`Remove one ${item.name}`}><Minus className="h-4 w-4" /></button><span className="w-7 text-center text-sm font-bold">{item.quantity}</span><button type="button" onClick={() => updateQuantity(item.id, 1)} className="grid h-10 w-10 place-items-center" aria-label={`Add one ${item.name}`}><Plus className="h-4 w-4" /></button></div></div>) : <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center"><ShoppingBag className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-bold text-slate-700">Your basket is empty</p><p className="mt-1 text-sm text-slate-500">Add products to take payment without a booking.</p></div>}</div><div className="border-t border-slate-200 bg-white px-5 py-5"><div className="flex items-end justify-between"><span className="font-bold text-slate-700">Total</span><span className="text-3xl font-black tracking-tight text-slate-950">{money(grandTotal, currency)}</span></div>{!config?.stripe.ready && <div className="mt-4 flex gap-2 rounded-xl bg-amber-50 p-3 text-xs font-medium text-amber-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Stripe Connect must be ready before taking a POS payment.</div>}<button type="button" onClick={openPayment} disabled={!cart.length || !totals || previewing || !config?.stripe.ready} className="mt-4 flex min-h-14 w-full items-center justify-between rounded-2xl bg-indigo-600 px-5 text-base font-black text-white shadow-lg shadow-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"><span>{previewing ? 'Updating total…' : `Take ${money(grandTotal, currency)}`}</span>{previewing ? <Loader2 className="h-5 w-5 animate-spin" /> : <ChevronRight className="h-5 w-5" />}</button></div></div>;

  return <div className="relative min-h-[680px] overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 font-sans"><header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-6"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white"><ShoppingBag className="h-5 w-5" /></div><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-black text-slate-950">Retail sale</h1><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-indigo-700">No booking needed</span></div><p className="text-xs text-slate-500">{tenant.name}</p></div></div><div className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold ${config?.stripe.ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{config?.stripe.ready ? <ShieldCheck className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{config?.stripe.ready ? 'Stripe connected' : 'Stripe needs attention'}</div></header>{error && !paymentOpen && <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 sm:mx-6"><div className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div><button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X className="h-4 w-4" /></button></div>}<div className="grid lg:grid-cols-[minmax(0,1fr)_390px]"><main className="space-y-5 p-4 pb-28 sm:p-6 sm:pb-28 lg:pb-6"><section><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-500">Products</p><h2 className="mt-1 text-xl font-black text-slate-950">Build a retail basket</h2><p className="mt-1 text-sm text-slate-500">Select products and take payment immediately. No appointment or customer record is required.</p></div><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700"><RefreshCw className="h-4 w-4" />Refresh</button></div><div className="relative mb-3"><Search className="pointer-events-none absolute inset-y-0 left-4 my-auto h-5 w-5 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search products or SKU" className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-sm font-medium outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" /></div>{config?.inventoryEnabled ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filteredProducts.map(product => <button key={product.id} type="button" onClick={() => addProduct(product)} disabled={product.stockQuantity < 1} className="group flex min-h-[104px] items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-600"><Package className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900">{product.name}</p><p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{product.sku}</p><div className="mt-1 flex items-center justify-between gap-2 text-xs"><span className="text-slate-400">{product.stockQuantity} in stock</span><span className="font-black text-slate-800">{money(product.priceInCents, currency)}</span></div></div><Plus className="h-5 w-5 shrink-0 text-slate-300 group-hover:text-indigo-600" /></button>)}</div> : <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Standalone retail sales require the inventory feature on this workspace.</div>}{config?.inventoryEnabled && !filteredProducts.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><Package className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-bold text-slate-700">No products found</p><p className="mt-1 text-sm text-slate-500">Add or restock products from Inventory.</p></div>}</section></main><aside className="hidden min-h-[680px] border-l border-slate-200 bg-white lg:block"><Basket /></aside></div><div className="fixed inset-x-3 bottom-3 z-30 lg:hidden"><button type="button" onClick={() => setBasketOpen(true)} className="flex min-h-16 w-full items-center justify-between rounded-2xl bg-slate-950 px-5 text-white shadow-2xl"><div className="flex items-center gap-3 text-left"><div className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><ShoppingBag className="h-5 w-5" /></div><div><p className="text-xs font-semibold text-slate-300">{itemCount ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : 'Build a sale'}</p><p className="font-black">View basket</p></div></div><span className="text-xl font-black">{money(grandTotal, currency)}</span></button></div>{basketOpen && <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm lg:hidden" role="dialog" aria-modal="true" aria-label="Retail basket"><div className="absolute inset-x-0 bottom-0 max-h-[92vh] min-h-[70vh] overflow-hidden rounded-t-3xl bg-white shadow-2xl"><Basket mobile /></div></div>}{paymentOpen && <div className="fixed inset-0 z-[140] grid place-items-end bg-slate-950/50 backdrop-blur-sm sm:place-items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Take retail payment"><div className="max-h-[96vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-3xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-500">Stripe payment</p><h2 className="mt-1 text-xl font-black text-slate-950">Take {money(grandTotal, currency)}</h2></div><button type="button" onClick={() => ['choose', 'instructions'].includes(paymentStage) ? setPaymentOpen(false) : undefined} disabled={['sending', 'waiting', 'online', 'finalising'].includes(paymentStage)} className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 disabled:opacity-30" aria-label="Close payment"><X className="h-5 w-5" /></button></div><div className="space-y-5 p-5 sm:p-6">{error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">{error}</div>}{paymentStage === 'choose' && <><div><h3 className="font-black text-slate-950">How will the customer pay?</h3><p className="mt-1 text-sm text-slate-500">The amount is calculated from live product prices and stock.</p></div><div className="space-y-3"><button type="button" onClick={() => setPaymentChoice('READER')} disabled={!onlineReaders.length} className={`flex min-h-[88px] w-full items-center gap-4 rounded-2xl border p-4 text-left disabled:opacity-50 ${paymentChoice === 'READER' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200'}`}><div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-600 text-white"><CreditCard className="h-5 w-5" /></div><div className="flex-1"><p className="font-black">Send to Stripe Terminal</p><p className="mt-1 text-xs text-slate-500">Send the exact retail total to an online reader.</p></div>{paymentChoice === 'READER' && <CheckCircle2 className="h-5 w-5 text-indigo-600" />}</button><button type="button" onClick={() => setPaymentChoice('ONLINE')} disabled={!config?.stripe.onlinePaymentsReady} className={`flex min-h-[88px] w-full items-center gap-4 rounded-2xl border p-4 text-left disabled:opacity-50 ${paymentChoice === 'ONLINE' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200'}`}><div className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-600 text-white"><WalletCards className="h-5 w-5" /></div><div className="flex-1"><p className="font-black">Pay on this screen</p><p className="mt-1 text-xs text-slate-500">Open Stripe's secure card form with the exact retail total.</p></div>{paymentChoice === 'ONLINE' && <CheckCircle2 className="h-5 w-5 text-indigo-600" />}</button><button type="button" onClick={() => setPaymentChoice('PAYMENT_LINK')} disabled={!config?.stripe.onlinePaymentsReady} className={`flex min-h-[88px] w-full items-center gap-4 rounded-2xl border p-4 text-left disabled:opacity-50 ${paymentChoice === 'PAYMENT_LINK' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200'}`}><div className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan-600 text-white"><QrCode className="h-5 w-5" /></div><div className="flex-1"><p className="font-black">Payment link or QR code</p><p className="mt-1 text-xs text-slate-500">Let the customer pay securely on their own phone.</p></div>{paymentChoice === 'PAYMENT_LINK' && <CheckCircle2 className="h-5 w-5 text-indigo-600" />}</button><button type="button" onClick={() => setPaymentChoice('TAP_TO_PAY')} className={`flex min-h-[88px] w-full items-center gap-4 rounded-2xl border p-4 text-left ${paymentChoice === 'TAP_TO_PAY' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200'}`}><div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-white"><Smartphone className="h-5 w-5" /></div><div className="flex-1"><p className="font-black">Tap to Pay in Stripe</p><p className="mt-1 text-xs text-slate-500">Take payment in Stripe, then confirm it here.</p></div>{paymentChoice === 'TAP_TO_PAY' && <CheckCircle2 className="h-5 w-5 text-indigo-600" />}</button><button type="button" onClick={() => setPaymentChoice('MANUAL_TERMINAL')} className={`flex min-h-[88px] w-full items-center gap-4 rounded-2xl border p-4 text-left ${paymentChoice === 'MANUAL_TERMINAL' ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200'}`}><div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-700"><CreditCard className="h-5 w-5" /></div><div className="flex-1"><p className="font-black">Standalone Stripe terminal</p><p className="mt-1 text-xs text-slate-500">Enter the amount manually on your terminal.</p></div>{paymentChoice === 'MANUAL_TERMINAL' && <CheckCircle2 className="h-5 w-5 text-indigo-600" />}</button></div><button type="button" onClick={() => { if (paymentChoice === 'READER') void startReaderPayment(); else if (paymentChoice === 'ONLINE') void startOnlinePayment('EMBEDDED'); else if (paymentChoice === 'PAYMENT_LINK') void startOnlinePayment('HOSTED'); else setPaymentStage('instructions'); }} className="flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 font-black text-white">Continue <ChevronRight className="h-5 w-5" /></button></>}{paymentStage === 'online' && onlineSession && paymentChoice === 'ONLINE' && <><div className="rounded-2xl bg-indigo-50 px-4 py-3 text-center"><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Secure online payment</p><p className="mt-1 text-sm font-semibold text-slate-700">The exact {money(grandTotal, currency)} total was sent to Stripe automatically.</p></div><EmbeddedPosCheckout session={onlineSession} /><div className="flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600"><Loader2 className="h-4 w-4 animate-spin text-indigo-600" />{paymentMessage}</div></>}{paymentStage === 'online' && onlineSession && paymentChoice === 'PAYMENT_LINK' && <PaymentLinkPanel session={onlineSession} message={paymentMessage} />}{paymentStage === 'instructions' && (paymentChoice === 'TAP_TO_PAY' || paymentChoice === 'MANUAL_TERMINAL') && <><div className="rounded-2xl bg-slate-950 p-6 text-center text-white"><p className="text-sm text-slate-300">Enter this exact amount in Stripe</p><p className="mt-2 text-4xl font-black">{money(grandTotal, currency)}</p></div><label className="block text-sm font-bold">Stripe reference (optional)<input value={manualReference} onChange={event => setManualReference(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><label className="flex items-start gap-3 rounded-2xl border border-slate-200 p-4"><input type="checkbox" checked={manualConfirmed} onChange={event => setManualConfirmed(event.target.checked)} className="mt-1 h-5 w-5" /><span><span className="block font-black text-slate-900">Payment succeeded in Stripe</span><span className="mt-1 block text-xs text-slate-500">Only confirm after Stripe shows the payment as successful.</span></span></label><button type="button" disabled={!manualConfirmed} onClick={() => void finalise({ mode: paymentChoice === 'TAP_TO_PAY' ? 'TAP_TO_PAY_MANUAL' : 'TERMINAL_MANUAL', manuallyConfirmed: true, manualReference: manualReference.trim() || undefined })} className="min-h-13 w-full rounded-2xl bg-indigo-600 px-5 py-3 font-black text-white disabled:bg-slate-300">Confirm retail payment</button></>}{['sending', 'waiting', 'finalising'].includes(paymentStage) && <div className="py-10 text-center"><Loader2 className="mx-auto h-10 w-10 animate-spin text-indigo-600" /><p className="mt-4 font-black text-slate-900">{paymentMessage}</p><p className="mt-2 text-sm text-slate-500">Do not close this window or start another sale.</p></div>}</div></div></div>}</div>;
}
