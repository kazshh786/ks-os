'use client';

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { supabase } from '@/utils/supabase/client';
import { useRealtimeAppointments, Appointment } from '@/utils/useRealtimeAppointments';
import styles from './WeeklyCalendar.module.css';

interface WeeklyCalendarProps {
  tenantId: string;
  staffMembers: { id: string; name: string }[];
  services: { id: string; name: string; price: number; duration: number }[];
  onCheckoutAppt?: (apptId: string) => void;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function WeeklyCalendar({ tenantId, staffMembers, services, onCheckoutAppt }: WeeklyCalendarProps) {
  const { appointments, loading, error } = useRealtimeAppointments(tenantId);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  
  // Dialog, Rescheduling & Details states
  const [activeAppointment, setActiveAppointment] = useState<Appointment | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editStaffId, setEditStaffId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editStart, setEditStart] = useState('09:00');
  const [editEnd, setEditEnd] = useState('10:00');
  const [editStatus, setEditStatus] = useState('PENDING');
  const [editNotes, setEditNotes] = useState('');
  const [editResource, setEditResource] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Time-Block Form states
  const [isBlockOpen, setIsBlockOpen] = useState(false);
  const [blockStaffId, setBlockStaffId] = useState('');
  const [blockDate, setBlockDate] = useState('');
  const [blockStart, setBlockStart] = useState('09:00');
  const [blockEnd, setBlockEnd] = useState('10:00');
  const [blockReason, setBlockReason] = useState('');
  const [blockResource, setBlockResource] = useState('');
  const [isSavingBlock, setIsSavingBlock] = useState(false);

  // Group Bookings states
  const [isGroupBooking, setIsGroupBooking] = useState(false);
  const [groupGuests, setGroupGuests] = useState('');

  // Resources state loaded from DB
  const [resources, setResources] = useState<any[]>([]);

  // Sliding 360 CRM Drawer states
  const [crmDrawerOpen, setCrmDrawerOpen] = useState(false);
  const [crmClientId, setCrmClientId] = useState('');
  const [crmClientInfo, setCrmClientInfo] = useState<any>(null);
  const [crmClientHistory, setCrmClientHistory] = useState<any[]>([]);
  const [crmClientWallet, setCrmClientWallet] = useState<any>(null);
  const [crmFormulaNotes, setCrmFormulaNotes] = useState('');
  const [isSavingFormula, setIsSavingFormula] = useState(false);

  // Waitlist Alert states
  const [waitlistAlert, setWaitlistAlert] = useState<{
    clientName: string;
    serviceName: string;
    waitlistId: string;
    date: string;
  } | null>(null);

  // Drag and Drop highlights
  const [dragOverDayIdx, setDragOverDayIdx] = useState<number | null>(null);

  // Hour limits for the salon day
  const startHour = 8; // 8:00 AM
  const endHour = 20;  // 8:00 PM
  const totalHours = endHour - startHour;
  const hourHeight = 60; // 60px per hour row

  // Load resources
  useEffect(() => {
    const loadResources = async () => {
      const { data } = await supabase
        .from('resources')
        .select('*')
        .eq('tenant_id', tenantId);
      setResources(data || []);
    };
    loadResources();
  }, [tenantId]);

  const getStartOfWeek = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setHours(0, 0, 0, 0);
    return new Date(d.setDate(diff));
  };

  const startOfWeek = getStartOfWeek(selectedDate);

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return d;
  });

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const getAppointmentPosition = (startStr: string, endStr: string) => {
    const start = new Date(startStr);
    const end = new Date(endStr);
    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = end.getHours() * 60 + end.getMinutes();
    const startOffsetMin = startMin - startHour * 60;
    const durationMin = endMin - startMin;

    const top = (startOffsetMin / 60) * hourHeight;
    const height = (durationMin / 60) * hourHeight;

    return { top: `${top}px`, height: `${height}px` };
  };

  const getAppointmentsForDay = (date: Date) => {
    return appointments.filter((appt) => {
      const apptDate = new Date(appt.startTime);
      return (
        apptDate.getDate() === date.getDate() &&
        apptDate.getMonth() === date.getMonth() &&
        apptDate.getFullYear() === date.getFullYear()
      );
    });
  };

  const changeWeek = (offset: number) => {
    const next = new Date(selectedDate);
    next.setDate(selectedDate.getDate() + offset * 7);
    setSelectedDate(next);
  };

  // Helper to extract resource name and actual notes from formatted notes string
  const parseNotes = (notesStr: string | null) => {
    if (!notesStr) return { resource: '', actualNotes: '' };
    const match = notesStr.match(/^\[Resource:\s*([^\]]+)\]\s*(.*)$/s);
    if (match) {
      return { resource: match[1], actualNotes: match[2] };
    }
    return { resource: '', actualNotes: notesStr };
  };

  // Helper to format resource name into notes string
  const formatNotes = (resourceName: string, notes: string) => {
    if (!resourceName) return notes;
    return `[Resource: ${resourceName}] ${notes}`;
  };

  // Check for physical resource/room conflicts
  const hasResourceConflict = (
    resourceName: string,
    startStr: string,
    endStr: string,
    excludeApptId?: string
  ) => {
    if (!resourceName) return false;
    const start = new Date(startStr);
    const end = new Date(endStr);

    const concurrent = appointments.filter((appt) => {
      if (appt.id === excludeApptId || appt.status === 'CANCELLED') return false;
      
      const apptStart = new Date(appt.startTime);
      const apptEnd = new Date(appt.endTime);
      const isConcurrent = start < apptEnd && end > apptStart;
      
      if (!isConcurrent) return false;
      const { resource } = parseNotes(appt.notes);
      return resource.toLowerCase() === resourceName.toLowerCase();
    });

    const resourceLimit = resources.find((r) => r.name.toLowerCase() === resourceName.toLowerCase())?.capacity || 1;
    return concurrent.length >= resourceLimit;
  };

  // Handle Drag & Drop Rescheduling
  const handleDragStart = (e: React.DragEvent, apptId: string) => {
    e.dataTransfer.setData('text/plain', apptId);
  };

  const handleDragOver = (e: React.DragEvent, dayIdx: number) => {
    e.preventDefault();
    setDragOverDayIdx(dayIdx);
  };

  const handleDragLeave = () => {
    setDragOverDayIdx(null);
  };

  const handleDrop = async (e: React.DragEvent, date: Date) => {
    e.preventDefault();
    setDragOverDayIdx(null);
    const apptId = e.dataTransfer.getData('text/plain');
    if (!apptId) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;

    // Calculate slots snapping to nearest 15 mins
    const totalMinutes = Math.round(((offsetY / hourHeight) * 60) / 15) * 15;
    const dropHour = startHour + Math.floor(totalMinutes / 60);
    const dropMin = totalMinutes % 60;

    const targetStart = new Date(date);
    targetStart.setHours(dropHour, dropMin, 0, 0);

    const appt = appointments.find((a) => a.id === apptId);
    if (!appt) return;

    const durationMs = new Date(appt.endTime).getTime() - new Date(appt.startTime).getTime();
    const targetEnd = new Date(targetStart.getTime() + durationMs);

    // Validate resource availability
    const { resource, actualNotes } = parseNotes(appt.notes);
    if (resource && hasResourceConflict(resource, targetStart.toISOString(), targetEnd.toISOString(), apptId)) {
      alert(`Resource Conflict: ${resource} is occupied at this time!`);
      return;
    }

    const { error: dropErr } = await supabase
      .from('appointments')
      .update({
        start_time: targetStart.toISOString(),
        end_time: targetEnd.toISOString(),
      })
      .eq('id', apptId);

    if (dropErr) {
      alert('Rescheduling failed: ' + dropErr.message);
    }
  };

  // Open Edit Appointment Form
  const handleOpenEdit = (appt: Appointment) => {
    setActiveAppointment(appt);
    setIsEditing(false);
    
    setEditStaffId(appt.userId);
    const dateObj = new Date(appt.startTime);
    setEditDate(dateObj.toISOString().split('T')[0]);
    setEditStart(dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    
    const endDateObj = new Date(appt.endTime);
    setEditEnd(endDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    setEditStatus(appt.status);
    
    const { resource, actualNotes } = parseNotes(appt.notes);
    setEditResource(resource);
    setEditNotes(actualNotes);
  };

  const handleSaveChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAppointment || !editStaffId || !editDate || !editStart || !editEnd) return;
    setIsSavingEdit(true);

    try {
      const startDateTime = new Date(`${editDate}T${editStart}:00`);
      const endDateTime = new Date(`${editDate}T${editEnd}:00`);

      if (endDateTime <= startDateTime) {
        alert('End time must be after start time.');
        return;
      }

      // Check Resource overlap
      if (editResource && hasResourceConflict(editResource, startDateTime.toISOString(), endDateTime.toISOString(), activeAppointment.id)) {
        alert(`Resource Conflict: ${editResource} is already fully booked in this slot.`);
        return;
      }

      const finalFormattedNotes = formatNotes(editResource, editNotes);

      const { error: updateErr } = await supabase
        .from('appointments')
        .update({
          user_id: editStaffId,
          start_time: startDateTime.toISOString(),
          end_time: endDateTime.toISOString(),
          status: editStatus,
          notes: finalFormattedNotes
        })
        .eq('id', activeAppointment.id);

      if (updateErr) throw updateErr;

      // Trigger Waitlist Scan if appointment is CANCELLED
      if (editStatus === 'CANCELLED') {
        scanWaitlist(activeAppointment.id, activeAppointment.serviceId, startDateTime.toISOString());
      }

      setIsEditing(false);
      setActiveAppointment(null);
    } catch (err: any) {
      alert(err.message || 'Failed to update appointment.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleSaveBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockStaffId || !blockDate || !blockStart || !blockEnd) return;
    setIsSavingBlock(true);

    try {
      const startDateTime = new Date(`${blockDate}T${blockStart}:00`);
      const endDateTime = new Date(`${blockDate}T${blockEnd}:00`);

      if (endDateTime <= startDateTime) {
        alert('End time must be after start time.');
        return;
      }

      // Check Resource overlap
      if (blockResource && hasResourceConflict(blockResource, startDateTime.toISOString(), endDateTime.toISOString())) {
        alert(`Resource Conflict: ${blockResource} is already occupied.`);
        return;
      }

      const finalBlockNotes = formatNotes(blockResource, blockReason || 'Busy block');

      if (isGroupBooking && groupGuests.trim() !== '') {
        // Group booking: Create multiple concurrent slot blocks
        const guests = groupGuests.split(',').map((g) => g.trim());
        const bookingPromises = guests.map((guestName) => {
          return supabase.from('appointments').insert({
            tenant_id: tenantId,
            user_id: blockStaffId,
            start_time: startDateTime.toISOString(),
            end_time: endDateTime.toISOString(),
            status: 'CONFIRMED',
            client_name: guestName,
            notes: `[Group Appointment w/ ${guests.join(', ')}] ${finalBlockNotes}`
          });
        });

        await Promise.all(bookingPromises);
      } else {
        // Single Busy block
        const { error: insertErr } = await supabase
          .from('appointments')
          .insert({
            tenant_id: tenantId,
            user_id: blockStaffId,
            start_time: startDateTime.toISOString(),
            end_time: endDateTime.toISOString(),
            status: 'BLOCKED',
            client_name: 'Blocked Time',
            notes: finalBlockNotes
          });

        if (insertErr) throw insertErr;
      }

      setBlockReason('');
      setBlockResource('');
      setGroupGuests('');
      setIsGroupBooking(false);
      setIsBlockOpen(false);
    } catch (err: any) {
      alert(err.message || 'Failed to save time block.');
    } finally {
      setIsSavingBlock(false);
    }
  };

  // Waitlist Scanner
  const scanWaitlist = async (apptId: string, serviceId: string, startTime: string) => {
    try {
      // Find waitlisted clients seeking the cancelled service
      const { data: waitlisted } = await supabase
        .from('waitlist')
        .select('*, clients(name, email), services(name)')
        .eq('tenant_id', tenantId)
        .eq('service_id', serviceId)
        .eq('status', 'PENDING')
        .limit(1);

      if (waitlisted && waitlisted.length > 0) {
        const entry = waitlisted[0];
        setWaitlistAlert({
          clientName: entry.clients?.name || 'Waitlist Client',
          serviceName: entry.services?.name || 'Treatment',
          waitlistId: entry.id,
          date: new Date(startTime).toLocaleDateString()
        });
      }
    } catch (err) {
      console.error('Failed waitlist scan:', err);
    }
  };

  // Auto-fill slot from waitlist match
  const handleFillWaitlistSlot = async () => {
    if (!waitlistAlert || !activeAppointment) return;
    try {
      // Fetch details of waitlisted client
      const { data: wl } = await supabase
        .from('waitlist')
        .select('client_id, staff_id')
        .eq('id', waitlistAlert.waitlistId)
        .single();

      if (!wl) return;

      // Update the cancelled appointment card to the waitlist client details
      await supabase
        .from('appointments')
        .update({
          client_id: wl.client_id,
          client_name: waitlistAlert.clientName,
          status: 'CONFIRMED',
          notes: `Waitlist slot auto-filled. Reason: cancelled appointment #${activeAppointment.id}`
        })
        .eq('id', activeAppointment.id);

      // Update waitlist entry to FILLED
      await supabase
        .from('waitlist')
        .update({ status: 'FILLED' })
        .eq('id', waitlistAlert.waitlistId);

      setWaitlistAlert(null);
      setActiveAppointment(null);
      alert('Waitlist client successfully booked into slot!');
    } catch (err: any) {
      alert(err.message || 'Failed to fill waitlist slot.');
    }
  };

  // Open 360-Degree CRM Profile Side-Drawer
  const handleOpenCRM = async (clientId: string) => {
    setCrmClientId(clientId);
    setCrmDrawerOpen(true);
    
    try {
      // 1. Client profile information
      const { data: client } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();
      setCrmClientInfo(client);
      setCrmFormulaNotes(client?.medical_notes || '');

      // 2. Client visit history (last 3 visits)
      const { data: pastVisits } = await supabase
        .from('appointments')
        .select('*, services(name)')
        .eq('client_id', clientId)
        .order('start_time', { ascending: false })
        .limit(3);
      setCrmClientHistory(pastVisits || []);

      // 3. Active packages / loyalty wallets
      const { data: wallet } = await supabase
        .from('client_wallets')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();
      setCrmClientWallet(wallet);

    } catch (err) {
      console.error('Failed to load CRM client file:', err);
    }
  };

  const handleUpdateFormula = async () => {
    if (!crmClientId) return;
    setIsSavingFormula(true);
    try {
      const { error: updErr } = await supabase
        .from('clients')
        .update({ medical_notes: crmFormulaNotes })
        .eq('id', crmClientId);

      if (updErr) throw updErr;
      setCrmClientInfo((prev: any) => ({ ...prev, medical_notes: crmFormulaNotes }));
      alert('Client formula and allergies file updated successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to save formula.');
    } finally {
      setIsSavingFormula(false);
    }
  };

  if (loading) return <div className={styles.loadingContainer}>Loading calendar schedule...</div>;
  if (error) return <div className={styles.errorContainer}>Error: {error}</div>;

  return (
    <div className={styles.calendarContainer}>
      {/* Calendar Header Control Bar */}
      <div className={styles.calendarHeader}>
        <div className={styles.brandTitle}>
          <h2>Studio Operations Scheduler</h2>
          <span className={styles.dateRangeLabel}>
            Week of {startOfWeek.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>

        <div className={styles.navigationControls}>
          <button className={styles.navButton} onClick={() => changeWeek(-1)}>Previous Week</button>
          <button className={styles.todayButton} onClick={() => setSelectedDate(new Date())}>Today</button>
          <button className={styles.navButton} onClick={() => changeWeek(1)}>Next Week</button>
          <button className={styles.todayButton} onClick={() => window.location.href = '/book-manual'}>
            ➕ Manual Book Desk
          </button>

          <Dialog.Root open={isBlockOpen} onOpenChange={setIsBlockOpen}>
            <Dialog.Trigger asChild>
              <button 
                onClick={() => {
                  if (staffMembers.length > 0) setBlockStaffId(staffMembers[0].id);
                  setBlockDate(new Date().toISOString().split('T')[0]);
                }}
                className={styles.blockBtn}
              >
                🔒 Block / Group Booking
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className={styles.modalOverlay} />
              <Dialog.Content className={styles.modalContent}>
                <Dialog.Title className={styles.modalTitle}>Allocate Stylist Hours</Dialog.Title>
                <p className={styles.modalDesc}>Set up blocks for lunch breaks or reserve slots for group bookings.</p>
                
                <form onSubmit={handleSaveBlock} className={styles.blockForm}>
                  <div className={styles.formGroup}>
                    <label>Select Stylist:</label>
                    <select 
                      value={blockStaffId} 
                      onChange={(e) => setBlockStaffId(e.target.value)}
                      className={styles.formSelect}
                      required
                    >
                      <option value="">-- Choose Stylist --</option>
                      {staffMembers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Resource / Room Reservation:</label>
                    <select
                      value={blockResource}
                      onChange={(e) => setBlockResource(e.target.value)}
                      className={styles.formSelect}
                    >
                      <option value="">-- None (No Room Reservation) --</option>
                      {resources.map((r) => (
                        <option key={r.id} value={r.name}>{r.name} ({r.type})</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Date:</label>
                    <input 
                      type="date" 
                      value={blockDate} 
                      onChange={(e) => setBlockDate(e.target.value)}
                      className={styles.formInput}
                      required
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label>Start Time:</label>
                      <input 
                        type="time" 
                        value={blockStart} 
                        onChange={(e) => setBlockStart(e.target.value)}
                        className={styles.formInput}
                        required
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label>End Time:</label>
                      <input 
                        type="time" 
                        value={blockEnd} 
                        onChange={(e) => setBlockEnd(e.target.value)}
                        className={styles.formInput}
                        required
                      />
                    </div>
                  </div>

                  {/* Group Booking Section */}
                  <div className={styles.formGroup}>
                    <div className={{ display: 'flex', alignItems: 'center', gap: '8px' } as any}>
                      <input
                        type="checkbox"
                        id="group-toggle"
                        checked={isGroupBooking}
                        onChange={(e) => setIsGroupBooking(e.target.checked)}
                      />
                      <label htmlFor="group-toggle" style={{ fontWeight: 800, cursor: 'pointer' }}>Group Appointment (Multiple Guests)</label>
                    </div>
                    {isGroupBooking && (
                      <input
                        type="text"
                        placeholder="Guest names separated by commas (e.g. Alice, Bob, Charlie)"
                        value={groupGuests}
                        onChange={(e) => setGroupGuests(e.target.value)}
                        className={styles.formInput}
                        style={{ marginTop: '6px' }}
                        required
                      />
                    )}
                  </div>

                  <div className={styles.formGroup}>
                    <label>Notes / Reason:</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Lunch Break, Group Session"
                      value={blockReason} 
                      onChange={(e) => setBlockReason(e.target.value)}
                      className={styles.formInput}
                    />
                  </div>

                  <div className={styles.modalActions}>
                    <button type="submit" className={styles.saveBtn} disabled={isSavingBlock}>
                      {isSavingBlock ? 'Saving...' : 'Save Block'}
                    </button>
                    <Dialog.Close asChild>
                      <button type="button" className={styles.cancelBtn}>Cancel</button>
                    </Dialog.Close>
                  </div>
                </form>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>

      {/* Grid Wrapper */}
      <div className={styles.calendarGrid}>
        <div className={styles.timeColumnHeader}>Time</div>
        {weekDates.map((date, idx) => (
          <div key={idx} className={`${styles.dayHeader} ${isToday(date) ? styles.todayHeaderActive : ''}`}>
            <span className={styles.dayOfWeekText}>{DAYS[idx]}</span>
            <span className={styles.dayOfMonthText}>{date.getDate()}</span>
          </div>
        ))}

        <div className={styles.gridContentBody}>
          <div className={styles.timeSidebar}>
            {Array.from({ length: totalHours }).map((_, h) => {
              const hourNum = startHour + h;
              const ampm = hourNum >= 12 ? 'PM' : 'AM';
              const displayHour = hourNum > 12 ? hourNum - 12 : hourNum;
              return (
                <div key={h} className={styles.timeLabel} style={{ height: `${hourHeight}px` }}>
                  {displayHour}:00 {ampm}
                </div>
              );
            })}
          </div>

          <div className={styles.daysContainer}>
            <div className={styles.gridLinesContainer}>
              {Array.from({ length: totalHours }).map((_, h) => (
                <div key={h} className={styles.gridRowLine} style={{ height: `${hourHeight}px` }} />
              ))}
            </div>

            <Tooltip.Provider delayDuration={150}>
              <div className={styles.daysColumnsGrid}>
                {weekDates.map((date, colIdx) => {
                  const dayAppointments = getAppointmentsForDay(date);

                  return (
                    <div 
                      key={colIdx} 
                      className={`${styles.dayColumn} ${dragOverDayIdx === colIdx ? styles.dayColumnDragOver : ''}`}
                      onDragOver={(e) => handleDragOver(e, colIdx)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, date)}
                    >
                      {dayAppointments.map((appt) => {
                        const stylePos = getAppointmentPosition(appt.startTime, appt.endTime);
                        const assignedStaff = staffMembers.find((s) => s.id === appt.userId)?.name || 'Unassigned';
                        
                        const isBlocked = appt.status === 'BLOCKED';
                        const serviceType = isBlocked ? 'Time Block' : (services.find((s) => s.id === appt.serviceId)?.name || 'Service');
                        
                        const { resource, actualNotes } = parseNotes(appt.notes);
                        const displayName = isBlocked 
                          ? `🔒 Busy: ${actualNotes || 'Time Blocked'}` 
                          : (appt.clientName || 'Client');

                        return (
                          <Dialog.Root key={appt.id} open={activeAppointment?.id === appt.id} onOpenChange={(open) => { if (!open) setActiveAppointment(null); }}>
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <Dialog.Trigger asChild>
                                  <button
                                    draggable={appt.status !== 'COMPLETED' && appt.status !== 'CANCELLED'}
                                    onDragStart={(e) => handleDragStart(e, appt.id)}
                                    className={`${styles.appointmentCard} ${isBlocked ? styles.blocked : styles[appt.status.toLowerCase()]}`}
                                    style={stylePos}
                                    onClick={() => handleOpenEdit(appt)}
                                  >
                                    <div className={styles.cardTimeText}>
                                      {new Date(appt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                    <div className={styles.cardTitle}>{displayName}</div>
                                    {!isBlocked && <div className={styles.cardSubtitle}>{serviceType}</div>}
                                    {resource && <div style={{ fontSize: '9px', color: '#ffd700', fontWeight: 'bold' }}>📍 {resource}</div>}
                                    <div className={styles.cardStaff}>w/ {assignedStaff}</div>
                                  </button>
                                </Dialog.Trigger>
                              </Tooltip.Trigger>

                              <Tooltip.Portal>
                                <Tooltip.Content className={styles.tooltipContent} sideOffset={5}>
                                  {isBlocked ? (
                                    <>
                                      <strong>Busy Block:</strong> {actualNotes || 'Out of Office'} <br />
                                      {resource && <><strong>Room:</strong> {resource} <br /></>}
                                      <strong>Provider:</strong> {assignedStaff}
                                    </>
                                  ) : (
                                    <>
                                      <strong>Client:</strong> {appt.clientName} <br />
                                      <strong>Service:</strong> {serviceType} <br />
                                      {resource && <><strong>Room:</strong> {resource} <br /></>}
                                      <strong>Staff:</strong> {assignedStaff} <br />
                                      <strong>Status:</strong> <span className={`${styles.statusBadge} ${styles[appt.status.toLowerCase() + 'Badge']}`}>{appt.status}</span>
                                    </>
                                  )}
                                </Tooltip.Content>
                              </Tooltip.Portal>
                            </Tooltip.Root>

                            {/* Details Modal on click */}
                            <Dialog.Portal>
                              <Dialog.Overlay className={styles.modalOverlay} />
                              <Dialog.Content className={styles.modalContent}>
                                <Dialog.Title className={styles.modalTitle}>
                                  {isEditing ? 'Rearrange / Reschedule Slot' : (isBlocked ? 'Blocked Time Details' : 'Appointment Details')}
                                </Dialog.Title>
                                
                                {isEditing ? (
                                  /* Reschedule / Edit Form */
                                  <form onSubmit={handleSaveChanges} className={styles.blockForm}>
                                    <div className={styles.formGroup}>
                                      <label>Provider Assignment:</label>
                                      <select
                                        value={editStaffId}
                                        onChange={(e) => setEditStaffId(e.target.value)}
                                        className={styles.formSelect}
                                        required
                                      >
                                        {staffMembers.map((s) => (
                                          <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                      </select>
                                    </div>

                                    <div className={styles.formGroup}>
                                      <label>Resource / Room Reservation:</label>
                                      <select
                                        value={editResource}
                                        onChange={(e) => setEditResource(e.target.value)}
                                        className={styles.formSelect}
                                      >
                                        <option value="">-- None (No Room Reservation) --</option>
                                        {resources.map((r) => (
                                          <option key={r.id} value={r.name}>{r.name} ({r.type})</option>
                                        ))}
                                      </select>
                                    </div>

                                    <div className={styles.formGroup}>
                                      <label>Date:</label>
                                      <input
                                        type="date"
                                        value={editDate}
                                        onChange={(e) => setEditDate(e.target.value)}
                                        className={styles.formInput}
                                        required
                                      />
                                    </div>

                                    <div className={styles.formRow}>
                                      <div className={styles.formGroup}>
                                        <label>Start Time:</label>
                                        <input
                                          type="time"
                                          value={editStart}
                                          onChange={(e) => setEditStart(e.target.value)}
                                          className={styles.formInput}
                                          required
                                        />
                                      </div>
                                      <div className={styles.formGroup}>
                                        <label>End Time:</label>
                                        <input
                                          type="time"
                                          value={editEnd}
                                          onChange={(e) => setEditEnd(e.target.value)}
                                          className={styles.formInput}
                                          required
                                        />
                                      </div>
                                    </div>

                                    {!isBlocked && (
                                      <div className={styles.formGroup}>
                                        <label>Status:</label>
                                        <select
                                          value={editStatus}
                                          onChange={(e) => setEditStatus(e.target.value)}
                                          className={styles.formSelect}
                                          required
                                        >
                                          <option value="PENDING">Pending Approval</option>
                                          <option value="CONFIRMED">Confirmed Booked</option>
                                          <option value="COMPLETED">Completed Transaction</option>
                                          <option value="CANCELLED">Cancelled</option>
                                          <option value="NO_SHOW">No Show</option>
                                        </select>
                                      </div>
                                    )}

                                    <div className={styles.formGroup}>
                                      <label>Notes / Reason:</label>
                                      <input
                                        type="text"
                                        value={editNotes}
                                        onChange={(e) => setEditNotes(e.target.value)}
                                        className={styles.formInput}
                                      />
                                    </div>

                                    <div className={styles.modalActions}>
                                      <button type="submit" className={styles.saveBtn} disabled={isSavingEdit}>
                                        {isSavingEdit ? 'Saving...' : 'Reschedule'}
                                      </button>
                                      <button type="button" className={styles.cancelBtn} onClick={() => setIsEditing(false)}>
                                        Cancel
                                      </button>
                                    </div>
                                  </form>
                                ) : (
                                  /* Normal details display mode */
                                  <>
                                    <div className={styles.detailList}>
                                      {isBlocked ? (
                                        <>
                                          <div className={styles.detailRow}>
                                            <strong>Provider:</strong> <span>{assignedStaff}</span>
                                          </div>
                                          {resource && (
                                            <div className={styles.detailRow}>
                                              <strong>Resource:</strong> <span style={{ color: '#ffd700' }}>📍 {resource}</span>
                                            </div>
                                          )}
                                          <div className={styles.detailRow}>
                                            <strong>Reason / Notes:</strong> <span>{actualNotes || 'No notes'}</span>
                                          </div>
                                        </>
                                      ) : (
                                        <>
                                          <div className={styles.detailRow}>
                                            <strong>Client Name:</strong> 
                                            <span>
                                              {activeAppointment?.clientName}{' '}
                                              {appt.clientId && (
                                                <button
                                                  onClick={() => handleOpenCRM(appt.clientId!)}
                                                  style={{ fontSize: '10px', background: '#3c2a00', color: '#d4af37', border: '1px solid rgba(212,175,55,0.4)', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', marginLeft: '6px' }}
                                                >
                                                  CRM Profile
                                                </button>
                                              )}
                                            </span>
                                          </div>
                                          <div className={styles.detailRow}>
                                            <strong>Stylist:</strong> <span>{assignedStaff}</span>
                                          </div>
                                          <div className={styles.detailRow}>
                                            <strong>Service:</strong> <span>{serviceType}</span>
                                          </div>
                                          {resource && (
                                            <div className={styles.detailRow}>
                                              <strong>Resource Allocated:</strong> <span style={{ color: '#ffd700' }}>📍 {resource}</span>
                                            </div>
                                          )}
                                          <div className={styles.detailRow}>
                                            <strong>Notes:</strong> <span>{actualNotes || 'None'}</span>
                                          </div>
                                        </>
                                      )}
                                      <div className={styles.detailRow}>
                                        <strong>Date:</strong> <span>{new Date(activeAppointment?.startTime || '').toLocaleDateString()}</span>
                                      </div>
                                      <div className={styles.detailRow}>
                                        <strong>Time:</strong> <span>
                                          {new Date(activeAppointment?.startTime || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {' '}
                                          {new Date(activeAppointment?.endTime || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                      </div>
                                      {!isBlocked && (
                                        <div className={styles.detailRow}>
                                          <strong>Status:</strong>
                                          <span className={`${styles.statusBadge} ${styles[(activeAppointment?.status || '').toLowerCase() + 'Badge']}`}>
                                            {activeAppointment?.status}
                                          </span>
                                        </div>
                                      )}
                                    </div>

                                    <div className={styles.modalActions} style={{ gap: '10px' }}>
                                      {/* POS Checkout Button */}
                                      {!isBlocked && activeAppointment?.status !== 'COMPLETED' && activeAppointment?.status !== 'CANCELLED' && onCheckoutAppt && (
                                        <button
                                          onClick={() => {
                                            onCheckoutAppt(activeAppointment.id);
                                            setActiveAppointment(null);
                                          }}
                                          style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '99px', padding: '10px 20px', fontWeight: 800, cursor: 'pointer', fontSize: '13px' }}
                                        >
                                          🛒 POS Checkout
                                        </button>
                                      )}

                                      <button className={styles.saveBtn} onClick={() => setIsEditing(true)}>
                                        Reschedule
                                      </button>
                                      <Dialog.Close asChild>
                                        <button className={styles.cancelBtn}>Close</button>
                                      </Dialog.Close>
                                    </div>
                                  </>
                                )}
                              </Dialog.Content>
                            </Dialog.Portal>
                          </Dialog.Root>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </Tooltip.Provider>
          </div>
        </div>
      </div>

      {/* CRM 360-Degree Sliding Drawer */}
      <div className={`${styles.crmDrawer} ${crmDrawerOpen ? styles.crmDrawerOpen : ''}`}>
        <button className={styles.drawerClose} onClick={() => setCrmDrawerOpen(false)}>×</button>
        <h3 className={styles.drawerTitle}>360 CRM Client Profile</h3>

        {crmClientInfo ? (
          <div>
            <div className={styles.crmAvatarRow}>
              <div className={styles.crmAvatar}>
                {crmClientInfo.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h4 className={styles.crmName}>{crmClientInfo.name}</h4>
                <p className={styles.crmEmail}>✉ {crmClientInfo.email || 'No email'}</p>
                <p className={styles.crmPhone}>📞 {crmClientInfo.phone || 'No phone'}</p>
                {crmClientInfo.patch_test_date ? (
                  <span className={`${styles.crmBadge} ${styles.successBadge}`}>
                    Patch Tested: {new Date(crmClientInfo.patch_test_date).toLocaleDateString()}
                  </span>
                ) : (
                  <span className={`${styles.crmBadge} ${styles.warningBadge}`}>No Patch Test recorded</span>
                )}
              </div>
            </div>

            {/* Wallet / Membership balance */}
            <div className={styles.crmCard}>
              <h5 className={styles.crmCardTitle}>Active Wallet & Membership</h5>
              <div className={styles.detailRow}>
                <strong>Loyalty Points balance:</strong>
                <span style={{ color: '#d4af37' }}>{crmClientInfo.loyalty_points || 0} pts</span>
              </div>
              <div className={styles.detailRow}>
                <strong>Wallet account balance:</strong>
                <span>${((crmClientWallet?.balanceInCents || 0) / 100).toFixed(2)}</span>
              </div>
              <div className={styles.detailRow}>
                <strong>Gift Card:</strong>
                <span>${((crmClientWallet?.giftCardBalanceInCents || 0) / 100).toFixed(2)}</span>
              </div>
            </div>

            {/* Hair Formula Notes */}
            <div className={styles.crmCard}>
              <h5 className={styles.crmCardTitle}>Hair Color Formulas & Allergies</h5>
              <textarea
                rows={4}
                className={styles.formInput}
                style={{ fontFamily: 'monospace', fontSize: '11px', color: '#fff', background: '#090d16' }}
                value={crmFormulaNotes}
                onChange={(e) => setCrmFormulaNotes(e.target.value)}
                placeholder="Record dye mixtures, e.g. Formula: 6N + 7G 20vol. Record allergies..."
              />
              <button
                className={styles.saveBtn}
                disabled={isSavingFormula}
                onClick={handleUpdateFormula}
                style={{ width: '100%', marginTop: '8px', fontSize: '11px', padding: '8px' }}
              >
                {isSavingFormula ? 'Saving File...' : 'Update Formulas & Notes'}
              </button>
            </div>

            {/* Visit History (Last 3 Visits) */}
            <div className={styles.crmCard}>
              <h5 className={styles.crmCardTitle}>Recent Visit History</h5>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {crmClientHistory.length === 0 ? (
                  <li style={{ fontSize: '11px', color: '#64748b' }}>No past appointments logged.</li>
                ) : (
                  crmClientHistory.map((visit) => (
                    <li key={visit.id} style={{ background: '#090d16', border: '1px solid rgba(255,255,255,0.04)', padding: '10px', borderRadius: '8px', fontSize: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <strong>{visit.services?.name || 'Treatment'}</strong>
                        <span className={`${styles.statusBadge} ${styles[visit.status.toLowerCase() + 'Badge']}`}>{visit.status}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '10px' }}>
                        <span>{new Date(visit.startTime).toLocaleDateString()}</span>
                        {visit.notes && <span style={{ fontStyle: 'italic' }}>"{parseNotes(visit.notes).actualNotes}"</span>}
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: '#64748b' }}>Loading client file...</div>
        )}
      </div>

      {/* Floating Waitlist Automation Toast */}
      {waitlistAlert && (
        <div className={styles.waitlistToast}>
          <div className={styles.toastTitle}>🔔 Waitlist Automation</div>
          <div className={styles.toastBody}>
            <strong>{waitlistAlert.clientName}</strong> is waitlisted for <strong>{waitlistAlert.serviceName}</strong> on {waitlistAlert.date}. An opening has just been created!
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleFillWaitlistSlot}
              style={{ background: '#10b981', color: 'white', border: 'none', padding: '6px 12px', fontSize: '11px', fontWeight: 800, borderRadius: '4px', cursor: 'pointer', flex: 1 }}
            >
              Auto-fill Slot
            </button>
            <button
              onClick={() => setWaitlistAlert(null)}
              style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: '#94a3b8', padding: '6px 12px', fontSize: '11px', borderRadius: '4px', cursor: 'pointer' }}
            >
              Ignore
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
