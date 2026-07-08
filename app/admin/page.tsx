'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import OnboardingWizard from '@/components/admin/OnboardingWizard';
import WeeklyCalendar from '@/components/calendar/WeeklyCalendar';
import styles from './admin.module.css';

interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
}

interface Service {
  id: string;
  name: string;
  description: string;
  duration: number;
  price: number;
}

interface Staff {
  id: string;
  name: string;
  email: string;
  role: string;
}

export default function MasterAdminDashboard() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeView, setActiveView] = useState<'list' | 'onboard' | 'manage'>('list');
  
  // Data lists
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  
  // Form states for configuration
  const [newServiceName, setNewServiceName] = useState('');
  const [newServicePrice, setNewServicePrice] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState('30');
  
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  
  const [loadingList, setLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const AUTHORIZED_AGENCY_EMAIL = 'kasimashah@gmail.com';

  // Auth gate check
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { user }, error: authErr } = await supabase.auth.getUser();
        if (authErr || !user || user.email !== AUTHORIZED_AGENCY_EMAIL) {
          router.push('/admin/login');
          return;
        }
        setCurrentUser(user);
        fetchTenants();
      } catch (err) {
        console.error('Admin verification error:', err);
        router.push('/admin/login');
      } finally {
        setCheckingAuth(false);
      }
    };
    checkAuth();
  }, [router]);

  const fetchTenants = async () => {
    setLoadingList(true);
    try {
      const { data, error: dbErr } = await supabase
        .from('tenants')
        .select('*')
        .order('name');
      if (dbErr) throw dbErr;
      setTenants(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load salon tenants.');
    } finally {
      setLoadingList(false);
    }
  };

  const handleSelectTenant = async (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setActiveView('manage');
    setError(null);
    setLoadingList(true);

    try {
      // 1. Fetch services for tenant
      const { data: svcData, error: svcErr } = await supabase
        .from('services')
        .select('*')
        .eq('tenant_id', tenant.id);
      if (svcErr) throw svcErr;
      setServices(svcData || []);

      // 2. Fetch staff (users table) for tenant
      const { data: staffData, error: staffErr } = await supabase
        .from('users')
        .select('id, name, email, role')
        .eq('tenant_id', tenant.id);
      if (staffErr) throw staffErr;
      setStaff(staffData || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load tenant configurations.');
    } finally {
      setLoadingList(false);
    }
  };

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) return;
    setIsSaving(true);
    setError(null);

    try {
      const priceCents = Math.round(parseFloat(newServicePrice) * 100);
      if (isNaN(priceCents) || priceCents <= 0) {
        throw new Error('Please enter a valid price.');
      }

      const { data, error: dbErr } = await supabase
        .from('services')
        .insert({
          tenant_id: selectedTenant.id,
          name: newServiceName,
          description: 'Custom configuration service added by Master Admin.',
          duration: parseInt(newServiceDuration, 10),
          price: priceCents,
          is_active: true
        })
        .select()
        .single();

      if (dbErr) throw dbErr;

      setServices((prev) => [...prev, data]);
      setNewServiceName('');
      setNewServicePrice('');
    } catch (err: any) {
      setError(err.message || 'Failed to create service.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) return;
    setIsSaving(true);
    setError(null);

    try {
      // In a real flow, you would invite the user via Auth API, but to bypass
      // we generate a profile user entry directly linked to this tenant space
      const newUserId = crypto.randomUUID();
      const { data, error: dbErr } = await supabase
        .from('users')
        .insert({
          id: newUserId,
          tenant_id: selectedTenant.id,
          email: newStaffEmail,
          name: newStaffName,
          role: 'staff',
          permissions: {}
        })
        .select()
        .single();

      if (dbErr) throw dbErr;

      // Seed a default weekly work schedule for this new staff member (Monday - Friday 9am - 5pm)
      const days = [1, 2, 3, 4, 5];
      const scheduleInserts = days.map((day) => ({
        tenant_id: selectedTenant.id,
        user_id: newUserId,
        day_of_week: day,
        start_time: '09:00:00',
        end_time: '17:00:00'
      }));

      const { error: schedErr } = await supabase
        .from('staff_schedules')
        .insert(scheduleInserts);

      if (schedErr) throw schedErr;

      setStaff((prev) => [...prev, data]);
      setNewStaffName('');
      setNewStaffEmail('');
    } catch (err: any) {
      setError(err.message || 'Failed to register staff.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/admin/login');
  };

  if (checkingAuth) return <div className={styles.loadingScreen}>Loading Master Dashboard...</div>;

  return (
    <div className={styles.dashboardContainer}>
      {/* Top Admin Header Navigation */}
      <header className={styles.header}>
        <div className={styles.headerLogo}>
          <span className={styles.logoIcon}>👑</span>
          <h2>KS Control Panel</h2>
          <span className={styles.adminBadge}>Master Admin</span>
        </div>
        
        <div className={styles.headerActions}>
          <button
            onClick={() => {
              setActiveView('list');
              setSelectedTenant(null);
              fetchTenants();
            }}
            className={`${styles.navButton} ${activeView === 'list' ? styles.navButtonActive : ''}`}
          >
            Salons List
          </button>
          <button
            onClick={() => {
              setActiveView('onboard');
              setSelectedTenant(null);
            }}
            className={`${styles.navButton} ${activeView === 'onboard' ? styles.navButtonActive : ''}`}
          >
            Add New Salon
          </button>
          <button onClick={handleLogout} className={styles.logoutBtn}>Sign Out</button>
        </div>
      </header>

      {/* Main Panel Content Area */}
      <main className={styles.main}>
        {error && <div className={styles.errorBanner}>{error}</div>}

        {/* VIEW 1: Salons List */}
        {activeView === 'list' && (
          <div className={styles.viewSection}>
            <div className={styles.sectionHeader}>
              <h3>Onboarded Salon Clients</h3>
              <p>Select any client to view calendar schedules, configure services, or register staff members.</p>
            </div>

            {loadingList ? (
              <div className={styles.listLoading}>Querying tenants...</div>
            ) : tenants.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}>🏢</span>
                <h4>No salons onboarded yet</h4>
                <button onClick={() => setActiveView('onboard')} className={styles.primaryActionBtn}>
                  Onboard First Salon
                </button>
              </div>
            ) : (
              <div className={styles.salonGrid}>
                {tenants.map((t) => (
                  <div key={t.id} className={styles.salonCard}>
                    <div className={styles.salonBadge} style={{ backgroundColor: t.accent_color }}>
                      {t.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className={styles.salonDetails}>
                      <h4>{t.name}</h4>
                      <code>{t.subdomain}.kasimshah.com</code>
                    </div>
                    <button
                      onClick={() => handleSelectTenant(t)}
                      className={styles.manageBtn}
                    >
                      Configure & Setup Booking
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: Provision Form (Wizard) */}
        {activeView === 'onboard' && (
          <div className={styles.wizardWrapper}>
            <OnboardingWizard 
              onSuccessComplete={() => {
                setActiveView('list');
                fetchTenants();
              }} 
            />
          </div>
        )}

        {/* VIEW 3: Configure/Manage Tenant System */}
        {activeView === 'manage' && selectedTenant && (
          <div className={styles.viewSection}>
            <div className={styles.tenantHeader}>
              <button 
                onClick={() => {
                  setActiveView('list');
                  setSelectedTenant(null);
                  fetchTenants();
                }}
                className={styles.backBtn}
              >
                ← Back to Salon list
              </button>
              <div className={styles.tenantTitleGroup}>
                <h3>Managing System: {selectedTenant.name}</h3>
                <code>URL: {selectedTenant.subdomain}.kasimshah.com</code>
              </div>
            </div>

            <div className={styles.workspaceGrid}>
              {/* Left Column: Management Inputs */}
              <div className={styles.sidebarControls}>
                {/* 1. Add/Manage Services */}
                <div className={styles.controlBox}>
                  <h4>Configure Services</h4>
                  <form onSubmit={handleAddService} className={styles.miniForm}>
                    <input
                      type="text"
                      required
                      placeholder="Service Name (e.g. Wash & Blowdry)"
                      value={newServiceName}
                      onChange={(e) => setNewServiceName(e.target.value)}
                      className={styles.miniInput}
                    />
                    <div className={styles.rowInputs}>
                      <input
                        type="number"
                        required
                        step="0.01"
                        placeholder="Price ($)"
                        value={newServicePrice}
                        onChange={(e) => setNewServicePrice(e.target.value)}
                        className={styles.miniInput}
                      />
                      <select
                        value={newServiceDuration}
                        onChange={(e) => setNewServiceDuration(e.target.value)}
                        className={styles.miniSelect}
                      >
                        <option value="15">15 Min</option>
                        <option value="30">30 Min</option>
                        <option value="45">45 Min</option>
                        <option value="60">60 Min</option>
                        <option value="90">90 Min</option>
                      </select>
                    </div>
                    <button type="submit" disabled={isSaving} className={styles.miniBtn}>
                      {isSaving ? 'Saving...' : 'Add Service'}
                    </button>
                  </form>

                  <ul className={styles.itemList}>
                    {services.length === 0 ? (
                      <li className={styles.emptyLi}>No services added yet.</li>
                    ) : (
                      services.map((s) => (
                        <li key={s.id} className={styles.itemLi}>
                          <span>{s.name} ({s.duration} min)</span>
                          <strong>${(s.price / 100).toFixed(2)}</strong>
                        </li>
                      ))
                    )}
                  </ul>
                </div>

                {/* 2. Add/Manage Staff Profiles */}
                <div className={styles.controlBox}>
                  <h4>Register Staff</h4>
                  <form onSubmit={handleAddStaff} className={styles.miniForm}>
                    <input
                      type="text"
                      required
                      placeholder="Staff Name (e.g. Sarah Connor)"
                      value={newStaffName}
                      onChange={(e) => setNewStaffName(e.target.value)}
                      className={styles.miniInput}
                    />
                    <input
                      type="email"
                      required
                      placeholder="Staff Email"
                      value={newStaffEmail}
                      onChange={(e) => setNewStaffEmail(e.target.value)}
                      className={styles.miniInput}
                    />
                    <button type="submit" disabled={isSaving} className={styles.miniBtn}>
                      {isSaving ? 'Registering...' : 'Register Staff Member'}
                    </button>
                  </form>

                  <ul className={styles.itemList}>
                    {staff.length === 0 ? (
                      <li className={styles.emptyLi}>No staff profiles registered.</li>
                    ) : (
                      staff.map((st) => (
                        <li key={st.id} className={styles.itemLi}>
                          <span>{st.name}</span>
                          <span style={{ fontSize: '11px', color: '#64748b' }}>{st.email}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>

              {/* Right Column: Live Calendar Grid Preview */}
              <div className={styles.calendarPreviewPane}>
                <div className={styles.paneHeader}>
                  <h4>Schedules Calendar Grid (Live Preview)</h4>
                  <p>Check slot configurations and booking conflicts for this salon tenant space.</p>
                </div>
                <div className={styles.calendarWrapper}>
                  {selectedTenant && (
                    <WeeklyCalendar
                      tenantId={selectedTenant.id}
                      staffMembers={staff}
                      services={services}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
