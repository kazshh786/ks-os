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

export default function CheckoutDrawer({ tenantId, appointmentId, onCheckoutSuccess }: CheckoutDrawerProps) {
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'CARD' | 'CASH' | 'SPLIT'>('CARD');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the target appointment
  useEffect(() => {
    if (!appointmentId) return;

    const fetchAppointment = async () => {
      try {
        const { data, error: err } = await supabase
          .from('appointments')
          .select('id, client_name, status, service_id, services(id, name, price)')
          .eq('id', appointmentId)
          .single();

        if (err) throw err;
        setAppointment(data as unknown as Appointment);
      } catch (err: any) {
        setError('Failed to fetch appointment: ' + err.message);
      }
    };

    fetchAppointment();
  }, [appointmentId]);

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
          .gt('stock_quantity', 0) // Only fetch items in stock
          .limit(5);

        if (err) throw err;
        setSearchResults(data as Product[]);
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
        // Guard stock quantity
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

  // Math totals calculation
  const serviceTotal = appointment?.services?.price || 0; // in cents
  const productsTotal = cart.reduce((acc, item) => acc + item.product.priceInCents * item.quantity, 0); // in cents
  const grandTotal = serviceTotal + productsTotal; // in cents

  const handlePayNow = async () => {
    if (!appointment) return;
    setIsProcessing(true);
    setError(null);

    try {
      // 1. Simulate Stripe PaymentIntent Creation & Card processing
      // In production, you would fetch: POST /api/checkout/payment-intent
      // passing { amount: grandTotal } to receive a client_secret
      await new Promise((resolve) => setTimeout(resolve, 1500)); // Simulate gateway delay

      const mockStripePaymentIntentId = 'pi_' + Math.random().toString(36).substr(2, 9);

      // 2. Prepare transaction payload items
      const purchasedProducts = cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
      }));

      // 3. Create checkout transaction record on Supabase
      // The Postgres trigger 'decrement_stock_on_transaction' will fire AFTER INSERT
      // to decrement inventory quantities and mark appointment status as 'COMPLETED'
      const { error: txErr } = await supabase.from('checkout_transactions').insert({
        tenant_id: tenantId,
        appointment_id: appointment.id,
        total_amount: grandTotal,
        payment_status: 'SUCCEEDED',
        payment_method: paymentMethod,
        purchased_products: purchasedProducts,
        stripe_payment_intent_id: mockStripePaymentIntentId,
      });

      if (txErr) throw txErr;

      // Reset cart and trigger callback
      setCart([]);
      onCheckoutSuccess();
    } catch (err: any) {
      setError(err.message || 'Payment processing failed');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog.Portal>
      <Dialog.Overlay className={styles.overlay} />
      <Dialog.Content className={styles.drawerContent}>
        <div className={styles.drawerHeader}>
          <Dialog.Title className={styles.drawerTitle}>POS Checkout</Dialog.Title>
          <Dialog.Close asChild>
            <button className={styles.closeButton}>×</button>
          </Dialog.Close>
        </div>

        {error && <div className={styles.errorMessage}>{error}</div>}

        {appointment ? (
          <div className={styles.checkoutBody}>
            {/* 1. Client & Service Information */}
            <div className={styles.sectionCard}>
              <h4 className={styles.sectionTitle}>1. Appointment Details</h4>
              <div className={styles.detailRow}>
                <span>Client:</span>
                <strong>{appointment.clientName}</strong>
              </div>
              <div className={styles.detailRow}>
                <span>Service:</span>
                <span>
                  {appointment.services?.name} (${(serviceTotal / 100).toFixed(2)})
                </span>
              </div>
            </div>

            {/* 2. Retail Add-ons Search */}
            <div className={styles.sectionCard}>
              <h4 className={styles.sectionTitle}>2. Add Retail Products</h4>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search products by name or SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              {/* Search suggestions dropdown */}
              {searchResults.length > 0 && (
                <div className={styles.searchResultsList}>
                  {searchResults.map((prod) => (
                    <button
                      key={prod.id}
                      className={styles.searchResultItem}
                      onClick={() => addToCart(prod)}
                    >
                      <div className={styles.resultDetails}>
                        <span className={styles.resultName}>{prod.name}</span>
                        <span className={styles.resultSku}>SKU: {prod.sku} • Stock: {prod.stockQuantity}</span>
                      </div>
                      <span className={styles.resultPrice}>
                        ${(prod.priceInCents / 100).toFixed(2)}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Cart List */}
              {cart.length > 0 && (
                <div className={styles.cartList}>
                  {cart.map((item) => (
                    <div key={item.product.id} className={styles.cartItem}>
                      <div className={styles.cartItemDetails}>
                        <span className={styles.cartItemName}>{item.product.name}</span>
                        <span className={styles.cartItemQuantity}>Qty: {item.quantity}</span>
                      </div>
                      <div className={styles.cartItemActions}>
                        <span className={styles.cartItemPrice}>
                          ${((item.product.priceInCents * item.quantity) / 100).toFixed(2)}
                        </span>
                        <button
                          className={styles.removeCartItem}
                          onClick={() => removeFromCart(item.product.id)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Payment Method */}
            <div className={styles.sectionCard}>
              <h4 className={styles.sectionTitle}>3. Payment Method</h4>
              <div className={styles.paymentButtonGroup}>
                {(['CARD', 'CASH', 'SPLIT'] as const).map((method) => (
                  <button
                    key={method}
                    className={`${styles.paymentMethodButton} ${
                      paymentMethod === method ? styles.paymentMethodButtonActive : ''
                    }`}
                    onClick={() => setPaymentMethod(method)}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Receipt Totals & Stripe Gateway Trigger */}
            <div className={styles.billingSection}>
              <div className={styles.billingRow}>
                <span>Subtotal (Service):</span>
                <span>${(serviceTotal / 100).toFixed(2)}</span>
              </div>
              {productsTotal > 0 && (
                <div className={styles.billingRow}>
                  <span>Subtotal (Products):</span>
                  <span>${(productsTotal / 100).toFixed(2)}</span>
                </div>
              )}
              <div className={`${styles.billingRow} ${styles.grandTotalRow}`}>
                <span>Total Amount:</span>
                <span>${(grandTotal / 100).toFixed(2)}</span>
              </div>

              {paymentMethod === 'CARD' && (
                <div className={styles.stripeElementsPlaceholder}>
                  <div className={styles.stripeCardIcon}>💳</div>
                  <span>Stripe Payment Intent Active</span>
                </div>
              )}

              <button
                className={styles.payNowButton}
                onClick={handlePayNow}
                disabled={isProcessing}
              >
                {isProcessing ? 'Processing Payment...' : `Confirm & Pay $${(grandTotal / 100).toFixed(2)}`}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.loadingSpinner}>Loading appointment checkout details...</div>
        )}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
