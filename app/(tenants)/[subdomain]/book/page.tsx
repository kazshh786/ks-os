'use client';

import React, { useState, useEffect, use } from 'react';
import { supabase } from '@/utils/supabase/client';
import TimeSlotPicker from '@/components/calendar/TimeSlotPicker';

interface BookingService {
  id: string;
  name: string;
  price: number;
  duration: number;
}

interface BookingStaffMember {
  id: string;
  name: string;
}

export default function BookingEmbedPage({ params }: { params: Promise<{ subdomain: string }> }) {
  const resolvedParams = use(params);
  const subdomain = resolvedParams.subdomain;

  const [tenantId, setTenantId] = useState<string>('00000000-0000-0000-0000-000000000000');
  const [services, setServices] = useState<BookingService[]>([]);
  const [staff, setStaff] = useState<BookingStaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookingError, setBookingError] = useState<string | null>(null);

  useEffect(() => {
    const loadBookingData = async () => {
      try {
        setLoading(true);
        setBookingError(null);
        // Query tenant matching subdomain
        const { data: tenant, error: tenantError } = await supabase
          .from('tenants')
          .select('id')
          .eq('subdomain', subdomain.toLowerCase())
          .single();

        if (tenantError || !tenant) {
          throw new Error('This booking page is not available.');
        }

        setTenantId(tenant.id);

        const { data: svcData, error: serviceError } = await supabase
          .from('services')
          .select('id, name, price, duration')
          .eq('tenant_id', tenant.id);

        const { data: staffData, error: staffError } = await supabase
          .from('users')
          .select('id, name')
          .eq('tenant_id', tenant.id);

        if (serviceError || staffError) {
          throw new Error('Booking availability could not be loaded.');
        }

        setServices(svcData || []);
        setStaff(staffData || []);
      } catch (err: unknown) {
        console.error('Failed to load embed booking picker:', err);
        setServices([]);
        setStaff([]);
        setBookingError(err instanceof Error ? err.message : 'Booking availability could not be loaded.');
      } finally {
        setLoading(false);
      }
    };
    loadBookingData();
  }, [subdomain]);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#090d16',
        color: '#94a3b8',
        fontSize: '13px',
        fontWeight: 'bold',
        fontFamily: 'sans-serif'
      }}>
        Loading Booking Widget...
      </div>
    );
  }

  if (bookingError || services.length === 0 || staff.length === 0) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: '#090d16',
        color: '#f8fafc',
        fontFamily: 'system-ui, sans-serif'
      }}>
        <div style={{ maxWidth: '440px', padding: '28px', border: '1px solid rgba(212,175,55,0.16)', borderRadius: '16px', background: '#111625', textAlign: 'center' }}>
          <span style={{ display: 'inline-flex', marginBottom: '12px', color: '#d4af37', fontSize: '12px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Booking page</span>
          <h1 style={{ margin: '0 0 10px', fontSize: '24px' }}>Bookings aren’t available yet</h1>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '14px', lineHeight: 1.6 }}>
            {bookingError || 'This business is still setting up its services and team. Please check back soon.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#090d16',
      padding: '16px',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-start',
      boxSizing: 'border-box'
    }}>
      <TimeSlotPicker 
        tenantId={tenantId}
        services={services}
        staffMembers={staff}
        onSlotSelected={() => undefined}
      />
    </div>
  );
}
