'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/utils/supabase/client';
import styles from './ClientTimeline.module.css';

interface ClientTimelineProps {
  clientId: string;
  tenantId: string;
}

interface TimelineEvent {
  id: string;
  type: 'appointment' | 'form_submission';
  date: Date;
  title: string;
  subtitle: string;
  details: Record<string, any> | string | null;
  statusBadge?: string; // e.g. PENDING, CONFIRMED, COMPLETED (for appts)
}

export default function ClientTimeline({ clientId, tenantId }: ClientTimelineProps) {
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [clientInfo, setClientInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;

    const loadTimeline = async () => {
      setLoading(true);
      setError(null);
      try {
        // 1. Fetch Client Profile details
        const { data: client, error: clientErr } = await supabase
          .from('clients')
          .select('*')
          .eq('id', clientId)
          .single();

        if (clientErr) throw clientErr;
        setClientInfo(client);

        // 2. Fetch Client Appointments
        const { data: appointments, error: apptErr } = await supabase
          .from('appointments')
          .select('*, services(name)')
          .eq('client_id', clientId);

        if (apptErr) throw apptErr;

        // 3. Fetch Client Form Submissions
        const { data: submissions, error: subErr } = await supabase
          .from('client_form_submissions')
          .select('*, forms(title)')
          .eq('client_id', clientId);

        if (subErr) throw subErr;

        // 4. Transform and merge into a single chronological timeline (newest first)
        const events: TimelineEvent[] = [];

        if (appointments) {
          appointments.forEach((appt: any) => {
            events.push({
              id: appt.id,
              type: 'appointment',
              date: new Date(appt.start_time),
              title: appt.services?.name || 'Salon Service',
              subtitle: `Appointment with staff member`,
              statusBadge: appt.status,
              details: appt.notes || null,
            });
          });
        }

        if (submissions) {
          submissions.forEach((sub: any) => {
            events.push({
              id: sub.id,
              type: 'form_submission',
              date: new Date(sub.submitted_at),
              title: sub.forms?.title || 'Digital Form Submission',
              subtitle: 'Completed Digital Intake Form',
              details: sub.response_json || null,
            });
          });
        }

        // Sort descending (newest first)
        events.sort((a, b) => b.date.getTime() - a.date.getTime());
        setTimelineEvents(events);
      } catch (err: any) {
        setError(err.message || 'Error fetching client history');
      } finally {
        setLoading(false);
      }
    };

    loadTimeline();
  }, [clientId, tenantId]);

  if (loading) return <div className={styles.loadingContainer}>Loading client profile history...</div>;
  if (error) return <div className={styles.errorContainer}>Error: {error}</div>;
  if (!clientInfo) return <div className={styles.emptyContainer}>Client profile not found.</div>;

  return (
    <div className={styles.timelineWrapper}>
      {/* Client Summary Header Card */}
      <div className={styles.profileHeaderCard}>
        <div className={styles.avatarCircle}>
          {clientInfo.name.charAt(0).toUpperCase()}
        </div>
        <div className={styles.profileMeta}>
          <h2 className={styles.clientName}>{clientInfo.name}</h2>
          <div className={styles.contactDetails}>
            {clientInfo.email && <span>✉ {clientInfo.email}</span>}
            {clientInfo.phone && <span>📞 {clientInfo.phone}</span>}
          </div>
          {clientInfo.patch_test_date ? (
            <span className={`${styles.badge} ${styles.successBadge}`}>
              Patch Tested: {new Date(clientInfo.patch_test_date).toLocaleDateString()}
            </span>
          ) : (
            <span className={`${styles.badge} ${styles.warningBadge}`}>
              No Patch Test Logged
            </span>
          )}
        </div>
        {clientInfo.medical_notes && (
          <div className={styles.medicalAlertCard}>
            <div className={styles.medicalAlertTitle}>⚠️ Medical Notes & Allergies</div>
            <p className={styles.medicalAlertContent}>{clientInfo.medical_notes}</p>
          </div>
        )}
      </div>

      {/* Chronological Vertical Timeline */}
      <div className={styles.timelineContainer}>
        <h3 className={styles.timelineSectionTitle}>Client Journey & Activity</h3>

        {timelineEvents.length === 0 ? (
          <div className={styles.noActivity}>No past appointments or intake form submissions logged.</div>
        ) : (
          <div className={styles.timelineTrack}>
            {timelineEvents.map((event) => {
              const isAppt = event.type === 'appointment';
              return (
                <div key={event.id} className={styles.timelineItem}>
                  {/* Visual Node */}
                  <div className={`${styles.timelineNode} ${isAppt ? styles.apptNode : styles.formNode}`}>
                    {isAppt ? '📅' : '📝'}
                  </div>

                  {/* Content Box */}
                  <div className={styles.timelineCard}>
                    <div className={styles.cardHeader}>
                      <span className={styles.eventDate}>
                        {event.date.toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {event.statusBadge && (
                        <span className={`${styles.statusBadge} ${styles[event.statusBadge.toLowerCase()]}`}>
                          {event.statusBadge}
                        </span>
                      )}
                    </div>

                    <h4 className={styles.cardTitle}>{event.title}</h4>
                    <span className={styles.cardSubtitle}>{event.subtitle}</span>

                    {/* Expandable Details based on event type */}
                    {event.details && (
                      <div className={styles.cardExpandedDetails}>
                        {isAppt ? (
                          <p className={styles.notesText}>"{event.details}"</p>
                        ) : (
                          <div className={styles.answersGrid}>
                            {Object.entries(event.details as Record<string, any>).map(([label, val]) => (
                              <div key={label} className={styles.answerItem}>
                                <span className={styles.answerLabel}>{label}:</span>
                                <span className={styles.answerVal}>
                                  {typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
