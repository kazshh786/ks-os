'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/utils/supabase/client';
import styles from './TimeSlotPicker.module.css';

interface Service {
  id: string;
  name: string;
  duration: number; // in minutes
  price: number; // in cents
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
}

export default function TimeSlotPicker({ tenantId, services, staffMembers, onSlotSelected }: TimeSlotPickerProps) {
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [selectedStaffId, setSelectedStaffId] = useState<string>('any'); // 'any' or specific staffId
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0]; // YYYY-MM-DD
  });

  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load available slots when parameters change
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
        const dayOfWeek = targetDate.getDay(); // 0 = Sunday, 1 = Monday, ...

        // 1. Fetch schedules for the day of week
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

        // 2. Fetch existing appointments for this date
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
          .neq('status', 'CANCELLED'); // Ignore cancelled slots

        if (selectedStaffId !== 'any') {
          apptsQuery = apptsQuery.eq('user_id', selectedStaffId);
        }

        const { data: appointments, error: apptErr } = await apptsQuery;
        if (apptErr) throw apptErr;

        // 3. Math calculation for available slots
        const selectedService = services.find((s) => s.id === selectedServiceId);
        const serviceDuration = selectedService ? selectedService.duration : 30; // default 30m
        const generatedSlots: AvailableSlot[] = [];

        schedules.forEach((schedule: any) => {
          const staffId = schedule.user_id;
          const staffName = schedule.users?.name || 'Stylist';

          // Parse start and end hours
          const [startH, startM] = schedule.start_time.split(':').map(Number);
          const [endH, endM] = schedule.end_time.split(':').map(Number);

          const workStartMinutes = startH * 60 + startM;
          const workEndMinutes = endH * 60 + endM;

          // Generate 30-minute intervals
          const interval = 30; 
          for (let min = workStartMinutes; min + serviceDuration <= workEndMinutes; min += interval) {
            const slotStartHour = Math.floor(min / 60);
            const slotStartMin = min % 60;

            const slotStartDate = new Date(targetDate);
            slotStartDate.setHours(slotStartHour, slotStartMin, 0, 0);

            const slotEndDate = new Date(slotStartDate);
            slotEndDate.setMinutes(slotStartDate.getMinutes() + serviceDuration);

            // Check if this slot overlaps with any appointment for this staff member
            const hasOverlap = (appointments || []).some((appt) => {
              if (appt.user_id !== staffId) return false;
              const apptStart = new Date(appt.start_time);
              const apptEnd = new Date(appt.end_time);

              // Overlap logic: Start A < End B AND End A > Start B
              return slotStartDate < apptEnd && slotEndDate > apptStart;
            });

            if (!hasOverlap) {
              const timeStr = slotStartDate.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });

              generatedSlots.push({
                timeStr,
                dateTime: slotStartDate,
                staffId,
                staffName,
              });
            }
          });
        });

        // Sort slots chronologically
        generatedSlots.sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
        setAvailableSlots(generatedSlots);
      } catch (err: any) {
        setError(err.message || 'Error loading slots');
      } finally {
        setLoading(false);
      }
    };

    calculateAvailability();
  }, [selectedServiceId, selectedStaffId, selectedDate, tenantId, services]);

  const handleSlotClick = (slot: AvailableSlot) => {
    onSlotSelected({
      date: slot.dateTime,
      staffId: slot.staffId,
      serviceId: selectedServiceId,
    });
  };

  return (
    <div className={styles.widgetContainer}>
      <h3 className={styles.widgetTitle}>Book an Appointment</h3>
      
      {/* 1. Service Selection */}
      <div className={styles.inputGroup}>
        <label htmlFor="service-select" className={styles.label}>Select Service</label>
        <select
          id="service-select"
          className={styles.select}
          value={selectedServiceId}
          onChange={(e) => setSelectedServiceId(e.target.value)}
        >
          <option value="">-- Choose a service --</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.duration} min) - ${(s.price / 100).toFixed(2)}
            </option>
          ))}
        </select>
      </div>

      {/* 2. Staff Selection */}
      <div className={styles.inputGroup}>
        <label htmlFor="staff-select" className={styles.label}>Preferred Provider</label>
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

      {/* 3. Date Selection */}
      <div className={styles.inputGroup}>
        <label htmlFor="date-select" className={styles.label}>Choose Date</label>
        <input
          id="date-select"
          type="date"
          className={styles.inputDate}
          value={selectedDate}
          min={new Date().toISOString().split('T')[0]} // Block historical dates
          onChange={(e) => setSelectedDate(e.target.value)}
        />
      </div>

      {/* 4. Slot Availability Display */}
      <div className={styles.slotsWrapper}>
        <h4 className={styles.slotsHeader}>Available Times</h4>
        
        {loading && <div className={styles.statusMessage}>Calculating available slots...</div>}
        {error && <div className={styles.errorMessage}>{error}</div>}
        
        {!loading && !error && selectedServiceId === '' && (
          <div className={styles.emptyMessage}>Please select a service to view openings.</div>
        )}

        {!loading && !error && selectedServiceId !== '' && availableSlots.length === 0 && (
          <div className={styles.emptyMessage}>No available slots found for this selection. Try another date.</div>
        )}

        {!loading && !error && availableSlots.length > 0 && (
          <div className={styles.slotsGrid}>
            {availableSlots.map((slot, idx) => (
              <button
                key={idx}
                className={styles.slotButton}
                onClick={() => handleSlotClick(slot)}
              >
                <span className={styles.slotTime}>{slot.timeStr}</span>
                {selectedStaffId === 'any' && (
                  <span className={styles.slotStaff}>w/ {slot.staffName}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
