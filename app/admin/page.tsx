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
  custom_domain: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  ownerName?: string;
  ownerEmail?: string;
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

interface Resource {
  id: string;
  name: string;
  type: string;
  capacity: number;
}

interface WaitlistEntry {
  id: string;
  client_name: string;
  service_name: string;
  preferred_date: string;
  status: string;
}

interface StaffRevenue {
  staffName: string;
  revenue: number;
  bookings: number;
}

interface OffPeakRule {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  discountPercentage: number;
}

export default function MasterAdminDashboard() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeView, setActiveView] = useState<'list' | 'onboard' | 'manage'>('list');
  const [manageSubTab, setManageSubTab] = useState<'calendar' | 'services' | 'staff' | 'resources' | 'automations' | 'analytics'>('analytics');
  
  // Data lists
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [resourcesList, setResourcesList] = useState<Resource[]>([]);
  const [waitlistList, setWaitlistList] = useState<WaitlistEntry[]>([]);
  const [offPeakRules, setOffPeakRules] = useState<OffPeakRule[]>([]);
  
  // Analytics State
  const [totalSales, setTotalSales] = useState(0);
  const [salesCount, setSalesCount] = useState(0);
  const [staffRevenues, setStaffRevenues] = useState<StaffRevenue[]>([]);
  const [topServicesList, setTopServicesList] = useState<{ name: string; count: number }[]>([]);

  // Form states
  const [customDomainInput, setCustomDomainInput] = useState('');
  
  const [newServiceName, setNewServiceName] = useState('');
  const [newServicePrice, setNewServicePrice] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState('30');
  
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  
  const [newResourceName, setNewResourceName] = useState('');
  const [newResourceType, setNewResourceType] = useState('room');
  
  const [newOffPeakDay, setNewOffPeakDay] = useState('1');
  const [newOffPeakStart, setNewOffPeakStart] = useState('09:00');
  const [newOffPeakEnd, setNewOffPeakEnd] = useState('14:00');
  const [newOffPeakDiscount, setNewOffPeakDiscount] = useState('20');

  const [smsNotificationTemplate, setSmsNotificationTemplate] = useState('Hello [Client], your booking for [Service] is confirmed!');
  
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
        .select('*, users(name, email, role)')
        .order('name');
      if (dbErr) throw dbErr;
      
      const mapped = (data || []).map((t: any) => {
        const owner = t.users?.find((u: any) => u.role === 'owner');
        return {
          ...t,
          ownerName: owner?.name,
          ownerEmail: owner?.email
        };
      });
      setTenants(mapped);
    } catch (err: any) {
      setError(err.message || 'Failed to load salon tenants.');
    } finally {
      setLoadingList(false);
    }
  };

  const handleSelectTenant = async (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setCustomDomainInput(tenant.custom_domain || '');
    setActiveView('manage');
    setManageSubTab('analytics');
    setError(null);
    setLoadingList(true);

    try {
      // 1. Fetch services
      const { data: svcData } = await supabase
        .from('services')
        .select('*')
        .eq('tenant_id', tenant.id);
      setServices(svcData || []);

      // 2. Fetch staff
      const { data: staffData } = await supabase
        .from('users')
        .select('id, name, email, role')
        .eq('tenant_id', tenant.id);
      setStaff(staffData || []);

      // 3. Fetch resources
      const { data: resData } = await supabase
        .from('resources')
        .select('*')
        .eq('tenant_id', tenant.id);
      setResourcesList(resData || []);

      // 4. Fetch waitlist
      const { data: wlData } = await supabase
        .from('waitlist')
        .select('id, preferred_date, status, clients(name), services(name)')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false });
      
      const mappedWl: WaitlistEntry[] = (wlData || []).map((w: any) => ({
        id: w.id,
        client_name: w.clients?.name || 'Unknown Client',
        service_name: w.services?.name || 'Unknown Service',
        preferred_date: new Date(w.preferred_date).toLocaleDateString(),
        status: w.status
      }));
      setWaitlistList(mappedWl);

      // 5. Fetch off-peak rules
      const { data: opData } = await supabase
        .from('off_peak_rules')
        .select('*')
        .eq('tenant_id', tenant.id);
      
      const mappedOp: OffPeakRule[] = (opData || []).map((o: any) => ({
        id: o.id,
        dayOfWeek: o.day_of_week,
        startTime: o.start_time,
        endTime: o.end_time,
        discountPercentage: o.discount_percentage
      }));
      setOffPeakRules(mappedOp);

      // 6. Fetch automation templates
      const { data: autoData } = await supabase
        .from('automation_rules')
        .select('template_text')
        .eq('tenant_id', tenant.id)
        .eq('trigger_event', 'booking_created')
        .single();
      if (autoData) {
        setSmsNotificationTemplate(autoData.template_text);
      }

      // 7. Fetch sales and calculate staff revenue metrics
      const { data: transactions } = await supabase
        .from('checkout_transactions')
        .select('total_amount, createdAt, appointments(user_id, services(name))')
        .eq('tenant_id', tenant.id);

      if (transactions && transactions.length > 0) {
        let total = 0;
        const staffMap: { [key: string]: { rev: number; count: number } } = {};
        const serviceMap: { [key: string]: number } = {};

        transactions.forEach((tx: any) => {
          const amt = tx.total_amount || 0;
          total += amt;
          
          const appt = tx.appointments;
          if (appt) {
            const staffId = appt.user_id;
            const staffName = staffData?.find((s: any) => s.id === staffId)?.name || 'House/Unassigned';
            
            if (!staffMap[staffName]) {
              staffMap[staffName] = { rev: 0, count: 0 };
            }
            staffMap[staffName].rev += amt;
            staffMap[staffName].count += 1;

            const svcName = appt.services?.name || 'Retail/Other';
            serviceMap[svcName] = (serviceMap[svcName] || 0) + 1;
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

        const svcList = Object.keys(serviceMap).map((name) => ({
          name,
          count: serviceMap[name]
        })).sort((a, b) => b.count - a.count);
        setTopServicesList(svcList);
      } else {
        setTotalSales(0);
        setSalesCount(0);
        setStaffRevenues([]);
        setTopServicesList([]);
      }

    } catch (err: any) {
      setError(err.message || 'Failed to load configurations.');
    } finally {
      setLoadingList(false);
    }
  };

  const handleUpdateDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) return;
    setIsSaving(true);
    setError(null);

    try {
      const cleanDomain = customDomainInput.trim().toLowerCase();
      const { error: dbErr } = await supabase
        .from('tenants')
        .update({ custom_domain: cleanDomain || null })
        .eq('id', selectedTenant.id);

      if (dbErr) throw dbErr;
      
      setSelectedTenant((prev: any) => ({
        ...prev,
        custom_domain: cleanDomain || null
      }));
      alert('Custom domain mappings saved successfully!');
    } catch (err: any) {
      setError(err.message || 'Failed to map custom domain.');
    } finally {
      setIsSaving(false);
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
          description: 'Salon service added by Master Admin Workspace.',
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

      // Seed Mon-Fri 9-5 schedule automatically
      const days = [1, 2, 3, 4, 5];
      const scheduleInserts = days.map((day) => ({
        tenant_id: selectedTenant.id,
        user_id: newUserId,
        day_of_week: day,
        start_time: '09:00:00',
        end_time: '17:00:00'
      }));

      await supabase.from('staff_schedules').insert(scheduleInserts);

      setStaff((prev) => [...prev, data]);
      setNewStaffName('');
      setNewStaffEmail('');
    } catch (err: any) {
      setError(err.message || 'Failed to register staff.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) return;
    setIsSaving(true);
    setError(null);

    try {
      const { data, error: dbErr } = await supabase
        .from('resources')
        .insert({
          tenant_id: selectedTenant.id,
          name: newResourceName,
          type: newResourceType,
          capacity: 1
        })
        .select()
        .single();

      if (dbErr) throw dbErr;

      setResourcesList((prev) => [...prev, data]);
      setNewResourceName('');
    } catch (err: any) {
      setError(err.message || 'Failed to allocate resource.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddOffPeak = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) return;
    setIsSaving(true);
    setError(null);

    try {
      const discount = parseInt(newOffPeakDiscount, 10);
      if (isNaN(discount) || discount <= 0 || discount > 100) {
        throw new Error('Please specify a valid discount percentage (1-100).');
      }

      const { data, error: dbErr } = await supabase
        .from('off_peak_rules')
        .insert({
          tenant_id: selectedTenant.id,
          day_of_week: parseInt(newOffPeakDay, 10),
          start_time: newOffPeakStart,
          end_time: newOffPeakEnd,
          discount_percentage: discount
        })
        .select()
        .single();

      if (dbErr) throw dbErr;

      setOffPeakRules((prev: any) => [...prev, {
        id: data.id,
        dayOfWeek: data.day_of_week,
        startTime: data.start_time,
        endTime: data.end_time,
        discountPercentage: data.discount_percentage
      }]);
    } catch (err: any) {
      setError(err.message || 'Failed to add off-peak rule.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAutomation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) return;
    setIsSaving(true);
    setError(null);

    try {
      const { error: dbErr } = await supabase
        .from('automation_rules')
        .upsert({
          tenant_id: selectedTenant.id,
          trigger_event: 'booking_created',
          template_text: smsNotificationTemplate,
          is_active: true
        }, {
          onConflict: 'tenant_id,trigger_event'
        });

      if (dbErr) throw dbErr;
      alert('Sms / notification template configurations saved!');
    } catch (err: any) {
      setError(err.message || 'Failed to save automation rule.');
    } finally {
      setIsSaving(false);
    }
  };

  if (checkingAuth) return <div className={styles.loadingScreen}>Loading Master CP Portal...</div>;

  return (
    <div className={styles.dashboardContainer}>
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
            Client Directory
          </button>
          <button
            onClick={() => {
              setActiveView('onboard');
              setSelectedTenant(null);
            }}
            className={`${styles.navButton} ${activeView === 'onboard' ? styles.navButtonActive : ''}`}
          >
            Add New Client
          </button>
          <button onClick={() => supabase.auth.signOut().then(() => router.push('/admin/login'))} className={styles.logoutBtn}>
            Sign Out
          </button>
        </div>
      </header>

      <main className={styles.main}>
        {error && <div className={styles.errorBanner}>{error}</div>}

        {/* VIEW 1: Salon Client Directory */}
        {activeView === 'list' && (
          <div className={styles.viewSection}>
            <div className={styles.sectionHeader}>
              <h3>Onboarded Salon Clients</h3>
              <p>Configure custom domains, check real-time resource allocations, or review staff performance analytics.</p>
            </div>

            {loadingList ? (
              <div className={styles.listLoading}>Loading active directory...</div>
            ) : tenants.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}>🏢</span>
                <h4>No salons onboarded yet</h4>
                <button onClick={() => setActiveView('onboard')} className={styles.primaryActionBtn}>
                  Onboard Your First Client
                </button>
              </div>
            ) : (
              <div className={styles.salonGrid}>
                {tenants.map((t) => (
                  <div key={t.id} className={styles.salonCard}>
                    <div className={styles.salonBadge} style={{ backgroundColor: t.accent_color || '#10b981' }}>
                      {t.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className={styles.salonDetails}>
                      <h4>{t.name}</h4>
                      <code>{t.subdomain}.kasimshah.com</code>
                      {t.custom_domain && (
                        <div style={{ fontSize: '11px', color: '#10b981', marginTop: '4px', fontWeight: 'bold' }}>
                          🔗 {t.custom_domain}
                        </div>
                      )}
                      {t.ownerEmail && (
                        <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '6px' }}>
                          👤 <strong>{t.ownerName || 'Salon Owner'}</strong>
                          <br />
                          <span style={{ fontSize: '11px', color: '#64748b' }}>{t.ownerEmail}</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleSelectTenant(t)}
                      className={styles.manageBtn}
                    >
                      Configure Workspace
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: Onboarding Wizard */}
        {activeView === 'onboard' && (
          <div className={styles.wizardWrapper}>
            <OnboardingWizard onSuccessComplete={() => {
              setActiveView('list');
              fetchTenants();
            }} />
          </div>
        )}

        {/* VIEW 3: Salon Manager Workspace Tab Bar */}
        {activeView === 'manage' && selectedTenant && (
          <div className={styles.viewSection}>
            <div className={styles.tenantHeader}>
              <button onClick={() => { setActiveView('list'); setSelectedTenant(null); fetchTenants(); }} className={styles.backBtn}>
                ← Back
              </button>
              <div className={styles.tenantTitleGroup}>
                <h3>{selectedTenant.name} Config Workspace</h3>
                <code>Default URL: {selectedTenant.subdomain}.kasimshah.com</code>
              </div>
            </div>

            {/* Custom Domain Assignment Ribbon */}
            <div className={styles.domainConfigRibbon}>
              <form onSubmit={handleUpdateDomain} className={styles.domainForm}>
                <label htmlFor="custom-domain">Assign Custom Domain Map:</label>
                <input
                  id="custom-domain"
                  type="text"
                  placeholder="e.g. www.thehairlounge.com"
                  value={customDomainInput}
                  onChange={(e) => setCustomDomainInput(e.target.value)}
                  className={styles.domainInput}
                />
                <button type="submit" className={styles.domainSaveBtn} disabled={isSaving}>
                  {isSaving ? 'Assigning...' : 'Save Mapping'}
                </button>
              </form>
            </div>

            {/* Workspace Inner View Toggle Tabs */}
            <div className={styles.tabBar}>
              <button onClick={() => setManageSubTab('analytics')} className={`${styles.tabBtn} ${manageSubTab === 'analytics' ? styles.tabBtnActive : ''}`}>
                📈 Sales & Staff Analytics
              </button>
              <button onClick={() => setManageSubTab('calendar')} className={`${styles.tabBtn} ${manageSubTab === 'calendar' ? styles.tabBtnActive : ''}`}>
                📅 Scheduler Calendar
              </button>
              <button onClick={() => setManageSubTab('services')} className={`${styles.tabBtn} ${manageSubTab === 'services' ? styles.tabBtnActive : ''}`}>
                💅 Services Catalog
              </button>
              <button onClick={() => setManageSubTab('staff')} className={`${styles.tabBtn} ${manageSubTab === 'staff' ? styles.tabBtnActive : ''}`}>
                💇 Stylists & Providers
              </button>
              <button onClick={() => setManageSubTab('resources')} className={`${styles.tabBtn} ${manageSubTab === 'resources' ? styles.tabBtnActive : ''}`}>
                🔑 Room/Device Allocation
              </button>
              <button onClick={() => setManageSubTab('automations')} className={`${styles.tabBtn} ${manageSubTab === 'automations' ? styles.tabBtnActive : ''}`}>
                🤖 Marketing & Off-Peak
              </button>
            </div>

            {/* TAB CONTENTS */}
            <div className={styles.workspaceBody}>
              
              {/* SUBTAB 1: Revenue & Staff Sales Analytics */}
              {manageSubTab === 'analytics' && (
                <div className={styles.analyticsLayout}>
                  <div className={styles.analyticsSummaryCards}>
                    <div className={styles.summaryCard}>
                      <span className={styles.cardIndicator}>💰</span>
                      <div>
                        <h3>${(totalSales / 100).toFixed(2)}</h3>
                        <p>Total Revenue Brought In</p>
                      </div>
                    </div>
                    <div className={styles.summaryCard}>
                      <span className={styles.cardIndicator}>📅</span>
                      <div>
                        <h3>{salesCount}</h3>
                        <p>Total Completed Checkouts</p>
                      </div>
                    </div>
                  </div>

                  <div className={styles.analyticsTablesSplit}>
                    <div className={styles.analyticsTableBox}>
                      <h4>Sales Revenue by Staff Member</h4>
                      <p className={styles.subtext}>Revenue contributions and checkout counts generated per provider.</p>
                      <table className={styles.analyticsTable}>
                        <thead>
                          <tr>
                            <th>Stylist / Provider</th>
                            <th>Completed Bookings</th>
                            <th>Revenue Generated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {staffRevenues.length === 0 ? (
                            <tr>
                              <td colSpan={3} className={styles.tableEmpty}>No sales transactions logged for this salon yet.</td>
                            </tr>
                          ) : (
                            staffRevenues.map((s, idx) => (
                              <tr key={idx}>
                                <td><strong>{s.staffName}</strong></td>
                                <td>{s.bookings}</td>
                                <td style={{ color: '#10b981', fontWeight: 700 }}>${(s.revenue / 100).toFixed(2)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className={styles.analyticsTableBox}>
                      <h4>Top Performing Booked Services</h4>
                      <p className={styles.subtext}>Most popular treatments booked and purchased by customers.</p>
                      <table className={styles.analyticsTable}>
                        <thead>
                          <tr>
                            <th>Service Type</th>
                            <th>Sales Volume</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topServicesList.length === 0 ? (
                            <tr>
                              <td colSpan={2} className={styles.tableEmpty}>No service bookings completed yet.</td>
                            </tr>
                          ) : (
                            topServicesList.map((svc, idx) => (
                              <tr key={idx}>
                                <td>{svc.name}</td>
                                <td>{svc.count} sales</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* SUBTAB 2: Calendar Board */}
              {manageSubTab === 'calendar' && (
                <div className={styles.calendarPane}>
                  <WeeklyCalendar
                    tenantId={selectedTenant.id}
                    staffMembers={staff}
                    services={services}
                  />
                </div>
              )}

              {/* SUBTAB 3: Services Catalog */}
              {manageSubTab === 'services' && (
                <div className={styles.workspaceSplit}>
                  <div className={styles.formBox}>
                    <h4>Add Custom Service</h4>
                    <form onSubmit={handleAddService} className={styles.formGroup}>
                      <input
                        type="text"
                        required
                        placeholder="Service Name (e.g. Balayage Cut)"
                        value={newServiceName}
                        onChange={(e) => setNewServiceName(e.target.value)}
                        className={styles.formInput}
                      />
                      <div className={styles.formRow}>
                        <input
                          type="number"
                          required
                          step="0.01"
                          placeholder="Price ($)"
                          value={newServicePrice}
                          onChange={(e) => setNewServicePrice(e.target.value)}
                          className={styles.formInput}
                        />
                        <select
                          value={newServiceDuration}
                          onChange={(e) => setNewServiceDuration(e.target.value)}
                          className={styles.formSelect}
                        >
                          <option value="15">15 Min</option>
                          <option value="30">30 Min</option>
                          <option value="45">45 Min</option>
                          <option value="60">60 Min</option>
                          <option value="90">90 Min</option>
                          <option value="120">120 Min</option>
                        </select>
                      </div>
                      <button type="submit" disabled={isSaving} className={styles.submitBtn}>
                        {isSaving ? 'Adding...' : 'Save & Publish Service'}
                      </button>
                    </form>
                  </div>

                  <div className={styles.listBox}>
                    <h4>Active Services List</h4>
                    <ul className={styles.itemUl}>
                      {services.length === 0 ? (
                        <li className={styles.emptyLi}>No services added to this salon's catalog yet.</li>
                      ) : (
                        services.map((s) => (
                          <li key={s.id} className={styles.itemLi}>
                            <div>
                              <strong>{s.name}</strong>
                              <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '10px' }}>({s.duration} min)</span>
                            </div>
                            <span style={{ color: '#10b981', fontWeight: 700 }}>${(s.price / 100).toFixed(2)}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                </div>
              )}

              {/* SUBTAB 4: Stylists & Team */}
              {manageSubTab === 'staff' && (
                <div className={styles.workspaceSplit}>
                  <div className={styles.formBox}>
                    <h4>Register Stylist Profile</h4>
                    <form onSubmit={handleAddStaff} className={styles.formGroup}>
                      <input
                        type="text"
                        required
                        placeholder="Staff Display Name"
                        value={newStaffName}
                        onChange={(e) => setNewStaffName(e.target.value)}
                        className={styles.formInput}
                      />
                      <input
                        type="email"
                        required
                        placeholder="Staff Email"
                        value={newStaffEmail}
                        onChange={(e) => setNewStaffEmail(e.target.value)}
                        className={styles.formInput}
                      />
                      <button type="submit" disabled={isSaving} className={styles.submitBtn}>
                        {isSaving ? 'Registering...' : 'Register Team Member'}
                      </button>
                    </form>
                  </div>

                  <div className={styles.listBox}>
                    <h4>Team Directory</h4>
                    <ul className={styles.itemUl}>
                      {staff.length === 0 ? (
                        <li className={styles.emptyLi}>No team member profiles added.</li>
                      ) : (
                        staff.map((st) => (
                          <li key={st.id} className={styles.itemLi}>
                            <strong>{st.name}</strong>
                            <code style={{ fontSize: '11px', color: '#64748b' }}>{st.email}</code>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                </div>
              )}

              {/* SUBTAB 5: Resource Allocations */}
              {manageSubTab === 'resources' && (
                <div className={styles.workspaceSplit}>
                  <div className={styles.formBox}>
                    <h4>Create Room or Equipment Resource</h4>
                    <p className={styles.subtext}>Create assets like Treatment Rooms, Styling Chairs, or Lasers that services require to prevent scheduling conflicts.</p>
                    <form onSubmit={handleAddResource} className={styles.formGroup}>
                      <input
                        type="text"
                        required
                        placeholder="Resource Name (e.g. Facial Room A)"
                        value={newResourceName}
                        onChange={(e) => setNewResourceName(e.target.value)}
                        className={styles.formInput}
                      />
                      <select
                        value={newResourceType}
                        onChange={(e) => setNewResourceType(e.target.value)}
                        className={styles.formSelect}
                      >
                        <option value="room">Treatment Room</option>
                        <option value="chair">Styling Chair</option>
                        <option value="device">Clinical Laser Device</option>
                      </select>
                      <button type="submit" disabled={isSaving} className={styles.submitBtn}>
                        {isSaving ? 'Allocating...' : 'Allocate Resource'}
                      </button>
                    </form>
                  </div>

                  <div className={styles.listBox}>
                    <h4>Allocated Resource Assets</h4>
                    <ul className={styles.itemUl}>
                      {resourcesList.length === 0 ? (
                        <li className={styles.emptyLi}>No hardware resources allocated to this tenant workspace.</li>
                      ) : (
                        resourcesList.map((r) => (
                          <li key={r.id} className={styles.itemLi}>
                            <strong>{r.name}</strong>
                            <span className={styles.resourceTypeBadge}>{r.type.toUpperCase()}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                </div>
              )}

              {/* SUBTAB 6: Marketing Automations & Off-Peak Discounts */}
              {manageSubTab === 'automations' && (
                <div className={styles.workspaceSplit}>
                  {/* Left Column: Automated SMS templates */}
                  <div className={styles.formBox}>
                    <h4>Automated Client Notifications</h4>
                    <p className={styles.subtext}>Configure template texts automatically triggered on client booking actions.</p>
                    <form onSubmit={handleSaveAutomation} className={styles.formGroup}>
                      <label htmlFor="sms-template" className={styles.label}>Booking Confirmation SMS/Email:</label>
                      <textarea
                        id="sms-template"
                        value={smsNotificationTemplate}
                        onChange={(e) => setSmsNotificationTemplate(e.target.value)}
                        className={styles.formTextarea}
                        rows={4}
                      />
                      <button type="submit" disabled={isSaving} className={styles.submitBtn}>
                        {isSaving ? 'Saving...' : 'Save Notification Rule'}
                      </button>
                    </form>

                    {/* Waitlist List log view */}
                    <div style={{ marginTop: '24px' }}>
                      <h4 style={{ margin: '0 0 10px 0', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px' }}>Waitlisted Client Gaps</h4>
                      <ul className={styles.itemUl}>
                        {waitlistList.length === 0 ? (
                          <li className={styles.emptyLi}>No clients currently waiting for slot cancellations.</li>
                        ) : (
                          waitlistList.map((w) => (
                            <li key={w.id} className={styles.itemLi}>
                              <div>
                                <strong>{w.client_name}</strong>
                                <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '10px' }}>({w.service_name})</span>
                              </div>
                              <span style={{ fontSize: '10px', background: w.status === 'FILLED' ? '#d1fae5' : '#fee2e2', color: w.status === 'FILLED' ? '#065f46' : '#991b1b', padding: '2px 8px', borderRadius: '99px', fontWeight: 'bold' }}>
                                {w.status}
                              </span>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  </div>

                  {/* Right Column: Off-Peak discount rules */}
                  <div className={styles.formBox}>
                    <h4>Off-Peak Hour Discount Rules</h4>
                    <p className={styles.subtext}>Offer automatic discounts during slower business hours (e.g., Tuesday mornings) to fill schedule gaps.</p>
                    <form onSubmit={handleAddOffPeak} className={styles.formGroup}>
                      <div className={styles.formRow}>
                        <select
                          value={newOffPeakDay}
                          onChange={(e) => setNewOffPeakDay(e.target.value)}
                          className={styles.formSelect}
                        >
                          <option value="1">Monday</option>
                          <option value="2">Tuesday</option>
                          <option value="3">Wednesday</option>
                          <option value="4">Thursday</option>
                          <option value="5">Friday</option>
                          <option value="6">Saturday</option>
                          <option value="0">Sunday</option>
                        </select>
                        <input
                          type="number"
                          placeholder="Discount (%)"
                          value={newOffPeakDiscount}
                          onChange={(e) => setNewOffPeakDiscount(e.target.value)}
                          className={styles.formInput}
                        />
                      </div>
                      <div className={styles.formRow}>
                        <input
                          type="time"
                          value={newOffPeakStart}
                          onChange={(e) => setNewOffPeakStart(e.target.value)}
                          className={styles.formInput}
                        />
                        <input
                          type="time"
                          value={newOffPeakEnd}
                          onChange={(e) => setNewOffPeakEnd(e.target.value)}
                          className={styles.formInput}
                        />
                      </div>
                      <button type="submit" disabled={isSaving} className={styles.submitBtn}>
                        {isSaving ? 'Creating Rule...' : 'Save Off-Peak Rule'}
                      </button>
                    </form>

                    <div style={{ marginTop: '24px' }}>
                      <h4 style={{ margin: '0 0 10px 0', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px' }}>Active Discount Windows</h4>
                      <ul className={styles.itemUl}>
                        {offPeakRules.length === 0 ? (
                          <li className={styles.emptyLi}>No off-peak pricing windows active.</li>
                        ) : (
                          offPeakRules.map((rule) => {
                            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                            return (
                              <li key={rule.id} className={styles.itemLi}>
                                <span>{days[rule.dayOfWeek]}: {rule.startTime.substring(0,5)} - {rule.endTime.substring(0,5)}</span>
                                <strong style={{ color: '#ef4444' }}>-{rule.discountPercentage}% off</strong>
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}
      </main>
    </div>
  );
}
