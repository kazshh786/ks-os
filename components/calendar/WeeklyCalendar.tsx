'use client';

import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { supabase } from '@/utils/supabase/client';
import { useRealtimeAppointments, Appointment } from '@/utils/useRealtimeAppointments';
import styles from './WeeklyCalendar.module.css';

interface WeeklyCalendarProps {
  tenantId: string;
  staffMembers: { id: string; name: string }[];
  services: { id: string; name: string; price: number; duration: number }[];
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function WeeklyCalendar({ tenantId, staffMembers, services }: WeeklyCalendarProps) {
  const { appointments, loading, error } = useRealtimeAppointments(tenantId);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  
  // Dialog and Edit states
  const [activeAppointment, setActiveAppointment] = useState<Appointment | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editStaffId, setEditStaffId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editStart, setEditStart] = useState('09:00');
  const [editEnd, setEditEnd] = useState('10:00');
  const [editStatus, setEditStatus] = useState('PENDING');
  const [editNotes, setEditNotes] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Time-Block Form states
  const [isBlockOpen, setIsBlockOpen] = useState(false);
  const [blockStaffId, setBlockStaffId] = useState('');
  const [blockDate, setBlockDate] = useState('');
  const [blockStart, setBlockStart] = useState('09:00');
  const [blockEnd, setBlockEnd] = useState('10:00');
  const [blockReason, setBlockReason] = useState('');
  const [isSavingBlock, setIsSavingBlock] = useState(false);

  // Hour limits for the salon day
  const startHour = 8; // 8:00 AM
  const endHour = 20;  // 8:00 PM
  const totalHours = endHour - startHour;
  const hourHeight = 60; // 60px per hour row

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

  const handleOpenEdit = (appt: Appointment) => {
    setActiveAppointment(appt);
    setIsEditing(false);
    
    // Seed edit form values
    setEditStaffId(appt.userId);
    const dateObj = new Date(appt.startTime);
    setEditDate(dateObj.toISOString().split('T')[0]);
    setEditStart(dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    
    const endDateObj = new Date(appt.endTime);
    setEditEnd(endDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    setEditStatus(appt.status);
    setEditNotes(appt.notes || '');
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

      const { error: updateErr } = await supabase
        .from('appointments')
        .update({
          user_id: editStaffId,
          start_time: startDateTime.toISOString(),
          end_time: endDateTime.toISOString(),
          status: editStatus,
          notes: editNotes
        })
        .eq('id', activeAppointment.id);

      if (updateErr) throw updateErr;

      setIsEditing(false);
      // Close main Dialog by clearing active appointment
      setActiveAppointment(null);
    } catch (err: any) {
      alert(err.message || 'Failed to update appointment details.');
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

      const { error: insertErr } = await supabase
        .from('appointments')
        .insert({
          tenant_id: tenantId,
          user_id: blockStaffId,
          start_time: startDateTime.toISOString(),
          end_time: endDateTime.toISOString(),
          status: 'BLOCKED',
          client_name: 'Blocked Time',
          notes: blockReason || 'Out of office'
        });

      if (insertErr) throw insertErr;

      setBlockReason('');
      setIsBlockOpen(false);
    } catch (err: any) {
      alert(err.message || 'Failed to save time block.');
    } finally {
      setIsSavingBlock(false);
    }
  };

  if (loading) return <div className={styles.loadingContainer}>Loading calendar schedule...</div>;
  if (error) return <div className={styles.errorContainer}>Error: {error}</div>;

  return (
    <div className={styles.calendarContainer}>
      {/* Calendar Header Control Bar */}
      <div className={styles.calendarHeader}>
        <div className={styles.brandTitle}>
          <h2>Scheduling Board</h2>
          <span className={styles.dateRangeLabel}>
            Week of {startOfWeek.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>

        <div className={styles.navigationControls}>
          <button className={styles.navButton} onClick={() => changeWeek(-1)}>Previous Week</button>
          <button className={styles.todayButton} onClick={() => setSelectedDate(new Date())}>Today</button>
          <button className={styles.navButton} onClick={() => changeWeek(1)}>Next Week</button>

          <Dialog.Root open={isBlockOpen} onOpenChange={setIsBlockOpen}>
            <Dialog.Trigger asChild>
              <button 
                onClick={() => {
                  if (staffMembers.length > 0) setBlockStaffId(staffMembers[0].id);
                  setBlockDate(new Date().toISOString().split('T')[0]);
                }}
                className={styles.blockBtn}
              >
                🔒 Block Off Time
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className={styles.modalOverlay} />
              <Dialog.Content className={styles.modalContent}>
                <Dialog.Title className={styles.modalTitle}>Block Off Stylist Time</Dialog.Title>
                <p className={styles.modalDesc}>Add out-of-office blocks. This time will show as "Busy" to online client booking slot calculators.</p>
                
                <form onSubmit={handleSaveBlock} className={styles.blockForm}>
                  <div className={styles.formGroup}>
                    <label>Select Provider:</label>
                    <select 
                      value={blockStaffId} 
                      onChange={(e) => setBlockStaffId(e.target.value)}
                      className={styles.formSelect}
                      required
                    >
                      <option value="">-- Choose Provider --</option>
                      {staffMembers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
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

                  <div className={styles.formGroup}>
                    <label>Reason / Notes:</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Lunch Break, Personal Appointment"
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
                    <div key={colIdx} className={styles.dayColumn}>
                      {dayAppointments.map((appt) => {
                        const stylePos = getAppointmentPosition(appt.startTime, appt.endTime);
                        const assignedStaff = staffMembers.find((s) => s.id === appt.userId)?.name || 'Unassigned';
                        
                        const isBlocked = appt.status === 'BLOCKED';
                        const serviceType = isBlocked ? 'Time Block' : (services.find((s) => s.id === appt.serviceId)?.name || 'Service');
                        const displayName = isBlocked ? `🔒 Busy: ${appt.notes || 'Time Blocked'}` : (appt.clientName || 'Client');

                        return (
                          <Dialog.Root key={appt.id} open={activeAppointment?.id === appt.id} onOpenChange={(open) => { if (!open) setActiveAppointment(null); }}>
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <Dialog.Trigger asChild>
                                  <button
                                    className={`${styles.appointmentCard} ${isBlocked ? styles.blocked : styles[appt.status.toLowerCase()]}`}
                                    style={stylePos}
                                    onClick={() => handleOpenEdit(appt)}
                                  >
                                    <div className={styles.cardTimeText}>
                                      {new Date(appt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                    <div className={styles.cardTitle}>{displayName}</div>
                                    {!isBlocked && <div className={styles.cardSubtitle}>{serviceType}</div>}
                                    <div className={styles.cardStaff}>w/ {assignedStaff}</div>
                                  </button>
                                </Dialog.Trigger>
                              </Tooltip.Trigger>

                              <Tooltip.Portal>
                                <Tooltip.Content className={styles.tooltipContent} sideOffset={5}>
                                  {isBlocked ? (
                                    <>
                                      <strong>Busy Block:</strong> {appt.notes || 'Out of Office'} <br />
                                      <strong>Provider:</strong> {assignedStaff}
                                    </>
                                  ) : (
                                    <>
                                      <strong>Client:</strong> {appt.clientName} <br />
                                      <strong>Service:</strong> {serviceType} <br />
                                      <strong>Staff:</strong> {assignedStaff} <br />
                                      <strong>Status:</strong> <span className={`${styles.statusBadge} ${styles[appt.status.toLowerCase() + 'Badge']}`}>{appt.status}</span>
                                    </>
                                  )}
                                  <Tooltip.Arrow className={styles.tooltipArrow} />
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
                                          <div className={styles.detailRow}>
                                            <strong>Reason / Notes:</strong> <span>{activeAppointment?.notes || 'No notes'}</span>
                                          </div>
                                        </>
                                      ) : (
                                        <>
                                          <div className={styles.detailRow}>
                                            <strong>Client Name:</strong> <span>{activeAppointment?.clientName}</span>
                                          </div>
                                          <div className={styles.detailRow}>
                                            <strong>Stylist:</strong> <span>{assignedStaff}</span>
                                          </div>
                                          <div className={styles.detailRow}>
                                            <strong>Service:</strong> <span>{serviceType}</span>
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
    </div>
  );
}
