'use client';

import React, { useState, useEffect, use } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { supabase } from '@/utils/supabase/client';
import WeeklyCalendar from '@/components/calendar/WeeklyCalendar';
import TimeSlotPicker from '@/components/calendar/TimeSlotPicker';
import ClientTimeline from '@/components/crm/ClientTimeline';
import CheckoutDrawer from '@/components/pos/CheckoutDrawer';

// Fallback listings to ensure compile safety if database is empty
const MOCK_STAFF = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Alex Stylist' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Jordan Barber' }
];

const MOCK_SERVICES = [
  { id: '33333333-3333-3333-3333-333333333333', name: 'Skin Fade', price: 3500, duration: 45 },
  { id: '44444444-4444-4444-4444-444444444444', name: 'Gel Manicure', price: 4500, duration: 45 },
  { id: '55555555-5555-5555-5555-555555555555', name: 'Laser Resurfacing', price: 12000, duration: 60 }
];

interface StaffRevenue {
  staffName: string;
  revenue: number;
  bookings: number;
}

export default function TenantDashboard({ params }: { params: Promise<{ subdomain: string }> }) {
  const resolvedParams = use(params);
  const subdomain = resolvedParams.subdomain;
  
  // Local states
  const [activeTab, setActiveTab] = useState<'calendar' | 'booking' | 'crm' | 'manage'>('calendar');
  const [tenantId, setTenantId] = useState<string>('00000000-0000-0000-0000-000000000000');
  const [tenantName, setTenantName] = useState<string>('');
  const [customDomain, setCustomDomain] = useState<string | null>(null);
  
  // Dynamic collections loaded from DB
  const [services, setServices] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Tenant-specific Analytics State
  const [totalSales, setTotalSales] = useState(0);
  const [salesCount, setSalesCount] = useState(0);
  const [staffRevenues, setStaffRevenues] = useState<StaffRevenue[]>([]);

  // Studio Forms States
  const [newServiceName, setNewServiceName] = useState('');
  const [newServicePrice, setNewServicePrice] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState('30');
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // POS Drawer States
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [checkoutApptId, setCheckoutApptId] = useState<string | null>(null);

  // Active client selected for CRM view
  const [selectedClientId, setSelectedClientId] = useState<string>('99999999-9999-9999-9999-999999999999');

  const loadWorkspaceData = async () => {
    try {
      setLoading(true);
      // 1. Resolve tenant details
      const { data: tenant, error: tErr } = await supabase
        .from('tenants')
        .select('id, name, custom_domain')
        .eq('subdomain', subdomain.toLowerCase())
        .single();

      if (tErr || !tenant) {
        console.warn('Subdomain not provisioned, running in mock workspace fallback.');
        setServices(MOCK_SERVICES);
        setStaff(MOCK_STAFF);
        setTenantName(subdomain);
        return;
      }

      setTenantId(tenant.id);
      setTenantName(tenant.name);
      setCustomDomain(tenant.custom_domain);

      // 2. Fetch services
      const { data: svcData } = await supabase
        .from('services')
        .select('id, name, price, duration')
        .eq('tenant_id', tenant.id);
      
      // 3. Fetch staff
      const { data: staffData } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('tenant_id', tenant.id);

      const activeSvcList = svcData && svcData.length > 0 ? svcData : MOCK_SERVICES;
      const activeStaffList = staffData && staffData.length > 0 ? staffData : MOCK_STAFF;
      setServices(activeSvcList);
      setStaff(activeStaffList);

      // 4. Fetch local checkout transactions for local analytics calculations
      const { data: transactions } = await supabase
        .from('checkout_transactions')
        .select('total_amount, appointments(user_id)')
        .eq('tenant_id', tenant.id);

      if (transactions && transactions.length > 0) {
        let total = 0;
        const staffMap: { [key: string]: { rev: number; count: number } } = {};

        transactions.forEach((tx: any) => {
          const amt = tx.total_amount || 0;
          total += amt;
          
          const appt = tx.appointments;
          if (appt) {
            const providerId = appt.user_id;
            const providerName = activeStaffList.find((s: any) => s.id === providerId)?.name || 'House/Unassigned';
            
            if (!staffMap[providerName]) {
              staffMap[providerName] = { rev: 0, count: 0 };
            }
            staffMap[providerName].rev += amt;
            staffMap[providerName].count += 1;
          }
        });

        setTotalSales(total);
        setSalesCount(transactions.length);

        const revList = Object.keys(staffMap).map((name) => ({
          staffName: name,
          revenue: staffMap[name].rev,
          bookings: staffMap[name].count
        }));
        setStaffRevenues(revList);
      } else {
        setTotalSales(0);
        setSalesCount(0);
        setStaffRevenues([]);
      }

    } catch (err) {
      console.error('Failed to load workspace parameters:', err);
      setServices(MOCK_SERVICES);
      setStaff(MOCK_STAFF);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspaceData();
  }, [subdomain]);

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tenantId === '00000000-0000-0000-0000-000000000000') {
      alert('Mock environment: changes will not save to database.');
      return;
    }
    setIsSaving(true);

    try {
      const priceCents = Math.round(parseFloat(newServicePrice) * 100);
      if (isNaN(priceCents) || priceCents <= 0) throw new Error('Specify a valid price.');

      const { data, error } = await supabase
        .from('services')
        .insert({
          tenant_id: tenantId,
          name: newServiceName,
          description: 'Custom service added by Studio Owner.',
          duration: parseInt(newServiceDuration, 10),
          price: priceCents,
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;
      setServices((prev) => [...prev, data]);
      setNewServiceName('');
      setNewServicePrice('');
      alert('New service added successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to add service.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tenantId === '00000000-0000-0000-0000-000000000000') {
      alert('Mock environment: changes will not save to database.');
      return;
    }
    setIsSaving(true);

    try {
      const newUserId = crypto.randomUUID();
      const { data, error } = await supabase
        .from('users')
        .insert({
          id: newUserId,
          tenant_id: tenantId,
          email: newStaffEmail,
          name: newStaffName,
          role: 'staff',
          permissions: {}
        })
        .select()
        .single();

      if (error) throw error;

      // Seed 9-5 hours automatically
      const days = [1, 2, 3, 4, 5];
      const scheduleInserts = days.map((day) => ({
        tenant_id: tenantId,
        user_id: newUserId,
        day_of_week: day,
        start_time: '09:00:00',
        end_time: '17:00:00'
      }));
      await supabase.from('staff_schedules').insert(scheduleInserts);

      setStaff((prev) => [...prev, data]);
      setNewStaffName('');
      setNewStaffEmail('');
      alert('Team member registered successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to add staff member.');
    } finally {
      setIsSaving(false);
    }
  };

  const embedUrl = customDomain 
    ? `admin.${customDomain}` 
    : (typeof window !== 'undefined' ? window.location.host : `${subdomain}.kasimshah.com`);
  const iframeEmbedCode = `<iframe src="https://${embedUrl}/book" width="100%" height="700px" style="border:none; border-radius:12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);"></iframe>`;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#090d16', color: '#cbd5e1', fontFamily: 'var(--md-font-sans)' }}>
      {/* M3 Styled Top Banner Navigation */}
      <header style={{
        background: '#111625',
        color: '#ffffff',
        padding: '18px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid rgba(212, 175, 55, 0.15)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '22px', filter: 'drop-shadow(0 2px 8px rgba(212,175,55,0.3))' }}>🏢</span>
          <h1 style={{ fontSize: '18px', fontWeight: 800, margin: 0, background: 'linear-gradient(135deg, #ffffff 0%, #d4af37 100%)', WebkitBackgroundClip: text, WebkitTextFillColor: 'transparent' }}>
            {tenantName ? tenantName.toUpperCase() : subdomain.toUpperCase()} Studio
          </h1>
          <span style={{ fontSize: '10px', background: '#3c2a00', color: '#d4af37', border: '1px solid rgba(212,175,55,0.3)', padding: '2px 10px', borderRadius: '99px', fontWeight: 700 }}>
            {loading ? 'Resolving...' : 'Studio Portal'}
          </span>
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('calendar')}
            style={{
              background: activeTab === 'calendar' ? '#d4af37' : 'transparent',
              color: activeTab === 'calendar' ? '#1e1400' : '#94a3b8',
              border: 'none',
              borderRadius: '99px',
              padding: '8px 18px',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            Schedules Calendar
          </button>
          <button
            onClick={() => setActiveTab('booking')}
            style={{
              background: activeTab === 'booking' ? '#d4af37' : 'transparent',
              color: activeTab === 'booking' ? '#1e1400' : '#94a3b8',
              border: 'none',
              borderRadius: '99px',
              padding: '8px 18px',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            Live Booking Page
          </button>
          <button
            onClick={() => setActiveTab('crm')}
            style={{
              background: activeTab === 'crm' ? '#d4af37' : 'transparent',
              color: activeTab === 'crm' ? '#1e1400' : '#94a3b8',
              border: 'none',
              borderRadius: '99px',
              padding: '8px 18px',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            Client CRM
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            style={{
              background: activeTab === 'manage' ? '#d4af37' : 'transparent',
              color: activeTab === 'manage' ? '#1e1400' : '#94a3b8',
              border: 'none',
              borderRadius: '99px',
              padding: '8px 18px',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            Manage Studio
          </button>
        </div>
      </header>

      {/* Main Workspace Frame */}
      <main style={{ flex: 1, padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '1200px', margin: '0 auto', boxSizing: 'border-box' }}>
        {loading ? (
          <div style={{ padding: '60px', fontWeight: 'bold', color: '#94a3b8', fontSize: '14px' }}>Resolving studio parameter configurations...</div>
        ) : (
          <>
            {/* VIEW 1: Calendar Scheduling Board */}
            {activeTab === 'calendar' && (
              <div style={{ width: '100%' }}>
                <WeeklyCalendar 
                  tenantId={tenantId} 
                  staffMembers={staff} 
                  services={services} 
                />
                
                {/* Checkout Trigger simulation card */}
                <div style={{ marginTop: '24px', background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
                  <div>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: '#ffffff' }}>POS Checkout Terminal</h4>
                    <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>Checkout completed bookings, decrement product inventory, and credit reward points.</p>
                  </div>
                  <button
                    onClick={() => {
                      setCheckoutApptId('88888888-8888-8888-8888-888888888888');
                      setIsCheckoutOpen(true);
                    }}
                    style={{
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '99px',
                      padding: '10px 22px',
                      fontWeight: 800,
                      fontSize: '13px',
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25)'
                    }}
                  >
                    Launch Checkout Terminal
                  </button>
                </div>
              </div>
            )}

            {/* VIEW 2: Client Booking Page Preview */}
            {activeTab === 'booking' && (
              <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                <TimeSlotPicker 
                  tenantId={tenantId} 
                  services={services} 
                  staffMembers={staff} 
                  onSlotSelected={(slot) => {
                    alert(`Booking Mock Confirmed!\nTime: ${slot.date.toLocaleTimeString()}\nStylist: ${slot.staffId}`);
                  }}
                />
              </div>
            )}

            {/* VIEW 3: Client CRM Timelines */}
            {activeTab === 'crm' && (
              <div style={{ width: '100%' }}>
                <ClientTimeline 
                  clientId={selectedClientId} 
                  tenantId={tenantId} 
                />
              </div>
            )}

            {/* VIEW 4: Local Tenant Studio Manager Panel */}
            {activeTab === 'manage' && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '28px' }}>
                
                {/* Section A: Revenue Metrics for this salon */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
                  <div style={{ background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{ fontSize: '32px' }}>💰</span>
                    <div>
                      <h3 style={{ margin: '0 0 4px 0', fontSize: '26px', fontWeight: 850, color: '#d4af37' }}>
                        ${(totalSales / 100).toFixed(2)}
                      </h3>
                      <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', fontWeight: 700 }}>Total Revenue Brought In</p>
                    </div>
                  </div>
                  <div style={{ background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{ fontSize: '32px' }}>📅</span>
                    <div>
                      <h3 style={{ margin: '0 0 4px 0', fontSize: '26px', fontWeight: 850, color: '#d4af37' }}>
                        {salesCount}
                      </h3>
                      <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', fontWeight: 700 }}>Completed Bookings</p>
                    </div>
                  </div>
                </div>

                {/* Section B: Staff Revenue Breakdown Table */}
                <div style={{ background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '24px' }}>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>Stylist Performance Breakdown</h4>
                  <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: '#94a3b8' }}>Total bookings completed and revenue contribution generated by each provider.</p>
                  
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '12px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid rgba(212, 175, 55, 0.15)' }}>
                        <th style={{ textAlign: 'left', padding: '12px', fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>Provider</th>
                        <th style={{ textAlign: 'left', padding: '12px', fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>Bookings</th>
                        <th style={{ textAlign: 'right', padding: '12px', fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>Revenue Generated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffRevenues.length === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ textAlign: 'center', padding: '32px', color: '#64748b', fontSize: '12px' }}>No completed payments recorded.</td>
                        </tr>
                      ) : (
                        staffRevenues.map((s, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid rgba(212, 175, 55, 0.1)' }}>
                            <td style={{ padding: '12px', fontSize: '13px', color: '#ffffff', fontWeight: 700 }}>{s.staffName}</td>
                            <td style={{ padding: '12px', fontSize: '13px', color: '#cbd5e1' }}>{s.bookings}</td>
                            <td style={{ padding: '12px', fontSize: '13px', color: '#d4af37', fontWeight: 700, textAlign: 'right' }}>
                              ${(s.revenue / 100).toFixed(2)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Section C: Services catalog and staff registry forms */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px' }}>
                  
                  {/* Local services catalog creator */}
                  <div style={{ background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '24px' }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>Add Studio Service</h4>
                    <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: '#94a3b8' }}>Publish new treatments and custom price structures instantly.</p>
                    
                    <form onSubmit={handleAddService} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <input
                        type="text"
                        required
                        placeholder="Service Name (e.g. Skin Fade & Wash)"
                        value={newServiceName}
                        onChange={(e) => setNewServiceName(e.target.value)}
                        style={{ fontFamily: 'var(--md-font-sans)', fontSize: '13px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                      />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '10px' }}>
                        <input
                          type="number"
                          required
                          step="0.01"
                          placeholder="Price ($)"
                          value={newServicePrice}
                          onChange={(e) => setNewServicePrice(e.target.value)}
                          style={{ fontFamily: 'var(--md-font-sans)', fontSize: '13px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                        />
                        <select
                          value={newServiceDuration}
                          onChange={(e) => setNewServiceDuration(e.target.value)}
                          style={{ fontFamily: 'var(--md-font-sans)', fontSize: '13px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                        >
                          <option value="15">15 Min</option>
                          <option value="30">30 Min</option>
                          <option value="45">45 Min</option>
                          <option value="60">60 Min</option>
                          <option value="90">90 Min</option>
                        </select>
                      </div>
                      <button type="submit" disabled={isSaving} style={{ background: '#d4af37', color: '#1e1400', border: 'none', borderRadius: '99px', padding: '11px', fontWeight: 800, cursor: 'pointer', fontSize: '13px' }}>
                        {isSaving ? 'Publishing...' : 'Add Service'}
                      </button>
                    </form>

                    <div style={{ marginTop: '24px' }}>
                      <h5 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 800, color: '#ffffff' }}>Published Catalog</h5>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {services.map((s) => (
                          <li key={s.id} style={{ background: '#090d16', border: '1px solid rgba(212,175,55,0.1)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{s.name} ({s.duration}m)</span>
                            <strong style={{ color: '#d4af37' }}>${(s.price / 100).toFixed(2)}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Local staff registry creator */}
                  <div style={{ background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '24px' }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>Register Stylist</h4>
                    <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: '#94a3b8' }}>Register team members and allocate default work hour blocks.</p>
                    
                    <form onSubmit={handleAddStaff} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <input
                        type="text"
                        required
                        placeholder="Stylist Name"
                        value={newStaffName}
                        onChange={(e) => setNewStaffName(e.target.value)}
                        style={{ fontFamily: 'var(--md-font-sans)', fontSize: '13px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                      />
                      <input
                        type="email"
                        required
                        placeholder="Stylist Email"
                        value={newStaffEmail}
                        onChange={(e) => setNewStaffEmail(e.target.value)}
                        style={{ fontFamily: 'var(--md-font-sans)', fontSize: '13px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                      />
                      <button type="submit" disabled={isSaving} style={{ background: '#d4af37', color: '#1e1400', border: 'none', borderRadius: '99px', padding: '11px', fontWeight: 800, cursor: 'pointer', fontSize: '13px' }}>
                        {isSaving ? 'Registering...' : 'Register Stylist'}
                      </button>
                    </form>

                    <div style={{ marginTop: '24px' }}>
                      <h5 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 800, color: '#ffffff' }}>Active Team Directory</h5>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {staff.map((st) => (
                          <li key={st.id} style={{ background: '#090d16', border: '1px solid rgba(212,175,55,0.1)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <strong style={{ color: '#ffffff' }}>{st.name}</strong>
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>{st.email}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                </div>

                {/* Section D: Website Widget Embed Iframe snippet */}
                <div style={{ background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '24px' }}>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>Integrate Booking Page into Your Website</h4>
                  <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: '#94a3b8' }}>Showcase real-time slot availability on your own custom site using this copyable iframe embed code.</p>
                  
                  <textarea
                    readOnly
                    value={iframeEmbedCode}
                    onClick={(e) => {
                      (e.target as HTMLTextAreaElement).select();
                      navigator.clipboard.writeText(iframeEmbedCode);
                      alert('Widget embed code copied to clipboard!');
                    }}
                    style={{
                      width: '100%',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      background: '#090d16',
                      color: '#d4af37',
                      border: '1px solid rgba(212, 175, 55, 0.15)',
                      borderRadius: '8px',
                      padding: '12px 14px',
                      resize: 'none',
                      boxSizing: 'border-box',
                      cursor: 'copy'
                    }}
                    rows={3}
                  />
                  <span style={{ fontSize: '11px', color: '#10b981', marginTop: '6px', display: 'block', fontWeight: 'bold' }}>
                    💡 Tip: Click inside the code box to copy the snippet instantly!
                  </span>
                </div>

              </div>
            )}
          </>
        )}
      </main>

      {/* Checkout Terminal drawer portal */}
      <Dialog.Root open={isCheckoutOpen} onOpenChange={setIsCheckoutOpen}>
        {checkoutApptId && (
          <CheckoutDrawer 
            tenantId={tenantId} 
            appointmentId={checkoutApptId} 
            onCheckoutSuccess={() => {
              setIsCheckoutOpen(false);
              loadWorkspaceData();
              alert('Payment Succeeded! Inventory updated and local sales metrics recalculated.');
            }} 
          />
        )}
      </Dialog.Root>
    </div>
  );
}
