'use client';

import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useRealtimeAppointments, Appointment } from '@/utils/useRealtimeAppointments';
import styles from './WeeklyCalendar.module.css';

interface WeeklyCalendarProps {
  tenantId: string;
  staffMembers: { id: string; name: string }[];
  services: { id: string; name: string; price: number; duration: number }[];
}

// Days of the week header helper
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function WeeklyCalendar({ tenantId, staffMembers, services }: WeeklyCalendarProps) {
  const { appointments, loading, error } = useRealtimeAppointments(tenantId);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [activeAppointment, setActiveAppointment] = useState<Appointment | null>(null);

  // Hour limits for the salon day
  const startHour = 8; // 8:00 AM
  const endHour = 20;  // 8:00 PM
  const totalHours = endHour - startHour;
  const hourHeight = 60; // 60px per hour row

  // Get start of the current week (Monday)
  const getStartOfWeek = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    d.setHours(0, 0, 0, 0);
    return new Date(d.setDate(diff));
  };

  const startOfWeek = getStartOfWeek(selectedDate);

  // Get array of the 7 dates in the week
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return d;
  });

  // Check if a date is today
  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  // Helper to calculate CSS absolute position for appointments
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

  // Filter appointments for a specific day of the week
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

  // Shift weeks
  const changeWeek = (offset: number) => {
    const next = new Date(selectedDate);
    next.setDate(selectedDate.getDate() + offset * 7);
    setSelectedDate(next);
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
        </div>
      </div>

      {/* Grid Wrapper */}
      <div className={styles.calendarGrid}>
        {/* Time Sidebar Grid Columns */}
        <div className={styles.timeColumnHeader}>Time</div>
        {weekDates.map((date, idx) => (
          <div key={idx} className={`${styles.dayHeader} ${isToday(date) ? styles.todayHeaderActive : ''}`}>
            <span className={styles.dayOfWeekText}>{DAYS[idx]}</span>
            <span className={styles.dayOfMonthText}>{date.getDate()}</span>
          </div>
        ))}

        {/* Time Slots Sidebar Rows */}
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

          {/* Appointment Columns Container */}
          <div className={styles.daysContainer}>
            {/* Background grid lines */}
            <div className={styles.gridLinesContainer}>
              {Array.from({ length: totalHours }).map((_, h) => (
                <div key={h} className={styles.gridRowLine} style={{ height: `${hourHeight}px` }} />
              ))}
            </div>

            {/* Individual Columns for appointments */}
            <Tooltip.Provider delayDuration={150}>
              <div className={styles.daysColumnsGrid}>
                {weekDates.map((date, colIdx) => {
                  const dayAppointments = getAppointmentsForDay(date);

                  return (
                    <div key={colIdx} className={styles.dayColumn}>
                      {dayAppointments.map((appt) => {
                        const stylePos = getAppointmentPosition(appt.startTime, appt.endTime);
                        const assignedStaff = staffMembers.find((s) => s.id === appt.userId)?.name || 'Unassigned';
                        const serviceType = services.find((s) => s.id === appt.serviceId)?.name || 'Service';

                        return (
                          <Dialog.Root key={appt.id}>
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <Dialog.Trigger asChild>
                                  <button
                                    className={`${styles.appointmentCard} ${styles[appt.status.toLowerCase()]}`}
                                    style={stylePos}
                                    onClick={() => setActiveAppointment(appt)}
                                  >
                                    <div className={styles.cardTimeText}>
                                      {new Date(appt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                    <div className={styles.cardTitle}>{appt.clientName}</div>
                                    <div className={styles.cardSubtitle}>{serviceType}</div>
                                    <div className={styles.cardStaff}>w/ {assignedStaff}</div>
                                  </button>
                                </Dialog.Trigger>
                              </Tooltip.Trigger>

                              <Tooltip.Portal>
                                <Tooltip.Content className={styles.tooltipContent} sideOffset={5}>
                                  <strong>Client:</strong> {appt.clientName} <br />
                                  <strong>Service:</strong> {serviceType} <br />
                                  <strong>Staff:</strong> {assignedStaff} <br />
                                  <strong>Status:</strong> <span className={`${styles.statusBadge} ${styles[appt.status.toLowerCase() + 'Badge']}`}>{appt.status}</span>
                                  <Tooltip.Arrow className={styles.tooltipArrow} />
                                </Tooltip.Content>
                              </Tooltip.Portal>
                            </Tooltip.Root>

                            {/* Radix Dialog Modal on click */}
                            <Dialog.Portal>
                              <Dialog.Overlay className={styles.modalOverlay} />
                              <Dialog.Content className={styles.modalContent}>
                                <Dialog.Title className={styles.modalTitle}>Appointment Detail</Dialog.Title>
                                <div className={styles.detailList}>
                                  <div className={styles.detailRow}>
                                    <strong>Client Name:</strong> <span>{activeAppointment?.clientName}</span>
                                  </div>
                                  <div className={styles.detailRow}>
                                    <strong>Stylist:</strong> <span>{assignedStaff}</span>
                                  </div>
                                  <div className={styles.detailRow}>
                                    <strong>Service:</strong> <span>{serviceType}</span>
                                  </div>
                                  <div className={styles.detailRow}>
                                    <strong>Date:</strong> <span>{new Date(activeAppointment?.startTime || '').toLocaleDateString()}</span>
                                  </div>
                                  <div className={styles.detailRow}>
                                    <strong>Time:</strong> <span>
                                      {new Date(activeAppointment?.startTime || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {' '}
                                      {new Date(activeAppointment?.endTime || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  <div className={styles.detailRow}>
                                    <strong>Status:</strong>
                                    <span className={`${styles.statusBadge} ${styles[(activeAppointment?.status || '').toLowerCase() + 'Badge']}`}>
                                      {activeAppointment?.status}
                                    </span>
                                  </div>
                                </div>

                                <div className={styles.modalActions}>
                                  <Dialog.Close asChild>
                                    <button className={styles.closeButton}>Close</button>
                                  </Dialog.Close>
                                </div>
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
