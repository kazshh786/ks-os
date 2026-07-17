'use client';

import React, { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../../tenant.module.css';

interface BookingDetails {
  id: string;
  tenantId: string;
  tenantName: string;
  clientName: string;
  serviceId: string;
  serviceName: string;
  serviceDuration: number;
  staffId: string;
  staffName: string;
  startTime: string;
  endTime: string;
  status: string;
  notes: string;
  mobileAddress: {
    line1?: string;
    city?: string;
    postcode?: string;
  } | null;
}

export default function CustomerBookingManagementPage({
  params,
}: {
  params: Promise<{ subdomain: string; reference: string }>;
}) {
  const { subdomain, reference } = use(params);
  const router = useRouter();

  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Address edit state
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [postcode, setPostcode] = useState('');

  // Reschedule state
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [isUpdating, setIsUpdating] = useState(false);

  // Load the target booking details
  useEffect(() => {
    const fetchBooking = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/internal/bookings?reference=${reference}&subdomain=${subdomain}`);
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'Failed to load booking details.');
        }
        const data = await res.json();
        setBooking(data);

        // Prepopulate address fields
        if (data.mobileAddress) {
          setLine1(data.mobileAddress.line1 || '');
          setCity(data.mobileAddress.city || '');
          setPostcode(data.mobileAddress.postcode || '');
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchBooking();
  }, [subdomain, reference]);

  // Load slots when rescheduling is opened or date changes
  useEffect(() => {
    if (!isRescheduling || !booking) return;

    const loadSlots = async () => {
      try {
        setLoadingSlots(true);
        // Call the public availability API
        const res = await fetch(`/api/v1/service/tenants/${booking.tenantId}/availability?serviceId=${booking.serviceId}&staffId=${booking.staffId}&date=${selectedDate}&bookingChannel=${booking.mobileAddress ? 'mobile' : 'in_shop'}`);
        if (!res.ok) throw new Error('Failed to load available times');
        const data = await res.json();
        setAvailableSlots(data.slots || []);
      } catch (err: any) {
        setError('Could not load availability: ' + err.message);
      } finally {
        setLoadingSlots(false);
      }
    };

    loadSlots();
  }, [isRescheduling, selectedDate, booking]);

  const handleUpdateAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!booking) return;

    try {
      setIsUpdating(true);
      setError(null);
      setSuccessMessage(null);

      const res = await fetch('/api/internal/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: booking.tenantId,
          appointmentId: booking.id,
          staffId: booking.staffId,
          startTime: booking.startTime,
          endTime: booking.endTime,
          status: booking.status,
          notes: booking.notes,
          bookingReference: reference,
          mobileAddress: { line1, city, postcode }
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to update address.');
      }

      setBooking({ ...booking, mobileAddress: { line1, city, postcode } });
      setSuccessMessage('Travel address updated successfully! ✨');
      setIsEditingAddress(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCancelBooking = async () => {
    if (!booking || !confirm('Are you sure you want to cancel this booking? This action cannot be undone.')) return;

    try {
      setIsUpdating(true);
      setError(null);
      setSuccessMessage(null);

      const res = await fetch('/api/internal/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: booking.tenantId,
          appointmentId: booking.id,
          staffId: booking.staffId,
          startTime: booking.startTime,
          endTime: booking.endTime,
          status: 'CANCELLED',
          notes: booking.notes,
          bookingReference: reference
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to cancel booking.');
      }

      setBooking({ ...booking, status: 'CANCELLED' });
      setSuccessMessage('Your booking has been cancelled. We hope to see you another time.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSelectRescheduleSlot = async (slot: any) => {
    if (!booking) return;

    try {
      setIsUpdating(true);
      setError(null);
      setSuccessMessage(null);

      const res = await fetch('/api/internal/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: booking.tenantId,
          appointmentId: booking.id,
          staffId: slot.staffId,
          startTime: slot.start,
          endTime: slot.end,
          status: booking.status,
          notes: booking.notes,
          bookingReference: reference
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to reschedule.');
      }

      setBooking({
        ...booking,
        startTime: slot.start,
        endTime: slot.end,
        staffId: slot.staffId,
        staffName: slot.staffName
      });

      setSuccessMessage('Appointment rescheduled successfully! 📅✨');
      setIsRescheduling(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUpdating(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#090d16', color: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Retrieving appointment details...
      </div>
    );
  }

  if (error && !booking) {
    return (
      <div style={{ minHeight: '100vh', background: '#090d16', color: '#cbd5e1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <h2 style={{ color: 'var(--md-sys-color-error)' }}>Booking Details Unavailable</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!booking) return null;

  return (
    <div style={{ minHeight: '100vh', background: '#090d16', color: '#cbd5e1', fontFamily: 'var(--md-font-sans)', padding: '40px 20px' }}>
      <main style={{ maxWidth: 640, margin: '0 auto', background: '#111625', border: '1px solid rgba(212,175,55,0.15)', borderRadius: 16, padding: '32px', boxSizing: 'border-box', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
        <header style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, background: 'linear-gradient(135deg, #ffffff 0%, #d4af37 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {booking.tenantName} Booking Portal
          </h1>
          <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>Manage your upcoming salon reservation</p>
        </header>

        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', padding: 14, borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        {successMessage && (
          <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#34d399', padding: 14, borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
            🎉 {successMessage}
          </div>
        )}

        {/* Booking Card */}
        <div style={{ background: '#090d16', borderRadius: 12, padding: 20, marginBottom: 24, border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 12, textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.05em' }}>
              Status: <span style={{ color: booking.status === 'CANCELLED' ? '#ef4444' : '#10b981' }}>{booking.status}</span>
            </span>
            <span style={{ fontSize: 11, color: '#64748b' }}>Ref: {reference.slice(0, 8)}</span>
          </div>

          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 8px 0' }}>{booking.serviceName}</h2>
          <p style={{ margin: '0 0 16px 0', fontSize: 14, color: '#94a3b8' }}>with {booking.staffName} ({booking.serviceDuration} mins)</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📅</span>
              <span>
                {new Date(booking.startTime).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⏰</span>
              <span>
                {new Date(booking.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(booking.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {booking.mobileAddress && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 4 }}>
                <span>📍</span>
                <div>
                  <div style={{ fontWeight: 600, color: '#fff' }}>Mobile Travel Location:</div>
                  <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>
                    {booking.mobileAddress.line1}, {booking.mobileAddress.city}, {booking.mobileAddress.postcode}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {booking.status !== 'CANCELLED' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Action Buttons */}
            {!isRescheduling && !isEditingAddress && (
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={() => setIsRescheduling(true)}
                  disabled={isUpdating}
                  className="micro-haptic"
                  style={{ flex: 1, padding: 12, background: 'var(--md-sys-color-primary)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: 'pointer' }}
                >
                  📅 Reschedule
                </button>

                {booking.mobileAddress && (
                  <button
                    onClick={() => setIsEditingAddress(true)}
                    disabled={isUpdating}
                    className="micro-haptic"
                    style={{ flex: 1, padding: 12, background: '#1e293b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#cbd5e1', fontWeight: 700, cursor: 'pointer' }}
                  >
                    📍 Edit Address
                  </button>
                )}

                <button
                  onClick={handleCancelBooking}
                  disabled={isUpdating}
                  className="micro-haptic"
                  style={{ padding: 12, background: 'transparent', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, color: '#f87171', fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel Booking
                </button>
              </div>
            )}

            {/* Editing Address Section */}
            {isEditingAddress && (
              <form onSubmit={handleUpdateAddress} style={{ display: 'flex', flexDirection: 'column', gap: 16, background: '#090d16', padding: 20, borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#fff' }}>Edit Travel Address</h3>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Address Line 1</label>
                  <input
                    type="text"
                    required
                    style={{ width: '100%', padding: 10, background: '#111625', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#fff', boxSizing: 'border-box' }}
                    value={line1}
                    onChange={(e) => setLine1(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>City</label>
                    <input
                      type="text"
                      required
                      style={{ width: '100%', padding: 10, background: '#111625', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#fff', boxSizing: 'border-box' }}
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Postcode</label>
                    <input
                      type="text"
                      required
                      style={{ width: '100%', padding: 10, background: '#111625', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#fff', boxSizing: 'border-box' }}
                      value={postcode}
                      onChange={(e) => setPostcode(e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <button type="submit" disabled={isUpdating} style={{ flex: 1, padding: 10, background: '#10b981', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                    {isUpdating ? 'Saving...' : 'Save Address'}
                  </button>
                  <button type="button" onClick={() => setIsEditingAddress(false)} style={{ flex: 1, padding: 10, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#94a3b8', cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Rescheduling Section */}
            {isRescheduling && (
              <div style={{ background: '#090d16', padding: 20, borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: 15, fontWeight: 700, color: '#fff' }}>Select New Time Slot</h3>
                
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Choose Date</label>
                  <input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    style={{ width: '100%', padding: 10, background: '#111625', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#fff', boxSizing: 'border-box' }}
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                </div>

                {loadingSlots ? (
                  <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 13, color: '#94a3b8' }}>
                    Searching availability...
                  </div>
                ) : availableSlots.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 13, color: '#ef4444' }}>
                    No slots available on this date.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, maxHeight: 200, overflowY: 'auto', padding: 4, background: '#111625', borderRadius: 8, marginBottom: 16 }}>
                    {availableSlots.map((slot) => {
                      const timeStr = new Date(slot.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                      return (
                        <button
                          key={slot.start}
                          onClick={() => handleSelectRescheduleSlot(slot)}
                          disabled={isUpdating}
                          style={{ padding: '10px 4px', background: '#090d16', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                        >
                          {timeStr}
                        </button>
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setIsRescheduling(false)}
                  style={{ width: '100%', padding: 10, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#94a3b8', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
