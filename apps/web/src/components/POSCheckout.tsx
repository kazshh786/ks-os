/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Minus, CreditCard, DollarSign, Wallet, CheckCircle, Percent, Printer, Sparkles, RefreshCw, ShoppingCart, User, AlertTriangle, Calendar } from 'lucide-react';
import { BusinessTenant, POSItem } from '../data/types.js';
import { CheckoutCandidate, CheckoutPreviewResponse, Product } from '@ks-os/contracts';
import { getDataProvider } from '../data/data-provider.js';

interface POSCheckoutProps {
  tenant: BusinessTenant;
  preloadedBooking?: { id: string } | null;
  onCheckoutCompleted: () => void;
}

export default function POSCheckout({ tenant, preloadedBooking, onCheckoutCompleted }: POSCheckoutProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [candidates, setCandidates] = useState<CheckoutCandidate[]>([]);
  
  // Selected appointment state
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(preloadedBooking?.id || null);
  
  // Cart
  const [cart, setCart] = useState<POSItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Tip
  const [tipPercentage, setTipPercentage] = useState<number | 'custom' | null>(null);
  const [customTip, setCustomTip] = useState<string>('');

  // Payment Options
  // Payment Options
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'ExternalCard' | 'BankTransfer' | 'Other' | 'Split'>('ExternalCard');
  
  // External Provider Info
  const [externalProvider, setExternalProvider] = useState<string>('SUMUP');
  const [externalProviderName, setExternalProviderName] = useState<string>('');
  const [externalReference, setExternalReference] = useState<string>('');
  const [methodDescription, setMethodDescription] = useState<string>('');
  
  // Split payments editor
  const [splitComponents, setSplitComponents] = useState<any[]>([
    { id: '1', method: 'CASH', amount: '', provider: '', ref: '', customProvider: '', desc: '' },
    { id: '2', method: 'EXTERNAL_CARD', amount: '', provider: 'SUMUP', ref: '', customProvider: '', desc: '' }
  ]);

  // Server Authoritative Totals
  const [serverTotals, setServerTotals] = useState<CheckoutPreviewResponse['data'] | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Execution states
  const [checkoutState, setCheckoutState] = useState<'idle' | 'loading' | 'insufficient-stock' | 'invalid-split'>('idle');
  const [printedReceipt, setPrintedReceipt] = useState<any | null>(null);
  const [externalCardConfirmed, setExternalCardConfirmed] = useState(false);
  
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  // Reset confirmation when mode changes
  useEffect(() => {
    setExternalCardConfirmed(false);
  }, [paymentMode]);

  // Re-generate idempotencyKey if the basket configuration changes
  useEffect(() => {
    idempotencyKeyRef.current = crypto.randomUUID();
  }, [cart, tipPercentage, customTip, selectedAppointmentId, paymentMode, splitComponents, externalProvider, externalProviderName, externalReference, methodDescription]);

  useEffect(() => {
    const loadPOSData = async () => {
      try {
        const pListRes = await getDataProvider().searchProducts();
        setProducts(pListRes.data);

        if (!preloadedBooking) {
          const cListRes = await getDataProvider().getCheckoutAppointments();
          setCandidates(cListRes.data);
        } else {
          setSelectedAppointmentId(preloadedBooking.id);
        }
      } catch (e) {
        console.error('Failed to load POS data', e);
      }
    };
    
    loadPOSData();
  }, [tenant, preloadedBooking]);

  const addToCart = (item: Product) => {
    const existing = cart.find(c => c.id === item.id);
    if (existing) {
      if (existing.quantity >= item.stockQuantity) {
        alert('Cannot exceed available stock.');
        return;
      }
      setCart(cart.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      setCart([
        ...cart,
        {
          id: item.id,
          name: item.name,
          type: 'Product',
          price: item.priceInCents / 100,
          quantity: 1
        }
      ]);
    }
  };

  const updateQty = (id: string, delta: number) => {
    const updated = cart.map(c => {
      if (c.id === id) {
        const newQty = c.quantity + delta;
        
        // Stock check
        const p = products.find(prod => prod.id === id);
        if (p && newQty > p.stockQuantity) {
          alert('Cannot exceed available stock.');
          return c;
        }

        return newQty > 0 ? { ...c, quantity: newQty } : null;
      }
      return c;
    }).filter(Boolean) as POSItem[];
    setCart(updated);
  };

  const getTipAmountInCents = () => {
    if (tipPercentage === 'custom') {
      return Math.round((parseFloat(customTip) || 0) * 100);
    }
    if (tipPercentage && serverTotals) {
      // Calculate tip based on base totals locally before server confirm if needed
      // Actually, preview endpoint needs the tip amount. So we send it.
      // Wait, if it's a percentage, we need to know the subtotal.
      // Let's compute local subtotal to pass to preview
      const localSub = cart.reduce((sum, item) => sum + Math.round(item.price * 100 * item.quantity), 0);
      return Math.round(localSub * (tipPercentage / 100));
    }
    return 0;
  };

  // Preview checkout when cart, tip, or selected appointment changes
  useEffect(() => {
    if (!selectedAppointmentId) {
      setServerTotals(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsPreviewing(true);
      try {
        const payload = {
          appointmentId: selectedAppointmentId,
          paymentMethod: paymentMode.toUpperCase() as any,
          tipAmountInCents: getTipAmountInCents(),
          purchasedProducts: cart.filter(c => c.type === 'Product').map(c => ({
            productId: c.id,
            quantity: c.quantity
          }))
        };
        const res = await getDataProvider().previewCheckout(payload);
        setServerTotals(res.data);
      } catch (err: any) {
        console.error('Preview error:', err);
        setServerTotals(null);
      } finally {
        setIsPreviewing(false);
      }
    }, 500); // debounce

    return () => clearTimeout(timer);
  }, [cart, tipPercentage, customTip, selectedAppointmentId, paymentMode]);

  

  const handleCheckoutSubmit = async () => {
    if (!selectedAppointmentId || !serverTotals) return;
    
    const hasInsufficientStock = cart.some(c => {
      const p = products.find(prod => prod.id === c.id);
      return p && c.quantity > p.stockQuantity;
    });

    if (hasInsufficientStock) {
      setCheckoutState('insufficient-stock');
      return;
    }
    
    if (paymentMode === 'Split') {
      const totalProvided = splitComponents.reduce((sum, c) => sum + Math.round(parseFloat(c.amount || '0') * 100), 0);
      if (totalProvided !== serverTotals.grandTotalInCents) {
        setCheckoutState('invalid-split');
        return;
      }
    }

    setCheckoutState('loading');
    
    try {
      const finalMethod = ({ Cash: 'CASH', ExternalCard: 'EXTERNAL_CARD', BankTransfer: 'BANK_TRANSFER', Other: 'OTHER', Split: 'SPLIT' } as const)[paymentMode];

      const payload: any = {
        idempotencyKey: idempotencyKeyRef.current,
        appointmentId: selectedAppointmentId,
        paymentMethod: finalMethod,
        tipAmountInCents: serverTotals.tipAmountInCents,
        purchasedProducts: cart.filter(c => c.type === 'Product').map(c => ({
          productId: c.id,
          quantity: c.quantity
        })),
        paymentComponents: []
      };

      if (paymentMode === 'Split') {
        payload.paymentComponents = splitComponents.map(c => ({
          method: c.method,
          amountInCents: Math.round(parseFloat(c.amount || '0') * 100),
          externalProvider: c.method === 'EXTERNAL_CARD' ? c.provider : undefined,
          externalProviderName: c.method === 'EXTERNAL_CARD' && c.provider === 'OTHER' ? c.customProvider : (c.method === 'OTHER' ? c.customProvider : undefined),
          externalReference: c.ref || undefined,
          methodDescription: c.method === 'OTHER' ? c.desc : undefined
        })).filter((c: any) => c.amountInCents > 0);
      } else {
        const comp: any = {
          method: finalMethod.toUpperCase(),
          amountInCents: serverTotals.grandTotalInCents
        };
        if (paymentMode === 'ExternalCard') {
          comp.externalProvider = externalProvider;
          if (externalProvider === 'OTHER') comp.externalProviderName = externalProviderName;
          comp.externalReference = externalReference || undefined;
        } else if (paymentMode === 'Other') {
          comp.methodDescription = methodDescription;
          comp.externalProviderName = externalProviderName;
          comp.externalReference = externalReference || undefined;
        } else if (paymentMode === 'BankTransfer') {
          comp.externalReference = externalReference || undefined;
        }
        payload.paymentComponents = [comp];
      }

      const res = await getDataProvider().completeCheckout(payload);
      const summary = res.data;
      
      // Use Server-generated Receipt
      setPrintedReceipt(summary);
      setCheckoutState('idle');
      
      // Dispatch updates
      window.dispatchEvent(new CustomEvent('ks-bookings-updated'));
    } catch (error: any) {
      setCheckoutState('idle');
      alert('Checkout failed: ' + (error.message || 'Unknown error'));
    }
  };

  const handleClearReceipt = () => {
    setPrintedReceipt(null);
    setCart([]);
    setTipPercentage(null);
    setCustomTip('');
    setExternalCardConfirmed(false);
    setPaymentMode('ExternalCard');
    setSplitComponents([{ id: '1', method: 'CASH', amount: '', provider: '', ref: '', customProvider: '', desc: '' }, { id: '2', method: 'EXTERNAL_CARD', amount: '', provider: 'SUMUP', ref: '', customProvider: '', desc: '' }]);
    setExternalProvider('SUMUP');
    setExternalProviderName('');
    setExternalReference('');
    setMethodDescription('');
    if (!preloadedBooking) {
      setSelectedAppointmentId(null);
      getDataProvider().getCheckoutAppointments().then(res => setCandidates(res.data)).catch(console.error);
    }
    onCheckoutCompleted();
  };

  // Filters
  const searchResultsProducts = products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="bg-slate-100 rounded-3xl p-6 border border-slate-200/50 min-h-[500px] font-sans">
      {printedReceipt ? (
        /* High-Fidelity Receipt Drawer */
        <div className="max-w-md mx-auto bg-white rounded-3xl border border-slate-200 shadow-xl p-8 space-y-6">
          <div className="text-center border-b pb-5">
            <span className="text-xs font-black uppercase text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
              Checkout Successful
            </span>
            <h3 className="text-xl font-bold text-slate-900 mt-3">{tenant.name}</h3>
          </div>

          <div className="space-y-1.5 text-xs text-slate-500 font-medium">
            <div className="flex justify-between">
              <span>Transaction ID:</span>
              <span className="font-mono text-slate-800 font-bold">{printedReceipt.transactionId.split('-')[0]}</span>
            </div>
            <div className="flex justify-between">
              <span>Date / Time:</span>
              <span className="text-slate-800">{new Date(printedReceipt.date).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Client Name:</span>
              <span className="text-slate-800 font-bold">{printedReceipt.appointment.clientName || 'Walk-in'}</span>
            </div>
          </div>

          <div className="border-t border-b py-3 divide-y divide-slate-100 text-xs">
            {printedReceipt.items.map((item: any, idx: number) => (
              <div key={idx} className="py-2 flex justify-between">
                <div>
                  <p className="font-bold text-slate-800">{item.name}</p>
                  <p className="text-[10px] text-slate-400">Qty: {item.quantity} x £{(item.priceInCents / 100).toFixed(2)}</p>
                </div>
                <span className="font-bold text-slate-900">£{(item.totalInCents / 100).toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div className="space-y-2 text-xs border-b pb-4">
            <div className="flex justify-between text-slate-500">
              <span>Service Amount:</span>
              <span className="font-bold text-slate-800">£{(printedReceipt.calculation.serviceAmountInCents / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Retail Amount:</span>
              <span className="font-bold text-slate-800">£{(printedReceipt.calculation.retailAmountInCents / 100).toFixed(2)}</span>
            </div>
            {printedReceipt.calculation.tipAmountInCents > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>Employee Tip:</span>
                <span className="font-bold text-emerald-600">£{(printedReceipt.calculation.tipAmountInCents / 100).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-900 font-extrabold text-sm pt-2">
              <span>Grand Total:</span>
              <span>£{(printedReceipt.calculation.grandTotalInCents / 100).toFixed(2)}</span>
            </div>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-2xl text-xs space-y-2">
            <span className="text-[10px] font-bold text-slate-400 block uppercase">Payment summary</span>
            <div className="flex justify-between font-semibold">
              <span>Settled Mode:</span>
              <span className="text-indigo-700">{printedReceipt.paymentMethod}</span>
            </div>
            {printedReceipt.splitAmounts && (
              <>
                <div className="flex justify-between text-slate-600">
                  <span>Cash Portion:</span>
                  <span>£{(printedReceipt.splitAmounts.cashInCents / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>External Card Portion:</span>
                  <span>£{(printedReceipt.splitAmounts.cardInCents / 100).toFixed(2)}</span>
                </div>
              </>
            )}
            <div className="border-t pt-2 text-indigo-600 font-bold flex justify-between">
              <span>Status:</span>
              <span>{printedReceipt.paymentStatus}</span>
            </div>
          </div>

          <button
            onClick={handleClearReceipt}
            className="w-full bg-slate-950 hover:opacity-90 text-white text-xs font-bold py-3 rounded-2xl flex items-center justify-center gap-1.5 shadow"
          >
            <Printer className="w-4 h-4" /> Clear & Open Next Sale
          </button>
        </div>
      ) : (
        /* POS Main Screen split: catalog on left, register on right */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column: Product & Service Catalog Catalog (7 cols) */}
          <div className="lg:col-span-7 bg-white rounded-2xl p-5 border border-slate-200/60 shadow-sm flex flex-col h-[520px]">
            {!selectedAppointmentId ? (
              // Appointment Selection Mode
              <div className="flex flex-col h-full">
                 <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5 mb-4 border-b pb-3">
                  <Calendar className="w-4 h-4 text-indigo-600" /> Select Appointment to Checkout
                </h3>
                {candidates.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                    No active appointments awaiting checkout.
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-2">
                    {candidates.map(c => (
                      <div 
                        key={c.appointmentId} 
                        onClick={() => setSelectedAppointmentId(c.appointmentId)}
                        className="p-4 border border-slate-200 rounded-xl hover:bg-indigo-50/30 hover:border-indigo-300 cursor-pointer transition flex justify-between items-center"
                      >
                        <div>
                          <p className="font-bold text-slate-800 text-sm">{c.clientName || 'Walk-in'}</p>
                          <p className="text-xs text-slate-500 mt-1">{c.serviceName} • {new Date(c.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                        </div>
                        <span className="text-xs font-bold bg-indigo-100 text-indigo-800 px-2.5 py-1 rounded-md">
                          £{(c.quotedAmount / 100).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              // Product Selection Mode
              <div className="flex flex-col h-full">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
                    <ShoppingCart className="w-4 h-4 text-indigo-600" /> Retail Products
                  </h3>
                  <button 
                    onClick={() => {
                      if (!preloadedBooking) setSelectedAppointmentId(null);
                    }}
                    className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full hover:bg-slate-200"
                  >
                    Change Appointment
                  </button>
                </div>

                <div className="relative mb-4">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search products..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-600 focus:outline-none text-xs"
                  />
                </div>

                <div className="flex-1 overflow-y-auto space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {searchResultsProducts.map(p => (
                      <div
                        key={p.id}
                        onClick={() => addToCart(p)}
                        className={`p-3 border rounded-xl cursor-pointer transition text-xs flex justify-between items-center ${
                          p.stockQuantity > 0 ? 'hover:bg-indigo-50/20 hover:border-indigo-200' : 'opacity-50 cursor-not-allowed'
                        }`}
                      >
                        <div className="truncate pr-2">
                          <p className="font-bold text-slate-800 truncate">{p.name}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">Stock: {p.stockQuantity} left</p>
                        </div>
                        <span className="font-black text-slate-900 shrink-0">£{(p.priceInCents / 100).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Active Cart & Multi-payment Settlement Drawer (5 cols) */}
          <div className="lg:col-span-5 bg-white rounded-2xl p-5 border border-slate-200/60 shadow-sm flex flex-col h-[520px]">
            <h3 className="text-sm font-bold text-slate-900 border-b pb-3 mb-3 flex justify-between items-center">
              <span>Active Till Cart</span>
              <span className="text-xs text-indigo-600 font-extrabold">{cart.length} items</span>
            </h3>

            {/* Cart Items Stage */}
            <div className="flex-1 overflow-y-auto divide-y space-y-2 text-xs">
              {!selectedAppointmentId && (
                <div className="text-center py-12 text-slate-400 font-medium">
                  Select an appointment to begin checkout.
                </div>
              )}
              {selectedAppointmentId && (
                <div className="py-2 flex justify-between items-center">
                  <div className="truncate pr-2">
                    <p className="font-bold text-slate-800 truncate">Service Appointment</p>
                    <span className="text-[9px] bg-emerald-100 px-1.5 py-0.2 rounded font-semibold text-emerald-700 uppercase">SERVICE</span>
                  </div>
                  <div className="font-bold text-slate-900">
                    {serverTotals ? `£${(serverTotals.serviceAmountInCents / 100).toFixed(2)}` : '...'}
                  </div>
                </div>
              )}
              {cart.map((item) => (
                <div key={item.id} className="py-2 flex justify-between items-center">
                  <div className="truncate pr-2">
                    <p className="font-bold text-slate-800 truncate">{item.name}</p>
                    <span className="text-[9px] bg-slate-100 px-1.5 py-0.2 rounded font-semibold text-slate-500 uppercase">{item.type}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-lg">
                      <button onClick={() => updateQty(item.id, -1)} className="p-0.5 hover:bg-slate-200 rounded text-slate-500"><Minus className="w-3.5 h-3.5" /></button>
                      <span className="font-bold w-4 text-center">{item.quantity}</span>
                      <button onClick={() => updateQty(item.id, 1)} className="p-0.5 hover:bg-slate-200 rounded text-slate-500"><Plus className="w-3.5 h-3.5" /></button>
                    </div>
                    <span className="font-bold text-slate-900 min-w-[40px] text-right">£{(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Subtotal, Tips, and Deposits Calc */}
            <div className="border-t pt-3 space-y-2 text-xs opacity-100 transition-opacity" style={{ opacity: isPreviewing ? 0.5 : 1 }}>
              <div className="flex justify-between font-bold text-slate-700">
                <span>Products Subtotal:</span>
                <span>{serverTotals ? `£${(serverTotals.retailAmountInCents / 100).toFixed(2)}` : '...'}</span>
              </div>

              {/* Tip Select Button Bar */}
              <div>
                <span className="text-[10px] font-bold text-slate-400 block uppercase mb-1">Add Employee Tip</span>
                <div className="grid grid-cols-4 gap-1">
                  {[10, 15, 20].map(pct => (
                    <button
                      key={pct}
                      disabled={!selectedAppointmentId}
                      onClick={() => setTipPercentage(pct)}
                      className={`p-1 border rounded text-[10px] font-bold text-center ${tipPercentage === pct ? 'border-slate-800 bg-slate-50 text-slate-800' : 'text-slate-500 hover:bg-slate-50'} disabled:opacity-50`}
                    >
                      {pct}%
                    </button>
                  ))}
                  <button
                    disabled={!selectedAppointmentId}
                    onClick={() => setTipPercentage('custom')}
                    className={`p-1 border rounded text-[10px] font-bold text-center ${tipPercentage === 'custom' ? 'border-slate-800 bg-slate-50 text-slate-800' : 'text-slate-500 hover:bg-slate-50'} disabled:opacity-50`}
                  >
                    Custom
                  </button>
                </div>
                {tipPercentage === 'custom' && (
                  <input
                    type="number"
                    placeholder="Enter tip amount (£)"
                    value={customTip}
                    onChange={(e) => setCustomTip(e.target.value)}
                    className="w-full mt-1.5 p-1 border rounded text-xs"
                  />
                )}
              </div>

              <div className="flex justify-between font-black text-slate-900 border-t pt-2 text-sm">
                <span>Grand Due:</span>
                <span className="text-base text-indigo-700">
                  {serverTotals ? `£${(serverTotals.grandTotalInCents / 100).toFixed(2)}` : '...'}
                </span>
              </div>
            </div>

            {/* Loyalty and multi-payment option tabs */}
            <div className="border-t pt-3 space-y-2">
              <span className="text-[10px] font-black text-slate-400 block uppercase">Settlement Configuration</span>
              
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 bg-slate-100 p-0.5 rounded-xl text-[10px] font-bold">
                <button type="button" onClick={() => setPaymentMode('ExternalCard')} className={`py-1.5 rounded-lg transition ${paymentMode === 'ExternalCard' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>💳 Card</button>
                <button type="button" onClick={() => setPaymentMode('Cash')} className={`py-1.5 rounded-lg transition ${paymentMode === 'Cash' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>💵 Cash</button>
                <button type="button" onClick={() => setPaymentMode('BankTransfer')} className={`py-1.5 rounded-lg transition ${paymentMode === 'BankTransfer' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>🏦 Bank</button>
                <button type="button" onClick={() => setPaymentMode('Other')} className={`py-1.5 rounded-lg transition ${paymentMode === 'Other' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>📝 Other</button>
                <button type="button" onClick={() => setPaymentMode('Split')} className={`py-1.5 rounded-lg transition ${paymentMode === 'Split' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>✂️ Split</button>
              </div>

              
              {paymentMode === 'ExternalCard' && (
                <div className="space-y-2 mt-2 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[8px] font-bold text-slate-400 uppercase">Provider</label>
                      <select value={externalProvider} onChange={e => setExternalProvider(e.target.value)} className="w-full p-1.5 border rounded-lg">
                        <option value="SUMUP">SumUp</option>
                        <option value="ZETTLE">Zettle</option>
                        <option value="SQUARE">Square</option>
                        <option value="WORLDPAY">Worldpay</option>
                        <option value="BANK_TERMINAL">Bank Terminal</option>
                        <option value="OTHER">Other...</option>
                      </select>
                    </div>
                    {externalProvider === 'OTHER' && (
                      <div>
                        <label className="text-[8px] font-bold text-slate-400 uppercase">Provider Name</label>
                        <input type="text" value={externalProviderName} onChange={e => setExternalProviderName(e.target.value)} placeholder="e.g. Tyro" className="w-full p-1.5 border rounded-lg focus:outline-none" />
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-[8px] font-bold text-slate-400 uppercase">Receipt/Ref # (Optional)</label>
                    <input type="text" value={externalReference} onChange={e => setExternalReference(e.target.value)} placeholder="0000" className="w-full p-1.5 border rounded-lg focus:outline-none" />
                  </div>
                </div>
              )}

              {paymentMode === 'BankTransfer' && (
                <div className="space-y-2 mt-2 text-xs">
                  <div>
                    <label className="text-[8px] font-bold text-slate-400 uppercase">Bank Reference (Optional)</label>
                    <input type="text" value={externalReference} onChange={e => setExternalReference(e.target.value)} placeholder="Transfer ref" className="w-full p-1.5 border rounded-lg focus:outline-none" />
                  </div>
                </div>
              )}

              {paymentMode === 'Other' && (
                <div className="space-y-2 mt-2 text-xs">
                  <div>
                    <label className="text-[8px] font-bold text-slate-400 uppercase">Method Description</label>
                    <input type="text" value={methodDescription} onChange={e => setMethodDescription(e.target.value)} placeholder="e.g. Gift Voucher" className="w-full p-1.5 border rounded-lg focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-[8px] font-bold text-slate-400 uppercase">Reference (Optional)</label>
                    <input type="text" value={externalReference} onChange={e => setExternalReference(e.target.value)} placeholder="Voucher code" className="w-full p-1.5 border rounded-lg focus:outline-none" />
                  </div>
                </div>
              )}

              {paymentMode === 'Split' && (
                <div className="mt-2 space-y-2 text-xs bg-slate-50 p-2 rounded-xl border border-slate-200">
                  {splitComponents.map((c, idx) => (
                    <div key={c.id} className="flex flex-col gap-1.5 bg-white p-2 rounded-lg border border-slate-100 shadow-sm">
                      <div className="flex justify-between items-center">
                        <select value={c.method} onChange={e => {
                          const newComps = [...splitComponents];
                          newComps[idx].method = e.target.value;
                          if (e.target.value === 'EXTERNAL_CARD' && !newComps[idx].provider) newComps[idx].provider = 'SUMUP';
                          setSplitComponents(newComps);
                        }} className="font-bold border-none bg-transparent focus:ring-0 text-xs p-0 text-indigo-700 w-1/2">
                          <option value="CASH">Cash</option>
                          <option value="EXTERNAL_CARD">Ext. Card</option>
                          <option value="BANK_TRANSFER">Bank</option>
                          <option value="OTHER">Other</option>
                        </select>
                        <input
                          type="number"
                          placeholder="0.00"
                          value={c.amount}
                          onChange={e => {
                            const newComps = [...splitComponents];
                            newComps[idx].amount = e.target.value;
                            setSplitComponents(newComps);
                          }}
                          className="w-20 text-right font-mono border-b focus:outline-none"
                        />
                      </div>
                      {c.method === 'EXTERNAL_CARD' && (
                        <div className="flex gap-2 text-[10px]">
                          <select value={c.provider} onChange={e => {
                            const newComps = [...splitComponents];
                            newComps[idx].provider = e.target.value;
                            setSplitComponents(newComps);
                          }} className="border rounded p-1 w-full bg-slate-50">
                            <option value="SUMUP">SumUp</option>
                            <option value="ZETTLE">Zettle</option>
                            <option value="SQUARE">Square</option>
                            <option value="WORLDPAY">Worldpay</option>
                            <option value="BANK_TERMINAL">Bank</option>
                            <option value="OTHER">Other</option>
                          </select>
                        </div>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => setSplitComponents([...splitComponents, { id: Date.now().toString(), method: 'CASH', amount: '', provider: '', ref: '', customProvider: '', desc: '' }])} className="text-[10px] font-bold text-indigo-600 hover:underline w-full text-center">+ Add split</button>
                </div>
              )}

              {paymentMode !== 'Cash' && (
                <div className="mt-2 text-[10px] text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200 flex items-start gap-2">
                  <input
                    type="checkbox"
                    id="external_card_confirm"
                    checked={externalCardConfirmed}
                    onChange={(e) => setExternalCardConfirmed(e.target.checked)}
                    className="mt-0.5 cursor-pointer"
                  />
                  <label htmlFor="external_card_confirm" className="leading-tight cursor-pointer">
                    I confirm that the {paymentMode === 'BankTransfer' ? 'bank transfer was received' : paymentMode === 'Split' ? 'split payments are complete' : 'payment was successful'}.
                  </label>
                </div>
              )}
            </div>

            {/* Status alerts */}
            {checkoutState === 'insufficient-stock' && (
              <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Cannot proceed: one or more products exceed available stock.</span>
              </div>
            )}
            {checkoutState === 'invalid-split' && (
              <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Cannot proceed: Split payment amounts do not equal the grand total due.</span>
              </div>
            )}

            {/* Submit checkout button */}
            <button
              onClick={handleCheckoutSubmit}
              disabled={checkoutState === 'loading' || isPreviewing || !serverTotals || !selectedAppointmentId || ((paymentMode !== 'Cash') && !externalCardConfirmed)}
              className="mt-4 w-full bg-slate-950 text-white font-extrabold text-xs py-3 rounded-2xl hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shadow"
            >
              {checkoutState === 'loading' || isPreviewing ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin border-2 border-white border-t-transparent rounded-full w-4 h-4"></span>
                  Processing...
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Wallet className="w-4 h-4" /> Finalize Sale & Credit points
                </span>
              )}
            </button>
          </div>

        </div>
      )}
    </div>
  );
}
