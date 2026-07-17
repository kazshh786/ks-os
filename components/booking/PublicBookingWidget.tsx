'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';

declare global { interface Window { Stripe?: any } }
type Catalog = { tenant: { name: string; currency: string }; paymentMode: string; bookingChannels: { id: 'in_shop' | 'mobile'; label: string }[]; services: any[]; staff: any[] };

function loadStripe(key: string) {
  return new Promise<any>((resolve, reject) => {
    if (window.Stripe) return resolve(window.Stripe(key));
    const script = document.createElement('script'); script.src = 'https://js.stripe.com/v3/';
    script.onload = () => resolve(window.Stripe!(key)); script.onerror = () => reject(new Error('Secure payment form failed to load'));
    document.head.appendChild(script);
  });
}

function PaymentPanel({ result, onConfirmed, onError, checkStatus }: { result: any; onConfirmed: (booking: any) => void; onError: (message: string) => void; checkStatus: (reference: string) => Promise<any> }) {
  const mount = useRef<HTMLDivElement>(null), stripeRef = useRef<any>(), cardRef = useRef<any>(); const [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  useEffect(() => { let active = true; loadStripe(result.payment.publishableKey).then(stripe => { if (!active || !mount.current) return; stripeRef.current = stripe; const card = stripe.elements().create('card'); card.mount(mount.current); cardRef.current = card; setReady(true); }).catch(error => onError(error.message)); return () => { active = false; cardRef.current?.destroy(); }; }, [result, onError]);
  async function pay() { setBusy(true); onError(''); try { const outcome = await stripeRef.current.confirmCardPayment(result.payment.clientSecret, { payment_method: { card: cardRef.current } }); if (outcome.error) throw new Error(outcome.error.message); for (let i = 0; i < 8; i++) { await new Promise(resolve => setTimeout(resolve, 750)); const check = await checkStatus(result.booking.reference); if (check.booking.status === 'CONFIRMED') return onConfirmed(check.booking); } throw new Error(`Payment received. Confirmation is processing. Reference: ${result.booking.reference}`); } catch (error: any) { onError(error.message); } finally { setBusy(false); } }
  return <section style={{ display: 'grid', gap: 16 }}><h2>Secure checkout</h2><p>Amount due: {result.payment.currency} {(result.payment.amount / 100).toFixed(2)}</p><div ref={mount} style={{ padding: 14, border: '1px solid var(--md-sys-color-surface-container-highest)', borderRadius: 'var(--md-shape-corner-medium)' }} /><button className="micro-haptic" disabled={busy || !ready} onClick={pay} style={{background: 'var(--md-sys-color-primary)', color: 'var(--md-sys-color-on-primary)', padding: '14px 24px', border: 'none', borderRadius: 24, fontSize: 16, fontWeight: 600, cursor: (busy || !ready) ? 'not-allowed' : 'pointer'}}>{busy ? 'Processing…' : 'Pay and confirm'}</button></section>;
}

export default function PublicBookingWidget({ subdomain }: { subdomain: string }) {
  const endpoint = useMemo(() => `/api/v1/public/${encodeURIComponent(subdomain)}/booking`, [subdomain]);
  const [catalog, setCatalog] = useState<Catalog | null>(null), [bookingChannel, setBookingChannel] = useState<'in_shop' | 'mobile'>('in_shop'), [serviceId, setServiceId] = useState(''), [staffId, setStaffId] = useState('any');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10)), [slots, setSlots] = useState<any[]>([]), [slot, setSlot] = useState<any>(null);
  const [status, setStatus] = useState('Loading live booking options…'), [error, setError] = useState(''), [booking, setBooking] = useState<any>(null), [pendingPayment, setPendingPayment] = useState<any>(null);
  const [client, setClient] = useState({ name: '', email: '', phone: '' }), [payNow, setPayNow] = useState(false), [submitting, setSubmitting] = useState(false);
  const [mobileAddress, setMobileAddress] = useState({ line1: '', line2: '', city: '', postcode: '', accessNotes: '' });
  
  // Wizard State
  const [step, setStep] = useState(1);

  async function api(action: string, options: RequestInit = {}, query: Record<string, string> = {}) { const url = new URL(endpoint, location.origin); url.searchParams.set('action', action); Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value)); const response = await fetch(url, options); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error?.message || 'Booking service unavailable'); return body; }
  useEffect(() => { api('catalog').then(data => { setCatalog(data); if (data.bookingChannels?.length) setBookingChannel(data.bookingChannels[0].id); setStatus(''); }).catch(reason => setError(reason.message)); }, [endpoint]);
  
  // Automatically load slots when step 3 is reached or date changes
  useEffect(() => {
    if (step === 3 && serviceId) {
      loadSlots();
    }
  }, [step, date, staffId, serviceId, bookingChannel]);

  async function loadSlots() { if (!serviceId) return setError('Choose a service first'); setError(''); setStatus('Searching availability…'); setSlots([]); setSlot(null); try { const data = await api('availability', {}, { serviceId, staffId, date, bookingChannel }); setSlots(data.slots); setStatus(data.slots.length ? '' : 'No available times for this date.'); } catch (reason: any) { setError(reason.message); } }
  
  async function submit(event?: React.FormEvent) { if (event) event.preventDefault(); if (!slot || !catalog) return; setSubmitting(true); setError(''); try { const result = await api('create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serviceId, staffId: slot.staffId, startTime: slot.start, client, bookingChannel, mobileAddress: bookingChannel === 'mobile' ? mobileAddress : null, paymentMode: catalog.paymentMode, payNow: catalog.paymentMode === 'customer_choice' ? payNow : ['deposit', 'full_payment'].includes(catalog.paymentMode), idempotencyKey: crypto.randomUUID() }) }); if (result.payment.required) setPendingPayment(result); else setBooking(result.booking); } catch (reason: any) { setError(reason.message); } finally { setSubmitting(false); } }
  const checkStatus = (reference: string) => api('status', {}, { reference });

  if (error && !catalog) return <main style={{ padding: 40, color: 'var(--md-sys-color-error)' }}><h1>Booking unavailable</h1><p>{error}</p></main>;
  if (!catalog) return <main style={{ padding: 40, display: 'flex', justifyContent: 'center', opacity: 0.7 }}><p>{status}</p></main>;
  if (booking) return <main className="animate-fade-in" style={{ maxWidth: 720, margin: '40px auto', padding: 40, textAlign: 'center', background: 'var(--md-sys-color-surface-container)', borderRadius: 'var(--md-shape-corner-large)' }}><h1 style={{color:'var(--md-sys-color-primary)'}}>Booking Confirmed ✨</h1><p>Your reference is <strong>{booking.reference}</strong>.</p><p style={{opacity:0.7, marginTop:8}}>Please save your booking reference. Email/SMS notifications are currently unavailable.</p></main>;
  if (pendingPayment) return <main className="animate-fade-in" style={{ maxWidth: 600, margin: '40px auto', padding: 24, background: 'var(--md-sys-color-surface-container)', borderRadius: 'var(--md-shape-corner-large)' }}><PaymentPanel result={pendingPayment} onConfirmed={setBooking} onError={setError} checkStatus={checkStatus} />{error && <p style={{ color: 'var(--md-sys-color-error)', marginTop: 12 }}>{error}</p>}</main>;

  const selectedService = catalog.services.find(s => s.id === serviceId);

  // Group slots by time of day
  const morningSlots = slots.filter(s => new Date(s.start).getHours() < 12);
  const afternoonSlots = slots.filter(s => new Date(s.start).getHours() >= 12 && new Date(s.start).getHours() < 17);
  const eveningSlots = slots.filter(s => new Date(s.start).getHours() >= 17);

  function advanceNextDay() {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    setDate(d.toISOString().slice(0, 10));
  }

  const canContinue = () => {
    if (step === 1) return !!serviceId;
    if (step === 2) return true; // staffId has 'any' default
    if (step === 3) return !!slot;
    if (step === 4) return client.name && client.email && client.phone && (bookingChannel !== 'mobile' || (mobileAddress.line1 && mobileAddress.city && mobileAddress.postcode));
    return false;
  };

  const handleContinue = () => {
    if (step < 4) setStep(step + 1);
    else submit();
  };

  return (
    <main className="animate-fade-in" style={{ maxWidth: 640, margin: '0 auto', padding: '20px 20px 120px', position: 'relative' }}>
      <header style={{ marginBottom: 32, textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{catalog.tenant.name}</h1>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          {[1,2,3,4].map(s => (
            <div key={s} style={{ height: 4, width: 40, borderRadius: 2, background: step >= s ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-highest)', transition: 'background 0.3s ease' }} />
          ))}
        </div>
      </header>

      {error && <div style={{ background: 'var(--md-sys-color-error-container)', color: 'var(--md-sys-color-on-error-container)', padding: '12px 16px', borderRadius: 8, marginBottom: 24, fontSize: 14 }}>{error}</div>}

      <div style={{ display: 'grid', gap: 24 }}>
        {step === 1 && (
          <section className="animate-fade-in" style={{ display: 'grid', gap: 20 }}>
            <h2>1. Choose a Service</h2>
            <div style={{ display: 'flex', gap: 12 }}>
              {catalog.bookingChannels.map(channel => (
                <label key={channel.id} className="micro-haptic" style={{ flex: 1, padding: 16, border: `2px solid ${bookingChannel === channel.id ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-highest)'}`, borderRadius: 'var(--md-shape-corner-medium)', textAlign: 'center', cursor: 'pointer', background: bookingChannel === channel.id ? 'var(--md-sys-color-surface-container)' : 'transparent', transition: 'all 0.2s' }}>
                  <input type="radio" style={{ display: 'none' }} checked={bookingChannel === channel.id} onChange={() => setBookingChannel(channel.id)} />
                  <div style={{ fontWeight: 500 }}>{channel.label}</div>
                </label>
              ))}
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              {catalog.services.map(service => (
                <div key={service.id} className="micro-haptic" onClick={() => setServiceId(service.id)} style={{ padding: 16, border: `2px solid ${serviceId === service.id ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-highest)'}`, borderRadius: 'var(--md-shape-corner-medium)', cursor: 'pointer', background: 'var(--md-sys-color-surface-container-low)', transition: 'all 0.2s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: 16 }}>{service.name}</h3>
                    <span style={{ fontWeight: 600, color: 'var(--md-sys-color-primary)' }}>{catalog.tenant.currency} {((service.price - service.discount) / 100).toFixed(2)}</span>
                  </div>
                  <div style={{ fontSize: 14, opacity: 0.7, marginTop: 4 }}>{service.duration} mins</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="animate-fade-in" style={{ display: 'grid', gap: 20 }}>
            <h2>2. Choose a Professional</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              <div className="micro-haptic" onClick={() => { setStaffId('any'); setStep(3); }} style={{ padding: 16, border: `2px solid ${staffId === 'any' ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-highest)'}`, borderRadius: 'var(--md-shape-corner-medium)', cursor: 'pointer', background: 'var(--md-sys-color-surface-container-low)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--md-sys-color-surface-container-highest)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✨</div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>Any available professional</h3>
                </div>
              </div>
              {catalog.staff.map(member => (
                <div key={member.id} className="micro-haptic" onClick={() => { setStaffId(member.id); setStep(3); }} style={{ padding: 16, border: `2px solid ${staffId === member.id ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-highest)'}`, borderRadius: 'var(--md-shape-corner-medium)', cursor: 'pointer', background: 'var(--md-sys-color-surface-container-low)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--md-sys-color-surface-container-highest)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>👤</div>
                    <h3 style={{ margin: 0, fontSize: 16 }}>{member.name}</h3>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="animate-fade-in" style={{ display: 'grid', gap: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>3. Select Date & Time</h2>
              <input className="chic-input" type="date" min={new Date().toISOString().slice(0, 10)} value={date} onChange={e => setDate(e.target.value)} style={{ width: 'auto' }} />
            </div>

            {status && <div style={{ textAlign: 'center', padding: 24, opacity: 0.7 }}>{status}</div>}

            {!status && slots.length === 0 && (
              <div style={{ textAlign: 'center', padding: 32, background: 'var(--md-sys-color-surface-container-low)', borderRadius: 12 }}>
                <p>No availability on this date.</p>
                <button className="micro-haptic" onClick={advanceNextDay} style={{ background: 'var(--md-sys-color-surface-container-highest)', color: 'var(--md-sys-color-on-surface)', border: 'none', padding: '10px 20px', borderRadius: 20, marginTop: 12, cursor: 'pointer' }}>Check Next Day</button>
              </div>
            )}

            {!status && slots.length > 0 && (
              <div style={{ display: 'grid', gap: 24 }}>
                {morningSlots.length > 0 && (
                  <div>
                    <h4 style={{ margin: '0 0 12px 0', opacity: 0.7 }}>Morning</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
                      {morningSlots.map(item => (
                        <button key={`${item.staffId}-${item.start}`} className="micro-haptic" onClick={() => setSlot(item)} style={{ padding: '12px 8px', background: slot === item ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-low)', color: slot === item ? 'var(--md-sys-color-on-primary)' : 'var(--md-sys-color-on-surface)', border: `1px solid ${slot === item ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-highest)'}`, borderRadius: 8, cursor: 'pointer', fontWeight: 500 }}>
                          {new Date(item.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {afternoonSlots.length > 0 && (
                  <div>
                    <h4 style={{ margin: '0 0 12px 0', opacity: 0.7 }}>Afternoon</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
                      {afternoonSlots.map(item => (
                        <button key={`${item.staffId}-${item.start}`} className="micro-haptic" onClick={() => setSlot(item)} style={{ padding: '12px 8px', background: slot === item ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-low)', color: slot === item ? 'var(--md-sys-color-on-primary)' : 'var(--md-sys-color-on-surface)', border: `1px solid ${slot === item ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-highest)'}`, borderRadius: 8, cursor: 'pointer', fontWeight: 500 }}>
                          {new Date(item.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {eveningSlots.length > 0 && (
                  <div>
                    <h4 style={{ margin: '0 0 12px 0', opacity: 0.7 }}>Evening</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
                      {eveningSlots.map(item => (
                        <button key={`${item.staffId}-${item.start}`} className="micro-haptic" onClick={() => setSlot(item)} style={{ padding: '12px 8px', background: slot === item ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-low)', color: slot === item ? 'var(--md-sys-color-on-primary)' : 'var(--md-sys-color-on-surface)', border: `1px solid ${slot === item ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-highest)'}`, borderRadius: 8, cursor: 'pointer', fontWeight: 500 }}>
                          {new Date(item.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {step === 4 && (
          <section className="animate-fade-in" style={{ display: 'grid', gap: 20 }}>
            <h2>4. Your Details</h2>
            <div style={{ background: 'var(--md-sys-color-surface-container-low)', padding: 16, borderRadius: 12, marginBottom: 8 }}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>{selectedService?.name}</div>
              <div style={{ opacity: 0.8, fontSize: 14 }}>{new Date(slot.start).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            </div>

            <input className="chic-input" required placeholder="Full Name" value={client.name} onChange={e => setClient({...client, name: e.target.value})} />
            <input className="chic-input" required type="email" placeholder="Email Address" value={client.email} onChange={e => setClient({...client, email: e.target.value})} />
            <input className="chic-input" required type="tel" placeholder="Phone Number" value={client.phone} onChange={e => setClient({...client, phone: e.target.value})} />

            {bookingChannel === 'mobile' && (
              <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
                <h3 style={{ fontSize: 16, margin: '8px 0 0 0' }}>Location Details</h3>
                <input className="chic-input" required placeholder="Street Address" value={mobileAddress.line1} onChange={e => setMobileAddress({...mobileAddress, line1: e.target.value})} />
                <input className="chic-input" placeholder="Apt, Suite, etc. (Optional)" value={mobileAddress.line2} onChange={e => setMobileAddress({...mobileAddress, line2: e.target.value})} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <input className="chic-input" required placeholder="City" value={mobileAddress.city} onChange={e => setMobileAddress({...mobileAddress, city: e.target.value})} />
                  <input className="chic-input" required placeholder="Postcode" value={mobileAddress.postcode} onChange={e => setMobileAddress({...mobileAddress, postcode: e.target.value})} />
                </div>
                <textarea className="chic-input" placeholder="Access notes or parking instructions (Optional)" value={mobileAddress.accessNotes} onChange={e => setMobileAddress({...mobileAddress, accessNotes: e.target.value})} style={{ resize: 'vertical', minHeight: 80 }} />
              </div>
            )}

            {catalog.paymentMode === 'customer_choice' && (
              <label className="micro-haptic" style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--md-sys-color-surface-container-low)', padding: 16, borderRadius: 12, cursor: 'pointer', marginTop: 8 }}>
                <input type="checkbox" checked={payNow} onChange={e => setPayNow(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--md-sys-color-primary)' }} />
                <span>Pay securely online now</span>
              </label>
            )}
          </section>
        )}
      </div>

      {/* THUMB ZONE FOOTER */}
      <div className="thumb-zone-footer">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {step > 1 ? (
            <button className="micro-haptic" onClick={() => setStep(step - 1)} style={{ background: 'transparent', border: 'none', color: 'var(--md-sys-color-on-surface)', opacity: 0.7, cursor: 'pointer', padding: '4px 0', textAlign: 'left', fontWeight: 500 }}>
              ← Back
            </button>
          ) : <div/>}
          {selectedService && <div style={{ fontSize: 14, fontWeight: 600 }}>Total: {catalog.tenant.currency} {((selectedService.price - selectedService.discount) / 100).toFixed(2)}</div>}
        </div>
        <button 
          className="micro-haptic"
          disabled={!canContinue() || submitting}
          onClick={handleContinue}
          style={{ 
            background: canContinue() ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-high)', 
            color: canContinue() ? 'var(--md-sys-color-on-primary)' : 'rgba(255,255,255,0.3)', 
            border: 'none', 
            padding: '14px 28px', 
            borderRadius: 24, 
            fontSize: 16, 
            fontWeight: 600, 
            cursor: canContinue() ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s',
            boxShadow: canContinue() ? '0 4px 12px rgba(212, 175, 55, 0.3)' : 'none'
          }}>
          {submitting ? 'Processing...' : (step === 4 ? 'Confirm Booking' : 'Continue')}
        </button>
      </div>
    </main>
  );
}
