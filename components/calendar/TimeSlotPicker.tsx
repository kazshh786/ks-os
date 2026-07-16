'use client';

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/utils/supabase/client';
import styles from './TimeSlotPicker.module.css';
import FormRenderer from '../forms/FormRenderer';

interface Service {
  id: string;
  name: string;
  duration: number; // in minutes
  price: number; // in cents
  discount?: number; // in cents
}

interface Staff {
  id: string;
  name: string;
}

interface TimeSlotPickerProps {
  tenantId: string;
  services: Service[];
  staffMembers: Staff[];
  onSlotSelected: (slot: { date: Date; staffId: string; serviceId: string }) => void;
}

interface AvailableSlot {
  timeStr: string; // "HH:MM"
  dateTime: Date;
  staffId: string;
  staffName: string;
  price: number; // custom or default service price
  duration: number; // custom or default service duration
}

export default function TimeSlotPicker({ tenantId, services, staffMembers, onSlotSelected }: TimeSlotPickerProps) {
  // Navigation & View Mode
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('calendar');
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [selectedStaffId, setSelectedStaffId] = useState<string>('any'); // 'any' or specific staffId
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0]; // YYYY-MM-DD
  });

  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staffPricingRules, setStaffPricingRules] = useState<any[]>([]);

  // Real-time synchronization
  const [reloadTrigger, setReloadTrigger] = useState(0);

  // Booking Flow Steps Dialog
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [modalStep, setModalStep] = useState<'info' | 'intake' | 'deposit' | 'confirm'>('info');

  // Multi-step form values
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');

  // Medical compliance / patch test details
  const [allergyNotes, setAllergyNotes] = useState('');
  const [patchTestConfirmed, setPatchTestConfirmed] = useState(false);
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  const [isSubmittingBooking, setIsSubmittingBooking] = useState(false);

  // Signature canvas pad references
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState('');

  // Customizable form states
  const [customForm, setCustomForm] = useState<any>(null);
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [formResponses, setFormResponses] = useState<Record<string, any>>({});

  // 1. Subscribe to appointments Real-time channels to auto-recalculate
  useEffect(() => {
    const channel = supabase
      .channel('realtime-avail-picker')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments', filter: `tenant_id=eq.${tenantId}` },
        () => {
          setReloadTrigger((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId]);

  // 2. Fetch staff-specific pricing configuration
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

  // 2. Fetch Dynamic Consent Form Template
  useEffect(() => {
    if (!tenantId || tenantId === '00000000-0000-0000-0000-000000000000') return;
    const fetchFormTemplate = async () => {
      try {
        const { data } = await supabase
          .from('forms')
          .select('*')
          .eq('tenant_id', tenantId)
          .limit(1)
          .maybeSingle();

        if (data) {
          setCustomForm(data);
          setCustomFields(data.fields_json || []);
        } else {
          setCustomFields([
            { label: 'Allergies or Skin conditions?', type: 'textarea', required: false },
            { label: 'I consent to the treatment', type: 'checkbox', required: true },
            { label: 'Client Signature', type: 'signature', required: true }
          ]);
        }
      } catch (err) {
        console.error('Error fetching consent form details:', err);
      }
    };
    fetchFormTemplate();
  }, [tenantId]);

  // 3. Calculate Availability slots
  useEffect(() => {
    if (!selectedServiceId || !selectedDate) {
      setAvailableSlots([]);
      return;
    }

    const calculateAvailability = async () => {
      setLoading(true);
      setError(null);
      try {
        const targetDate = new Date(selectedDate);
        const dayOfWeek = targetDate.getDay();

        // Fetch staff schedules for this day of week
        let scheduleQuery = supabase
          .from('staff_schedules')
          .select('*, users(name)')
          .eq('tenant_id', tenantId)
          .eq('day_of_week', dayOfWeek);

        if (selectedStaffId !== 'any') {
          scheduleQuery = scheduleQuery.eq('user_id', selectedStaffId);
        }

        const { data: schedules, error: schedErr } = await scheduleQuery;
        if (schedErr) throw schedErr;

        if (!schedules || schedules.length === 0) {
          setAvailableSlots([]);
          return;
        }

        // Fetch existing appointments to block busy times
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        let apptsQuery = supabase
          .from('appointments')
          .select('*')
          .eq('tenant_id', tenantId)
          .gte('start_time', startOfDay.toISOString())
          .lte('start_time', endOfDay.toISOString())
          .neq('status', 'CANCELLED');

        if (selectedStaffId !== 'any') {
          apptsQuery = apptsQuery.eq('user_id', selectedStaffId);
        }

        const { data: appointments, error: apptErr } = await apptsQuery;
        if (apptErr) throw apptErr;

        const selectedService = services.find((s) => s.id === selectedServiceId);
        if (!selectedService) {
          setAvailableSlots([]);
          return;
        }

        const generatedSlots: AvailableSlot[] = [];

        schedules.forEach((schedule: any) => {
          const staffId = schedule.user_id;
          const staffName = schedule.users?.name || 'Stylist';

          // Apply staff-specific duration and pricing overrides
          const staffOverride = staffPricingRules.find((p) => p.user_id === staffId);
          const serviceDuration = staffOverride ? staffOverride.custom_duration_minutes : selectedService.duration;
          const basePrice = staffOverride ? staffOverride.custom_price_in_cents : selectedService.price;
          const servicePrice = Math.max(0, basePrice - (selectedService.discount || 0));

          const [startH, startM] = schedule.start_time.split(':').map(Number);
          const [endH, endM] = schedule.end_time.split(':').map(Number);

          const workStartMinutes = startH * 60 + startM;
          const workEndMinutes = endH * 60 + endM;

          const interval = 30; // generate every 30 mins
          for (let min = workStartMinutes; min + serviceDuration <= workEndMinutes; min += interval) {
            const slotStartHour = Math.floor(min / 60);
            const slotStartMin = min % 60;

            const slotStartDate = new Date(targetDate);
            slotStartDate.setHours(slotStartHour, slotStartMin, 0, 0);

            const slotEndDate = new Date(slotStartDate);
            slotEndDate.setMinutes(slotStartDate.getMinutes() + serviceDuration);

            // Block booking slots in the past
            if (slotStartDate.getTime() < Date.now()) {
              continue;
            }

            const hasOverlap = (appointments || []).some((appt) => {
              if (appt.user_id !== staffId) return false;
              const apptStart = new Date(appt.start_time);
              const apptEnd = new Date(appt.end_time);
              return slotStartDate < apptEnd && slotEndDate > apptStart;
            });

            if (!hasOverlap) {
              const timeStr = slotStartDate.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              });

              generatedSlots.push({
                timeStr,
                dateTime: slotStartDate,
                staffId,
                staffName,
                price: servicePrice,
                duration: serviceDuration,
              });
            }
          }
        });

        generatedSlots.sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
        setAvailableSlots(generatedSlots);
      } catch (err: any) {
        setError(err.message || 'Error loading slots');
      } finally {
        setLoading(false);
      }
    };

    calculateAvailability();
  }, [selectedServiceId, selectedStaffId, selectedDate, tenantId, services, staffPricingRules, reloadTrigger]);

  // Handle clicking a slot
  const handleSlotClick = (slot: AvailableSlot) => {
    setSelectedSlot(slot);
    setModalStep('info');
    setIsModalOpen(true);
  };

  // Generate the next 7 days for the date picker ribbon
  const getNext7Days = () => {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      dates.push(d);
    }
    return dates;
  };

  // Signature canvas operations
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    const coords = getEventCoords(e, canvas);
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const coords = getEventCoords(e, canvas);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    if (canvasRef.current && hasSignature) {
      setSignatureDataUrl(canvasRef.current.toDataURL());
    }
  };

  const getEventCoords = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement
  ) => {
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    setSignatureDataUrl('');
  };

  // Submit flow database writer
  const handleFinalBooking = async () => {
    if (!selectedSlot) return;
    setIsSubmittingBooking(true);
    setError(null);

    try {
      // 1. Search or create client profile
      let clientId = '';
      const { data: existingClient } = await supabase
        .from('clients')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('email', clientEmail.trim().toLowerCase())
        .maybeSingle();

      if (existingClient) {
        clientId = existingClient.id;
        // Update client notes / patch test
        await supabase
          .from('clients')
          .update({
            medical_notes: allergyNotes || 'None',
            patch_test_date: patchTestConfirmed ? new Date().toISOString() : null,
            phone: clientPhone,
          })
          .eq('id', clientId);
      } else {
        const { data: newClient, error: createClientErr } = await supabase
          .from('clients')
          .insert({
            tenant_id: tenantId,
            name: clientName,
            email: clientEmail.trim().toLowerCase(),
            phone: clientPhone,
            medical_notes: allergyNotes || 'None',
            patch_test_date: patchTestConfirmed ? new Date().toISOString() : null,
          })
          .select('id')
          .single();

        if (createClientErr) throw createClientErr;
        clientId = newClient.id;
      }

      // 2. Fetch or create a form template to link form submission
      let formId = '00000000-0000-0000-0000-000000000000';
      const { data: existingForm } = await supabase
        .from('forms')
        .select('id')
        .eq('tenant_id', tenantId)
        .limit(1)
        .maybeSingle();

      if (existingForm) {
        formId = existingForm.id;
      } else {
        // Seed default medical intake form row
        const { data: seededForm } = await supabase
          .from('forms')
          .insert({
            tenant_id: tenantId,
            title: 'Medical History & Patch Test Consent',
            fields_json: [
              { label: 'Allergy Notes', type: 'textarea', required: false },
              { label: 'Consent Wave', type: 'checkbox', required: true },
            ],
          })
          .select('id')
          .single();

        if (seededForm) formId = seededForm.id;
      }

      // Write submission record
      await supabase.from('client_form_submissions').insert({
        tenant_id: tenantId,
        client_id: clientId,
        form_id: formId,
        response_json: formResponses,
      });

      // 3. Create appointment
      const serviceDuration = selectedSlot.duration;
      const endDateTime = new Date(selectedSlot.dateTime);
      endDateTime.setMinutes(endDateTime.getMinutes() + serviceDuration);

      const { data: appt, error: apptErr } = await supabase
        .from('appointments')
        .insert({
          tenant_id: tenantId,
          user_id: selectedSlot.staffId,
          client_id: clientId,
          client_name: clientName,
          service_id: selectedServiceId,
          start_time: selectedSlot.dateTime.toISOString(),
          end_time: endDateTime.toISOString(),
          status: 'CONFIRMED',
        })
        .select('id')
        .single();

      if (apptErr) throw apptErr;

      // Staff-side scheduling never handles card data or fabricates a payment.
      // Online deposits/full payments go through the public Stripe booking flow.
      setModalStep('confirm');
    } catch (err: any) {
      alert(err.message || 'Failed to complete checkout booking.');
    } finally {
      setIsSubmittingBooking(false);
    }
  };

  return (
    <div className={styles.widgetContainer}>
      <div className={styles.widgetHeader}>
        <h3 className={styles.widgetTitle}>Live Scheduling Desk</h3>
        <div className={styles.viewToggle}>
          <button
            onClick={() => setViewMode('list')}
            className={`${styles.toggleBtn} ${viewMode === 'list' ? styles.toggleBtnActive : ''}`}
          >
            Classic List
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`${styles.toggleBtn} ${viewMode === 'calendar' ? styles.toggleBtnActive : ''}`}
          >
            Showcase Calendar
          </button>
        </div>
      </div>

      {/* 1. Service Selection */}
      <div className={styles.inputGroup}>
        <label htmlFor="service-select" className={styles.label}>1. Select Treatment / Service</label>
        <select
          id="service-select"
          className={styles.select}
          value={selectedServiceId}
          onChange={(e) => setSelectedServiceId(e.target.value)}
        >
          <option value="">-- Click to choose service --</option>
          {services.map((s) => {
            const hasDiscount = s.discount && s.discount > 0;
            const finalPrice = hasDiscount ? Math.max(0, s.price - s.discount) : s.price;
            return (
              <option key={s.id} value={s.id}>
                {s.name} ({s.duration} min) — {hasDiscount ? `Discounted: £${(finalPrice / 100).toFixed(2)} (was £${(s.price / 100).toFixed(2)})` : `£${(s.price / 100).toFixed(2)}`}
              </option>
            );
          })}
        </select>
      </div>

      {/* 2. Staff Selection */}
      {viewMode === 'list' && (
        <div className={styles.inputGroup}>
          <label htmlFor="staff-select" className={styles.label}>2. Preferred Provider</label>
          <select
            id="staff-select"
            className={styles.select}
            value={selectedStaffId}
            onChange={(e) => setSelectedStaffId(e.target.value)}
          >
            <option value="any">Any Available Stylist</option>
            {staffMembers.map((sm) => (
              <option key={sm.id} value={sm.id}>
                {sm.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 3. Date Selection (RIBBON for Calendar, INPUT for List) */}
      {selectedServiceId !== '' && (
        <>
          {viewMode === 'list' ? (
            <div className={styles.inputGroup}>
              <label htmlFor="date-select" className={styles.label}>3. Choose Booking Date</label>
              <input
                id="date-select"
                type="date"
                className={styles.inputDate}
                value={selectedDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
            </div>
          ) : (
            <div className={styles.inputGroup}>
              <label className={styles.label}>2. Choose Booking Date</label>
              <div className={styles.dateRibbon}>
                {getNext7Days().map((d) => {
                  const dateStr = d.toISOString().split('T')[0];
                  const dayName = d.toLocaleDateString(undefined, { weekday: 'short' });
                  const dateNum = d.getDate();
                  const isActive = selectedDate === dateStr;

                  return (
                    <button
                      key={dateStr}
                      onClick={() => setSelectedDate(dateStr)}
                      className={`${styles.ribbonItem} ${isActive ? styles.ribbonItemActive : ''}`}
                    >
                      <span className={styles.ribbonDay}>{dayName}</span>
                      <span className={styles.ribbonDate}>{dateNum}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Slots Display */}
      {selectedServiceId !== '' && (
        <div className={styles.slotsWrapper}>
          <h4 className={styles.slotsHeader}>Available Openings</h4>

          {loading && <div className={styles.statusMessage}>Calculating real-time slots...</div>}
          {error && <div className={styles.errorMessage}>{error}</div>}

          {!loading && !error && availableSlots.length === 0 && (
            <div className={styles.emptyMessage}>No available slots found for this date. Select another day.</div>
          )}

          {!loading && !error && availableSlots.length > 0 && (
            <>
              {viewMode === 'list' ? (
                <div className={styles.slotsGrid}>
                  {availableSlots.map((slot) => (
                    <button
                      key={`${slot.staffId}-${slot.dateTime.toISOString()}`}
                      className={styles.slotButton}
                      onClick={() => handleSlotClick(slot)}
                    >
                      <span className={styles.slotTime}>{slot.timeStr}</span>
                      <span className={styles.slotStaff}>w/ {slot.staffName}</span>
                      <span className={styles.slotPrice}>£{(slot.price / 100).toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                /* Showcase Calendar columns (staff grouped) */
                <div className={styles.calendarColumnsGrid}>
                  {staffMembers.map((sm) => {
                    const staffSlots = availableSlots.filter((slot) => slot.staffId === sm.id);
                    return (
                      <div key={sm.id} className={styles.staffColumn}>
                        <div className={styles.staffColumnHeader}>{sm.name}</div>
                        {staffSlots.length === 0 ? (
                          <span style={{ fontSize: '11px', color: '#64748b', marginTop: '12px' }}>Fully Booked</span>
                        ) : (
                          staffSlots.map((slot) => (
                            <button
                              key={`${slot.staffId}-${slot.dateTime.toISOString()}`}
                              className={styles.slotButton}
                              onClick={() => handleSlotClick(slot)}
                            >
                              <span className={styles.slotTime}>{slot.timeStr}</span>
                              <span className={styles.slotPrice}>£{(slot.price / 100).toFixed(2)}</span>
                            </button>
                          ))
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {selectedServiceId === '' && (
        <div className={styles.emptyMessage}>Please select a service above to search availability calendar.</div>
      )}

      {/* Multi-step checkout Dialog portal */}
      {isModalOpen && selectedSlot && (
        <>
          <div className={styles.overlay} onClick={() => { if (modalStep !== 'confirm') setIsModalOpen(false); }} />
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h4 className={styles.modalTitle}>Secure Your Slot</h4>
              {modalStep !== 'confirm' && (
                <button className={styles.closeBtn} onClick={() => setIsModalOpen(false)}>×</button>
              )}
            </div>

            {/* Steps indicator */}
            <div className={styles.stepIndicator}>
              <div className={`${styles.stepDot} ${modalStep === 'info' ? styles.stepDotActive : styles.stepDotDone}`}>1</div>
              <div className={`${styles.stepDot} ${modalStep === 'intake' ? styles.stepDotActive : modalStep === 'deposit' || modalStep === 'confirm' ? styles.stepDotDone : ''}`}>2</div>
              <div className={`${styles.stepDot} ${modalStep === 'deposit' ? styles.stepDotActive : modalStep === 'confirm' ? styles.stepDotDone : ''}`}>3</div>
              <div className={`${styles.stepDot} ${modalStep === 'confirm' ? styles.stepDotActive : ''}`}>4</div>
            </div>

            {/* STEP 1: Contact Details */}
            {modalStep === 'info' && (
              <div className={styles.stepBody}>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter your name"
                    className={styles.formInputText}
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                  />
                </div>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="Enter email"
                    className={styles.formInputText}
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                  />
                </div>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Phone Number</label>
                  <input
                    type="tel"
                    required
                    placeholder="Enter mobile phone"
                    className={styles.formInputText}
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                  />
                </div>

                <div className={styles.stepFooter}>
                  <button
                    className={styles.primaryBtn}
                    onClick={() => {
                      if (!clientName || !clientEmail || !clientPhone) {
                        alert('All details are required.');
                        return;
                      }
                      setModalStep('intake');
                    }}
                  >
                    Next: Compliance Form
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: Compliance Forms & Signature Canvas */}
            {modalStep === 'intake' && (
              <div className={styles.stepBody}>
                <FormRenderer
                  title={customForm?.title || 'Compliance Intake & Consent'}
                  fields={customFields}
                  onSubmit={(responses) => {
                    setFormResponses(responses);
                    setModalStep('deposit');
                  }}
                />
              </div>
            )}

            {/* STEP 3: Staff-side booking review */}
            {modalStep === 'deposit' && (
              <div className={styles.stepBody}>
                <h5 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#cbd5e1' }}>Review your booking</h5>
                <div className={styles.summaryRow}>
                  <span>Service Total:</span>
                  <strong>£{(selectedSlot.price / 100).toFixed(2)}</strong>
                </div>
                <div className={styles.summaryTotalRow}>
                  <span>Payment:</span>
                  <strong>Pay at appointment</strong>
                </div>

                <div className={styles.infoBanner} style={{ marginTop: '14px' }}>
                  <strong>Online payments are coming soon.</strong>
                  <span>No card details are collected today. Your provider will take payment at the appointment.</span>
                </div>

                <div className={styles.stepFooter}>
                  <button className={styles.secondaryBtn} onClick={() => setModalStep('intake')}>
                    Back
                  </button>
                  <button
                    className={styles.primaryBtn}
                    disabled={isSubmittingBooking}
                    onClick={handleFinalBooking}
                  >
                    {isSubmittingBooking ? 'Confirming booking…' : 'Confirm booking'}
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: Booking confirmation */}
            {modalStep === 'confirm' && (
              <div className={styles.stepBody}>
                <div style={{ textAlign: 'center', margin: '10px 0' }}>
                  <span style={{ fontSize: '48px', color: '#10b981' }}>✔️</span>
                  <h4 style={{ margin: '12px 0 4px 0', fontSize: '18px', fontWeight: 800 }}>Appointment Confirmed!</h4>
                  <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>
                    Your booking is safe. Real-time slot availability updated.
                  </p>
                </div>

                <div className={styles.infoBanner}>
                  <strong>Booking details</strong>
                  <span>
                    {services.find((s) => s.id === selectedServiceId)?.name} with {selectedSlot.staffName} on{' '}
                    {new Date(selectedSlot.dateTime).toLocaleDateString()} at{' '}
                    {new Date(selectedSlot.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                    Payment of £{(selectedSlot.price / 100).toFixed(2)} is due at the appointment.
                  </span>
                </div>

                <div className={styles.stepFooter}>
                  <button
                    className={styles.primaryBtn}
                    onClick={() => {
                      setIsModalOpen(false);
                      onSlotSelected({
                        date: selectedSlot.dateTime,
                        staffId: selectedSlot.staffId,
                        serviceId: selectedServiceId,
                      });
                    }}
                  >
                    Close & Finish
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
