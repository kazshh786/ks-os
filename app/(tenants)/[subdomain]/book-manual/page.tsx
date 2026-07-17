'use client';

import React, { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';

export default function ManualBookingPage({ params }: { params: Promise<{ subdomain: string }> }) {
  const resolvedParams = use(params);
  const subdomain = resolvedParams.subdomain;
  const router = useRouter();

  // Tenant / collections loaded from DB
  const [tenantId, setTenantId] = useState<string>('');
  const [tenantName, setTenantName] = useState<string>('');
  const [services, setServices] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Client search / lookup
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [clientSearchResults, setClientSearchResults] = useState<any[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  // Booking details form states
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');

  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [selectedTime, setSelectedTime] = useState('');
  const [appointmentNotes, setAppointmentNotes] = useState('');

  // Available slots finder
  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [staffPricingRules, setStaffPricingRules] = useState<any[]>([]);
  const [existingAppointments, setExistingAppointments] = useState<any[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1. Resolve workspace context
  useEffect(() => {
    const loadWorkspace = async () => {
      try {
        setLoading(true);
        const { data: tenant, error: tErr } = await supabase
          .from('tenants')
          .select('id, name')
          .eq('subdomain', subdomain.toLowerCase())
          .single();

        if (tErr || !tenant) {
          throw new Error('Workspace not found.');
        }

        setTenantId(tenant.id);
        setTenantName(tenant.name);

        const { data: svcData } = await supabase
          .from('services')
          .select('*')
          .eq('tenant_id', tenant.id);
        setServices(svcData || []);

        const { data: staffData } = await supabase
          .from('users')
          .select('id, name, email')
          .eq('tenant_id', tenant.id);
        setStaff(staffData || []);

        const { data: resData } = await supabase
          .from('resources')
          .select('*')
          .eq('tenant_id', tenant.id);
        setResources(resData || []);

      } catch (err: any) {
        setError(err.message || 'Failed to load workspace parameters.');
      } finally {
        setLoading(false);
      }
    };

    loadWorkspace();
  }, [subdomain]);

  // 2. Client autocomplete lookup query
  useEffect(() => {
    if (clientSearchQuery.trim() === '') {
      setClientSearchResults([]);
      return;
    }

    const searchClients = async () => {
      try {
        const { data } = await supabase
          .from('clients')
          .select('*')
          .eq('tenant_id', tenantId)
          .ilike('name', `%${clientSearchQuery}%`)
          .limit(5);
        setClientSearchResults(data || []);
      } catch (err) {
        console.error('Failed to query client database:', err);
      }
    };

    const delayDebounce = setTimeout(searchClients, 300);
    return () => clearTimeout(delayDebounce);
  }, [clientSearchQuery, tenantId]);

  // 3. Load staff pricing overrides for selected service
  useEffect(() => {
    if (!selectedServiceId) {
      setStaffPricingRules([]);
      return;
    }
    const loadPricing = async () => {
      const { data } = await supabase
        .from('staff_pricing')
        .select('*')
        .eq('service_id', selectedServiceId);
      setStaffPricingRules(data || []);
    };
    loadPricing();
  }, [selectedServiceId]);

  // 4. Calculate slot availability
  useEffect(() => {
    if (!selectedServiceId || !selectedStaffId || !selectedDate || !tenantId) {
      setAvailableSlots([]);
      return;
    }

    const calculateManualAvailability = async () => {
      setLoadingSlots(true);
      try {
        const targetDate = new Date(selectedDate);
        const dayOfWeek = targetDate.getDay();

        // 1. Fetch schedules for the stylist
        const { data: schedules } = await supabase
          .from('staff_schedules')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('user_id', selectedStaffId)
          .eq('day_of_week', dayOfWeek);

        if (!schedules || schedules.length === 0) {
          setAvailableSlots([]);
          return;
        }

        // 2. Fetch existing appointments to block busy times
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const { data: appointments } = await supabase
          .from('appointments')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('user_id', selectedStaffId)
          .gte('start_time', startOfDay.toISOString())
          .lte('start_time', endOfDay.toISOString())
          .neq('status', 'CANCELLED');

        setExistingAppointments(appointments || []);

        const selectedService = services.find((s) => s.id === selectedServiceId);
        if (!selectedService) return;

        const staffOverride = staffPricingRules.find((p) => p.user_id === selectedStaffId);
        const serviceDuration = staffOverride ? staffOverride.custom_duration_minutes : selectedService.duration;

        const generated: any[] = [];

        schedules.forEach((schedule: any) => {
          const [startH, startM] = schedule.start_time.split(':').map(Number);
          const [endH, endM] = schedule.end_time.split(':').map(Number);

          const workStartMinutes = startH * 60 + startM;
          const workEndMinutes = endH * 60 + endM;

          const interval = 15; // 15 min interval for staff flexibility
          for (let min = workStartMinutes; min + serviceDuration <= workEndMinutes; min += interval) {
            const slotStartHour = Math.floor(min / 60);
            const slotStartMin = min % 60;

            const slotStartDate = new Date(targetDate);
            slotStartDate.setHours(slotStartHour, slotStartMin, 0, 0);

            const slotEndDate = new Date(slotStartDate);
            slotEndDate.setMinutes(slotStartDate.getMinutes() + serviceDuration);

            // check overlap
            const hasOverlap = (appointments || []).some((appt) => {
              const apptStart = new Date(appt.start_time);
              const apptEnd = new Date(appt.end_time);
              return slotStartDate < apptEnd && slotEndDate > apptStart;
            });

            if (!hasOverlap) {
              const timeStr = slotStartDate.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
              });
              generated.push({
                timeStr,
                dateTime: slotStartDate,
                duration: serviceDuration
              });
            }
          }
        });

        setAvailableSlots(generated);
      } catch (err) {
        console.error('Failed calculating manual slots:', err);
      } finally {
        setLoadingSlots(false);
      }
    };

    calculateManualAvailability();
  }, [selectedServiceId, selectedStaffId, selectedDate, tenantId, services, staffPricingRules]);

  const selectClient = (client: any) => {
    setSelectedClientId(client.id);
    setClientName(client.name);
    setClientEmail(client.email || '');
    setClientPhone(client.phone || '');
    setClientSearchQuery('');
    setClientSearchResults([]);
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !selectedServiceId || !selectedStaffId || !selectedDate || !selectedTime) {
      alert('Please fill in all required scheduling parameters.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const startDateTime = new Date(`${selectedDate}T${selectedTime}:00`);
      
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const resourceName = resources.find((r) => r.id === selectedResourceId)?.name || '';
      const notes = resourceName ? `[Resource: ${resourceName}] ${appointmentNotes}` : appointmentNotes;

      const res = await fetch('/api/internal/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          tenantId,
          serviceId: selectedServiceId,
          staffId: selectedStaffId,
          startTime: startDateTime.toISOString(),
          clientName: clientName || null,
          clientEmail: clientEmail.trim().toLowerCase() || null,
          clientPhone: clientPhone || null,
          status: 'CONFIRMED',
          notes: notes,
          resourceId: selectedResourceId || null,
          clientId: selectedClientId || null,
          idempotencyKey: crypto.randomUUID()
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to create booking.');
      }

      // Direct back to main subdomain portal page
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message || 'Failed to record manual booking.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#090d16', color: '#cbd5e1' }}>
        Resolving booking desk variables...
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#090d16', color: '#cbd5e1', fontFamily: 'var(--md-font-sans)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: '#111625', padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(212,175,55,0.15)' }}>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 800, background: 'linear-gradient(135deg, #ffffff 0%, #d4af37 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          🏢 {tenantName.toUpperCase()} Manual Booking Desk
        </h1>
        <button
          onClick={() => { window.location.href = '/'; }}
          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', borderRadius: '99px', padding: '8px 18px', cursor: 'pointer', fontWeight: 700 }}
        >
          ← Return to Board
        </button>
      </header>

      <main style={{ flex: 1, padding: '32px 24px', width: '100%', maxWidth: '720px', margin: '0 auto', boxSizing: 'border-box' }}>
        {error && <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', padding: '14px', borderRadius: '8px', marginBottom: '20px', fontSize: '13px' }}>{error}</div>}

        <form onSubmit={handleBookingSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* STEP 1: Client Details Lookup */}
          <div style={{ background: '#111625', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '16px', padding: '24px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: 800, color: '#ffffff' }}>1. Client Lookup & Information</h3>
            
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <input
                type="text"
                placeholder="🔍 Search existing client directory..."
                className="form-input"
                style={{ width: '100%', padding: '12px', background: '#090d16', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '8px', color: '#fff', outline: 'none', boxSizing: 'border-box' }}
                value={clientSearchQuery}
                onChange={(e) => setClientSearchQuery(e.target.value)}
              />

              {clientSearchResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#0b101d', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', zIndex: 10, marginTop: '4px', overflow: 'hidden' }}>
                  {clientSearchResults.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => selectClient(client)}
                      style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '10px 14px', color: '#fff', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
                    >
                      <strong style={{ fontSize: '12px' }}>{client.name}</strong>
                      <span style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>{client.email || 'No email'} • {client.phone || 'No phone'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700 }}>Client Name: *</label>
                <input
                  type="text"
                  required
                  placeholder="Jane Doe"
                  style={{ padding: '12px', background: '#090d16', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#fff', outline: 'none' }}
                  value={clientName}
                  onChange={(e) => { setClientName(e.target.value); setSelectedClientId(null); }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700 }}>Client Email:</label>
                  <input
                    type="email"
                    placeholder="jane@gmail.com"
                    style={{ padding: '12px', background: '#090d16', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#fff', outline: 'none' }}
                    value={clientEmail}
                    onChange={(e) => { setClientEmail(e.target.value); setSelectedClientId(null); }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700 }}>Client Phone:</label>
                  <input
                    type="tel"
                    placeholder="+44 7777777777"
                    style={{ padding: '12px', background: '#090d16', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#fff', outline: 'none' }}
                    value={clientPhone}
                    onChange={(e) => { setClientPhone(e.target.value); setSelectedClientId(null); }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* STEP 2: Service & Staff selector */}
          <div style={{ background: '#111625', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '16px', padding: '24px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: 800, color: '#ffffff' }}>2. Service & Provider Allocation</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700 }}>Treatment Service: *</label>
                <select
                  required
                  value={selectedServiceId}
                  onChange={(e) => { setSelectedServiceId(e.target.value); setSelectedTime(''); }}
                  style={{ padding: '12px', background: '#090d16', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#fff', outline: 'none', width: '100%' }}
                >
                  <option value="">-- Choose Service --</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.duration} min) - ${(s.price / 100).toFixed(2)}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700 }}>Stylist / Barber: *</label>
                <select
                  required
                  value={selectedStaffId}
                  onChange={(e) => { setSelectedStaffId(e.target.value); setSelectedTime(''); }}
                  style={{ padding: '12px', background: '#090d16', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#fff', outline: 'none', width: '100%' }}
                >
                  <option value="">-- Choose Stylist --</option>
                  {staff.map((sm) => (
                    <option key={sm.id} value={sm.id}>{sm.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700 }}>Room / Equipment Allocation:</label>
                <select
                  value={selectedResourceId}
                  onChange={(e) => setSelectedResourceId(e.target.value)}
                  style={{ padding: '12px', background: '#090d16', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#fff', outline: 'none', width: '100%' }}
                >
                  <option value="">-- No Room Allocation --</option>
                  {resources.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} ({r.type})</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700 }}>Choose Booking Date: *</label>
                <input
                  type="date"
                  required
                  style={{ padding: '12px', background: '#090d16', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#fff', outline: 'none', boxSizing: 'border-box', width: '100%' }}
                  value={selectedDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => { setSelectedDate(e.target.value); setSelectedTime(''); }}
                />
              </div>
            </div>
          </div>

          {/* STEP 3: Time Slot Calculator */}
          {selectedServiceId && selectedStaffId && (
            <div style={{ background: '#111625', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '16px', padding: '24px' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: 800, color: '#ffffff' }}>3. Select Time Opening</h3>
              
              {loadingSlots ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '13px' }}>Calculating open slots for this stylist...</div>
              ) : availableSlots.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#f87171', fontSize: '13px' }}>No available openings for this stylist on this day. Select another date or therapist.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px', maxHeight: '200px', overflowY: 'auto', paddingRight: '4px' }}>
                  {availableSlots.map((slot, idx) => {
                    const isActive = selectedTime === slot.timeStr;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedTime(slot.timeStr)}
                        style={{
                          background: isActive ? 'var(--accent-color, #d4af37)' : 'rgba(255,255,255,0.03)',
                          border: isActive ? '1px solid var(--accent-color, #d4af37)' : '1px solid rgba(255,255,255,0.06)',
                          color: isActive ? '#1e1400' : '#ffffff',
                          padding: '10px 8px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontWeight: 700,
                          fontSize: '12px',
                          transition: 'all 0.2s'
                        }}
                      >
                        {slot.timeStr}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* STEP 4: Appointment Notes */}
          <div style={{ background: '#111625', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '16px', padding: '24px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: 800, color: '#ffffff' }}>4. Internal Appointment Notes</h3>
            <textarea
              placeholder="e.g. Requested windows slot. Client has mild skin sensitivity. walk-in booking..."
              style={{ width: '100%', padding: '12px', background: '#090d16', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#fff', outline: 'none', resize: 'none', boxSizing: 'border-box' }}
              rows={3}
              value={appointmentNotes}
              onChange={(e) => setAppointmentNotes(e.target.value)}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '16px' }}>
            <button
              type="button"
              onClick={() => router.push('/')}
              style={{ flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', borderRadius: '99px', padding: '14px', cursor: 'pointer', fontWeight: 800, fontSize: '13px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedTime}
              style={{
                flex: 1,
                background: selectedTime ? 'var(--accent-color, #d4af37)' : 'rgba(255,255,255,0.04)',
                color: selectedTime ? '#1e1400' : '#64748b',
                borderRadius: '99px',
                padding: '14px',
                cursor: selectedTime ? 'pointer' : 'not-allowed',
                fontWeight: 800,
                fontSize: '13px',
                border: 'none',
                boxShadow: selectedTime ? '0 4px 14px rgba(212, 175, 55, 0.25)' : 'none'
              }}
            >
              {isSubmitting ? 'Recording Booking...' : 'Save manual booking'}
            </button>
          </div>

        </form>
      </main>
    </div>
  );
}
