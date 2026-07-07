import { useEffect, useState } from 'react';

// Adjust this import to match your standard Supabase client location
import { supabase } from '@/utils/supabase/client';

export interface Appointment {
  id: string;
  tenantId: string;
  userId: string;
  clientName: string;
  serviceId: string;
  startTime: string; // ISO String
  endTime: string; // ISO String
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  createdAt: string;
  updatedAt: string;
}

/**
 * Custom React Hook that loads initial appointments for a tenant
 * and listens for live inserts, updates, and deletes from Supabase Realtime.
 * Uses tenant_id filters to enforce isolation at the network packet level.
 */
export function useRealtimeAppointments(tenantId: string | null) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 1. Fetch initial appointments
  useEffect(() => {
    if (!tenantId) {
      setAppointments([]);
      setLoading(false);
      return;
    }

    const fetchAppointments = async () => {
      try {
        setLoading(true);
        const { data, error: fetchErr } = await supabase
          .from('appointments')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('start_time', { ascending: true });

        if (fetchErr) throw fetchErr;
        setAppointments(data as Appointment[]);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch appointments');
      } finally {
        setLoading(false);
      }
    };

    fetchAppointments();
  }, [tenantId]);

  // 2. Real-time Database Synchronization
  useEffect(() => {
    if (!tenantId) return;

    // Set up real-time listener filtering by current tenant_id
    const channel = supabase
      .channel(`realtime-appointments-tenant-${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload;

          setAppointments((prev) => {
            switch (eventType) {
              case 'INSERT': {
                const inserted = newRecord as Appointment;
                const filtered = prev.filter((appt) => appt.id !== inserted.id); // Guard duplicates
                return [...filtered, inserted].sort(
                  (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
                );
              }
              case 'UPDATE': {
                const updated = newRecord as Appointment;
                return prev.map((appt) => (appt.id === updated.id ? updated : appt));
              }
              case 'DELETE': {
                const deletedId = oldRecord.id;
                return prev.filter((appt) => appt.id !== deletedId);
              }
              default:
                return prev;
            }
          });
        }
      )
      .subscribe();

    // Cleanup subscription
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId]);

  return { appointments, loading, error, setAppointments };
}
