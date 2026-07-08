'use client';

import React, { useState, useEffect, use } from 'react';
import { supabase } from '@/utils/supabase/client';
import TimeSlotPicker from '@/components/calendar/TimeSlotPicker';

// Mocks to avoid crashes if DB is completely empty
const MOCK_STAFF = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Alex Stylist' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Jordan Barber' }
];

const MOCK_SERVICES = [
  { id: '33333333-3333-3333-3333-333333333333', name: 'Skin Fade', price: 3500, duration: 45 },
  { id: '44444444-4444-4444-4444-444444444444', name: 'Gel Manicure', price: 4500, duration: 45 },
  { id: '55555555-5555-5555-5555-555555555555', name: 'Laser Resurfacing', price: 12000, duration: 60 }
];

export default function BookingEmbedPage({ params }: { params: Promise<{ subdomain: string }> }) {
  const resolvedParams = use(params);
  const subdomain = resolvedParams.subdomain;

  const [tenantId, setTenantId] = useState<string>('00000000-0000-0000-0000-000000000000');
  const [services, setServices] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadBookingData = async () => {
      try {
        setLoading(true);
        // Query tenant matching subdomain
        const { data: tenant } = await supabase
          .from('tenants')
          .select('id')
          .eq('subdomain', subdomain.toLowerCase())
          .single();

        if (tenant) {
          setTenantId(tenant.id);

          const { data: svcData } = await supabase
            .from('services')
            .select('id, name, price, duration')
            .eq('tenant_id', tenant.id);
          
          const { data: staffData } = await supabase
            .from('users')
            .select('id, name')
            .eq('tenant_id', tenant.id);

          setServices(svcData && svcData.length > 0 ? svcData : MOCK_SERVICES);
          setStaff(staffData && staffData.length > 0 ? staffData : MOCK_STAFF);
        } else {
          setServices(MOCK_SERVICES);
          setStaff(MOCK_STAFF);
        }
      } catch (err) {
        console.error('Failed to load embed booking picker:', err);
        setServices(MOCK_SERVICES);
        setStaff(MOCK_STAFF);
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
        onSlotSelected={(slot) => {
          alert(`Booking Confirmed!\nTime: ${slot.date.toLocaleTimeString()}\nStylist: ${slot.staffId}`);
        }}
      />
    </div>
  );
}
