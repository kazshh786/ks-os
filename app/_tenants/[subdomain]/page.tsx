'use client';

import React, { useState, useEffect, use } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import WeeklyCalendar from '@/components/calendar/WeeklyCalendar';
import TimeSlotPicker from '@/components/calendar/TimeSlotPicker';
import ClientTimeline from '@/components/crm/ClientTimeline';
import CheckoutDrawer from '@/components/pos/CheckoutDrawer';

// Mock listings for demo/compiling purposes (resolves database fetch references)
const MOCK_STAFF = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Alex Stylist' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Jordan Barber' }
];

const MOCK_SERVICES = [
  { id: '33333333-3333-3333-3333-333333333333', name: 'Skin Fade', price: 3500, duration: 45 },
  { id: '44444444-4444-4444-4444-444444444444', name: 'Gel Manicure', price: 4500, duration: 45 },
  { id: '55555555-5555-5555-5555-555555555555', name: 'Laser Resurfacing', price: 12000, duration: 60 }
];

export default function TenantDashboard({ params }: { params: Promise<{ subdomain: string }> }) {
  const resolvedParams = use(params);
  const subdomain = resolvedParams.subdomain;
  
  // Local states
  const [activeTab, setActiveTab] = useState<'calendar' | 'booking' | 'crm'>('calendar');
  const [tenantId, setTenantId] = useState<string>('00000000-0000-0000-0000-000000000000');
  
  // POS Drawer States
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [checkoutApptId, setCheckoutApptId] = useState<string | null>(null);

  // Active client selected for CRM view
  const [selectedClientId, setSelectedClientId] = useState<string>('99999999-9999-9999-9999-999999999999');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      {/* Top Banner Navigation */}
      <header style={{
        background: '#0f172a',
        color: '#ffffff',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #1e293b'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '20px' }}>🏢</span>
          <h1 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>
            {subdomain.toUpperCase()} Workspace
          </h1>
          <span style={{ fontSize: '11px', background: '#1e293b', padding: '4px 10px', borderRadius: '99px', fontWeight: 600, color: '#94a3b8' }}>
            Active Subdomain
          </span>
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('calendar')}
            style={{
              background: activeTab === 'calendar' ? '#1e293b' : 'transparent',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 16px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            Calendar Board
          </button>
          <button
            onClick={() => setActiveTab('booking')}
            style={{
              background: activeTab === 'booking' ? '#1e293b' : 'transparent',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 16px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            Booking Widget
          </button>
          <button
            onClick={() => setActiveTab('crm')}
            style={{
              background: activeTab === 'crm' ? '#1e293b' : 'transparent',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 16px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            CRM Profile Feed
          </button>
        </div>
      </header>

      {/* Main Workspace Frame */}
      <main style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {activeTab === 'calendar' && (
          <div style={{ width: '100%', maxWidth: '1000px' }}>
            <WeeklyCalendar 
              tenantId={tenantId} 
              staffMembers={MOCK_STAFF} 
              services={MOCK_SERVICES} 
            />
            {/* Quick Checkout Trigger Helper for testing */}
            <div style={{ marginTop: '20px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700 }}>POS Checkout Simulation</h4>
                <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Test stock decrements and points ledger entries by launching a transaction.</p>
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
                  borderRadius: '6px',
                  padding: '8px 16px',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                Open POS Checkout
              </button>
            </div>
          </div>
        )}

        {activeTab === 'booking' && (
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
            <TimeSlotPicker 
              tenantId={tenantId} 
              services={MOCK_SERVICES} 
              staffMembers={MOCK_STAFF} 
              onSlotSelected={(slot) => {
                alert(`Booking Slot Selected:\nTime: ${slot.date.toLocaleTimeString()}\nStylist: ${slot.staffId}`);
              }}
            />
          </div>
        )}

        {activeTab === 'crm' && (
          <div style={{ width: '100%' }}>
            <ClientTimeline 
              clientId={selectedClientId} 
              tenantId={tenantId} 
            />
          </div>
        )}
      </main>

      {/* Slide-out POS Dialog Portal */}
      <Dialog.Root open={isCheckoutOpen} onOpenChange={setIsCheckoutOpen}>
        {checkoutApptId && (
          <CheckoutDrawer 
            tenantId={tenantId} 
            appointmentId={checkoutApptId} 
            onCheckoutSuccess={() => {
              setIsCheckoutOpen(false);
              alert('Payment Succeeded! Inventory decremented and loyalty points credited.');
            }} 
          />
        )}
      </Dialog.Root>
    </div>
  );
}
