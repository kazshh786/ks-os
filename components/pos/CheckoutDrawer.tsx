'use client';

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { supabase } from '@/utils/supabase/client';
import styles from './CheckoutDrawer.module.css';

interface Product {
  id: string;
  name: string;
  sku: string;
  priceInCents: number;
  stockQuantity: number;
}

interface Service {
  id: string;
  name: string;
  price: number;
}

interface Appointment {
  id: string;
  clientName: string;
  status: string;
  serviceId: string;
  services: Service;
}

interface CheckoutDrawerProps {
  tenantId: string;
  appointmentId: string;
  onCheckoutSuccess: () => void;
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface ReceiptData {
  clientName: string;
  serviceName?: string;
  serviceCost: number;
  products: Array<{ id: string; name: string; price: number; qty: number }>;
  tip: number;
  grandTotal: number;
  method: 'CARD' | 'CASH' | 'SPLIT';
  cashPaid: number;
  cardPaid: number;
  pointsEarned: number;
}

function mapDbToProduct(row: any): Product {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    priceInCents: row.price_in_cents,
    stockQuantity: row.stock_quantity
  };
}

export default function CheckoutDrawer({ tenantId, appointmentId, onCheckoutSuccess }: CheckoutDrawerProps) {
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'CARD' | 'CASH' | 'SPLIT'>('CASH');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recommendations state
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [recommendations, setRecommendations] = useState<Product[]>([]);

  // Tipping states
  const [selectedTipPercent, setSelectedTipPercent] = useState<number | 'custom' | null>(null);
  const [customTipCents, setCustomTipCents] = useState<string>('');
  const [tipCents, setTipCents] = useState<number>(0);

  // Split payment details
  const [cashSplitAmount, setCashSplitAmount] = useState<string>('');
  const [cardSplitAmount, setCardSplitAmount] = useState<number>(0);

  // Receipt popup state
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

  // Load the target appointment & products list
  useEffect(() => {
    if (!appointmentId) return;

    const fetchAppointmentAndProducts = async () => {
      try {
        const { data: apptData, error: apptErr } = await supabase
          .from('appointments')
          .select('id, client_name, status, service_id, services(id, name, price)')
          .eq('id', appointmentId)
          .single();

        if (apptErr) throw apptErr;
        
        if (apptData) {
          setAppointment({
            id: apptData.id,
            clientName: apptData.client_name,
            status: apptData.status,
            serviceId: apptData.service_id,
            services: apptData.services as unknown as Service
          });
        }

        // Fetch products list
        const { data: prodData } = await supabase
          .from('products')
          .select('*')
          .eq('tenant_id', tenantId)
          .gt('stock_quantity', 0);
        
        const products = (prodData || []).map(mapDbToProduct);
        setAllProducts(products);

        // Seed 2 quick additions as recommendations
        if (products.length > 0) {
          setRecommendations(products.slice(0, 2));
        }
      } catch (err: any) {
        setError('Failed to load checkout profile: ' + err.message);
      }
    };

    fetchAppointmentAndProducts();
  }, [appointmentId, tenantId]);

  // Product Search handler
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setSearchResults([]);
      return;
    }

    const searchProducts = async () => {
      try {
        const { data, error: err } = await supabase
          .from('products')
          .select('*')
          .eq('tenant_id', tenantId)
          .ilike('name', `%${searchQuery}%`)
          .gt('stock_quantity', 0)
          .limit(5);

        if (err) throw err;
        setSearchResults((data || []).map(mapDbToProduct));
      } catch (err: any) {
        console.error('Error searching products:', err);
      }
    };

    const delayDebounceFn = setTimeout(() => {
      searchProducts();
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, tenantId]);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stockQuantity) {
          setError(`Cannot add more. Only ${product.stockQuantity} items in stock.`);
          return prev;
        }
        setError(null);
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      setError(null);
      return [...prev, { product, quantity: 1 }];
    });
    setSearchQuery('');
    setSearchResults([]);
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  // Math calculations
  const serviceTotal = appointment?.services?.price || 0;
  const productsTotal = cart.reduce((acc, item) => acc + item.product.priceInCents * item.quantity, 0);
  const subtotal = serviceTotal + productsTotal;
  const grandTotal = subtotal + tipCents;

  // Handle tip triggers
  useEffect(() => {
    if (selectedTipPercent === null) {
      setTipCents(0);
    } else if (selectedTipPercent === 'custom') {
      const val = parseFloat(customTipCents);
      setTipCents(isNaN(val) ? 0 : Math.round(val * 100));
    } else {
      setTipCents(Math.round(subtotal * (selectedTipPercent / 100)));
    }
  }, [selectedTipPercent, customTipCents, subtotal]);

  // Handle split payment balance math
  useEffect(() => {
    if (paymentMethod !== 'SPLIT') return;
    const cashVal = parseFloat(cashSplitAmount);
    const cashCents = isNaN(cashVal) ? 0 : Math.round(cashVal * 100);
    const remaining = grandTotal - cashCents;
    setCardSplitAmount(remaining > 0 ? remaining : 0);
  }, [cashSplitAmount, grandTotal, paymentMethod]);

  const handlePayNow = async () => {
    if (!appointment) return;
    setIsProcessing(true);
    setError(null);

    try {
      if (paymentMethod !== 'CASH') {
        throw new Error('Card payments are coming soon. Select cash to record this checkout.');
      }
      const purchasedProducts = cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
      }));

      // Insert transaction record on DB
      // PostgreSQL trigger trg_decrement_stock_on_transaction will fire on INSERT
      // to decrement stock counts, update appointment status to 'COMPLETED',
      // and credit customer loyalty points (e.g. 1 point per £1 spent).
      const { error: txErr } = await supabase.from('checkout_transactions').insert({
        tenant_id: tenantId,
        appointment_id: appointment.id,
        total_amount: grandTotal,
        payment_status: 'SUCCEEDED',
        payment_method: paymentMethod,
        purchased_products: purchasedProducts,
        stripe_payment_intent_id: null,
        purpose: 'point_of_sale',
      });

      if (txErr) throw txErr;

      // Populate Receipt Details
      setReceiptData({
        clientName: appointment.clientName,
        serviceName: appointment.services?.name,
        serviceCost: serviceTotal,
        products: cart.map((i) => ({ id: i.product.id, name: i.product.name, price: i.product.priceInCents, qty: i.quantity })),
        tip: tipCents,
        grandTotal: grandTotal,
        method: paymentMethod,
        cashPaid: grandTotal,
        cardPaid: 0,
        pointsEarned: Math.round(grandTotal / 100),
      });

      setCart([]);
      setShowReceipt(true);
    } catch (err: any) {
      setError(err.message || 'Payment processing failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCloseReceipt = () => {
    setShowReceipt(false);
    onCheckoutSuccess();
  };

  return (
    <>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.drawerContent}>
          <div className={styles.drawerHeader}>
            <Dialog.Title className={styles.drawerTitle}>POS Checkout Desk</Dialog.Title>
            <Dialog.Close asChild>
              <button className={styles.closeButton}>×</button>
            </Dialog.Close>
          </div>

          {error && <div className={styles.errorMessage}>{error}</div>}

          {appointment ? (
            <div className={styles.checkoutBody}>
              {/* 1. Appointment Overview */}
              <div className={styles.sectionCard}>
                <h4 className={styles.sectionTitle}>1. Appointment Overview</h4>
                <div className={styles.detailRow}>
                  <span>Client:</span>
                  <strong>{appointment.clientName}</strong>
                </div>
                <div className={styles.detailRow}>
                  <span>Service treatment:</span>
                  <span>
                    {appointment.services?.name} (£{(serviceTotal / 100).toFixed(2)})
                  </span>
                </div>
              </div>

              {/* 2. Add-ons Search & Suggestions */}
              <div className={styles.sectionCard}>
                <h4 className={styles.sectionTitle}>2. Add Retail Products</h4>
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Search SKU or product name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />

                {searchResults.length > 0 && (
                  <div className={styles.searchResultsList}>
                    {searchResults.map((prod) => (
                      <button
                        key={prod.id}
                        className={styles.searchResultItem}
                        onClick={() => addToCart(prod)}
                      >
                        <div>
                          <span className={styles.resultName}>{prod.name}</span>
                          <span className={styles.resultSku}>SKU: {prod.sku} • Stock: {prod.stockQuantity}</span>
                        </div>
                        <span className={styles.resultPrice}>
                          £{(prod.priceInCents / 100).toFixed(2)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Recommendations */}
                {searchQuery.trim() === '' && recommendations.length > 0 && (
                  <div className={styles.recommendBox}>
                    <div className={styles.recommendTitle}>💡 Stylist Recommendations</div>
                    <div className={styles.recommendGrid}>
                      {recommendations.map((prod) => (
                        <button
                          key={prod.id}
                          className={styles.recommendItem}
                          onClick={() => addToCart(prod)}
                        >
                          <span className={styles.recommendName}>{prod.name}</span>
                          <span className={styles.recommendPrice}>£{(prod.priceInCents / 100).toFixed(2)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cart list */}
                {cart.length > 0 && (
                  <div className={styles.cartList}>
                    {cart.map((item) => (
                      <div key={item.product.id} className={styles.cartItem}>
                        <div>
                          <span className={styles.cartItemName}>{item.product.name}</span>
                          <span className={styles.cartItemQuantity}>Qty: {item.quantity}</span>
                        </div>
                        <div className={styles.cartItemActions}>
                          <span className={styles.cartItemPrice}>
                            £{((item.product.priceInCents * item.quantity) / 100).toFixed(2)}
                          </span>
                          <button className={styles.removeCartItem} onClick={() => removeFromCart(item.product.id)}>
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 3. Tipping presets */}
              <div className={styles.sectionCard}>
                <h4 className={styles.sectionTitle}>3. Add Tip Gratuity</h4>
                <div className={styles.tipButtonGroup}>
                  <button
                    className={`${styles.tipButton} ${selectedTipPercent === 15 ? styles.tipButtonActive : ''}`}
                    onClick={() => setSelectedTipPercent(15)}
                  >
                    15% (£{(Math.round(subtotal * 0.15) / 100).toFixed(2)})
                  </button>
                  <button
                    className={`${styles.tipButton} ${selectedTipPercent === 20 ? styles.tipButtonActive : ''}`}
                    onClick={() => setSelectedTipPercent(20)}
                  >
                    20% (£{(Math.round(subtotal * 0.20) / 100).toFixed(2)})
                  </button>
                  <button
                    className={`${styles.tipButton} ${selectedTipPercent === 25 ? styles.tipButtonActive : ''}`}
                    onClick={() => setSelectedTipPercent(25)}
                  >
                    25% (£{(Math.round(subtotal * 0.25) / 100).toFixed(2)})
                  </button>
                  <button
                    className={`${styles.tipButton} ${selectedTipPercent === 'custom' ? styles.tipButtonActive : ''}`}
                    onClick={() => setSelectedTipPercent('custom')}
                  >
                    Custom
                  </button>
                </div>

                {selectedTipPercent === 'custom' && (
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Enter tip amount (£)"
                    className={styles.searchInput}
                    style={{ marginTop: '10px', marginBottom: 0 }}
                    value={customTipCents}
                    onChange={(e) => setCustomTipCents(e.target.value)}
                  />
                )}
              </div>

              {/* 4. Payment Method */}
              <div className={styles.sectionCard}>
                <h4 className={styles.sectionTitle}>4. Payment Method</h4>
                <div className={styles.paymentButtonGroup}>
                  {(['CASH'] as const).map((method) => (
                    <button
                      key={method}
                      className={`${styles.paymentMethodButton} ${
                        paymentMethod === method ? styles.paymentMethodButtonActive : ''
                      }`}
                      disabled={method !== 'CASH'}
                      title={method !== 'CASH' ? 'Card payments are coming soon' : 'Record a cash payment'}
                      onClick={() => setPaymentMethod(method)}
                    >
                      {method}{method !== 'CASH' ? ' · Soon' : ''}
                    </button>
                  ))}
                </div>

                {paymentMethod === 'SPLIT' && (
                  <div className={styles.splitInputs}>
                    <div className={styles.formGroup}>
                      <label style={{ fontSize: '10px', fontWeight: 800, color: '#94a3b8' }}>Cash Portion (£):</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        className={styles.searchInput}
                        value={cashSplitAmount}
                        onChange={(e) => setCashSplitAmount(e.target.value)}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label style={{ fontSize: '10px', fontWeight: 800, color: '#94a3b8' }}>Card Balance (Auto):</label>
                      <div className={styles.searchInput} style={{ background: 'rgba(255,255,255,0.02)', color: 'var(--accent-color, #d4af37)', fontWeight: 'bold' }}>
                        £{(cardSplitAmount / 100).toFixed(2)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Billing Invoice & Confirm */}
              <div className={styles.billingSection}>
                <div className={styles.billingRow}>
                  <span>Subtotal (Service + Retail):</span>
                  <span>£{(subtotal / 100).toFixed(2)}</span>
                </div>
                {tipCents > 0 && (
                  <div className={styles.billingRow}>
                    <span>Gratuity Tip:</span>
                    <span>£{(tipCents / 100).toFixed(2)}</span>
                  </div>
                )}
                
                {/* Loyalty Point earnings preview */}
                <div className={styles.billingRow} style={{ color: '#10b981', fontWeight: 'bold', fontSize: '11px', marginTop: '4px' }}>
                  <span>✨ Loyalty Points Earned:</span>
                  <span>+{Math.round(grandTotal / 100)} pts</span>
                </div>

                <div className={`${styles.billingRow} ${styles.grandTotalRow}`}>
                  <span>Grand Total:</span>
                  <span>£{(grandTotal / 100).toFixed(2)}</span>
                </div>

                <button
                  className={styles.payNowButton}
                  onClick={handlePayNow}
                  disabled={isProcessing}
                >
                  {isProcessing ? 'Recording payment…' : `Record cash payment £${(grandTotal / 100).toFixed(2)}`}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '32px', color: '#64748b' }}>Loading checkout data...</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>

      {/* Invoice receipt pop-up overlay */}
      {showReceipt && receiptData && (
        <div className={styles.receiptOverlay}>
          <div className={styles.receiptPaper}>
            <div className={styles.receiptHeader}>
              <div className={styles.receiptBrand}>*** KS STUDIO ***</div>
              <div className={styles.receiptDate}>{new Date().toLocaleString()}</div>
            </div>

            <div className={styles.receiptDivider} />
            <div className={styles.receiptItemRow}>
              <span>Client:</span>
              <strong>{receiptData.clientName}</strong>
            </div>
            <div className={styles.receiptDivider} />

            {/* Service item */}
            <div className={styles.receiptItemRow}>
              <span>{receiptData.serviceName}</span>
              <span>£{(receiptData.serviceCost / 100).toFixed(2)}</span>
            </div>

            {/* Products items */}
            {receiptData.products.map((item) => (
              <div key={item.id} className={styles.receiptItemRow}>
                <span>{item.name} (x{item.qty})</span>
                <span>£{((item.price * item.qty) / 100).toFixed(2)}</span>
              </div>
            ))}

            {receiptData.tip > 0 && (
              <div className={styles.receiptItemRow} style={{ marginTop: '8px' }}>
                <span>Stylist Tip:</span>
                <span>£{(receiptData.tip / 100).toFixed(2)}</span>
              </div>
            )}

            <div className={styles.receiptDivider} />
            <div className={styles.receiptTotalRow}>
              <span>TOTAL PAID</span>
              <span>£{(receiptData.grandTotal / 100).toFixed(2)}</span>
            </div>
            <div className={styles.receiptDivider} />

            {/* Method split details */}
            <div className={styles.receiptItemRow} style={{ fontSize: '10px', color: '#555' }}>
              <span>Method:</span>
              <span>{receiptData.method}</span>
            </div>
            {receiptData.method === 'SPLIT' && (
              <>
                <div className={styles.receiptItemRow} style={{ fontSize: '10px', color: '#555' }}>
                  <span>- Cash:</span>
                  <span>£{(receiptData.cashPaid / 100).toFixed(2)}</span>
                </div>
                <div className={styles.receiptItemRow} style={{ fontSize: '10px', color: '#555' }}>
                  <span>- Card:</span>
                  <span>£{(receiptData.cardPaid / 100).toFixed(2)}</span>
                </div>
              </>
            )}

            <div className={styles.receiptItemRow} style={{ fontSize: '10px', color: '#10b981', fontWeight: 'bold', marginTop: '6px' }}>
              <span>Loyalty Points Balance:</span>
              <span>+{receiptData.pointsEarned} points</span>
            </div>

            <div className={styles.receiptFooter}>
              THANK YOU FOR YOUR VISIT!<br />
              Receipt emailed to customer.<br />
              Software Powered by KS OS
            </div>

            <button className={styles.receiptCloseBtn} onClick={handleCloseReceipt}>
              Done & Close Desk
            </button>
          </div>
        </div>
      )}
    </>
  );
}
