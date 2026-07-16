'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import OnboardingWizard from '@/components/admin/OnboardingWizard';
import WeeklyCalendar from '@/components/calendar/WeeklyCalendar';
import baseStyles from './admin.module.css';
import experienceStyles from './admin-experience.module.css';

const styles = Object.fromEntries(
  [...new Set([...Object.keys(baseStyles), ...Object.keys(experienceStyles)])].map((key) => [
    key,
    [baseStyles[key], experienceStyles[key]].filter(Boolean).join(' '),
  ]),
) as typeof baseStyles & typeof experienceStyles;

const DirectoryIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <rect x="3" y="3" width="7" height="9" rx="1"></rect>
    <rect x="14" y="3" width="7" height="5" rx="1"></rect>
    <rect x="14" y="12" width="7" height="9" rx="1"></rect>
    <rect x="3" y="16" width="7" height="5" rx="1"></rect>
  </svg>
);

const UserAddIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
    <circle cx="9" cy="7" r="4"></circle>
    <line x1="19" y1="8" x2="19" y2="14"></line>
    <line x1="22" y1="11" x2="16" y2="11"></line>
  </svg>
);

const LogOutIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
    <polyline points="16 17 21 12 16 7"></polyline>
    <line x1="21" y1="12" x2="9" y2="12"></line>
  </svg>
);

const WebsiteIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10"></circle>
    <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"></path>
  </svg>
);


interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  custom_domain: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  ownerId?: string;
  ownerName?: string;
  ownerEmail?: string;
  package_tier?: string;
  created_at?: string;
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

interface DomainVerificationRecord {
  type: string;
  domain: string;
  value: string;
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
  const [verificationData, setVerificationData] = useState<DomainVerificationRecord[] | null>(null);
  
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
  
  // New Agency controls & Growth analytics state
  const [resetPasswordTenant, setResetPasswordTenant] = useState<Tenant | null>(null);
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [showGrowthReport, setShowGrowthReport] = useState(false);

  const [loadingList, setLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [packageFilter, setPackageFilter] = useState('all');
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
        .select('*, users(id, name, email, role)')
        .order('name');
      if (dbErr) throw dbErr;
      
      const mapped = (data || []).map((t: any) => {
        const owner = t.users?.find((u: any) => u.role === 'owner');
        return {
          ...t,
          ownerId: owner?.id,
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

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPasswordTenant || !resetPasswordTenant.ownerId) {
      alert('Error: Could not locate owner profile ID for this tenant.');
      return;
    }
    setIsResettingPassword(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const response = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          userId: resetPasswordTenant.ownerId,
          newPassword: resetPasswordInput
        })
      });

      const resJson = await response.json();
      if (!response.ok) {
        throw new Error(resJson.error || 'Password reset request failed.');
      }

      alert(`Successfully reset temporary password for ${resetPasswordTenant.name}!\nOwner will be forced to change it on their next login.`);
      setResetPasswordTenant(null);
      setResetPasswordInput('');
    } catch (err: any) {
      setError(err.message || 'Failed to reset password.');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleDeleteTenant = async (tenant: Tenant) => {
    const confirmation = prompt(
      `⚠️ WARNING: Deleting "${tenant.name}" will permanently destroy all salon records (appointments, services, clients, staff) and delete all associated user profiles from Auth.\n\nType the subdomain "${tenant.subdomain}" to confirm deletion:`
    );

    if (confirmation !== tenant.subdomain) {
      if (confirmation !== null) {
        alert('Deletion cancelled: The typed subdomain did not match.');
      }
      return;
    }

    setLoadingList(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('You must be logged in as Master Admin.');
      }

      const response = await fetch('/api/admin/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ tenantId: tenant.id }),
      });

      const resJson = await response.json();
      if (!response.ok) {
        throw new Error(resJson.error || 'Failed to delete tenant.');
      }

      alert(`Successfully deleted salon "${tenant.name}" and removed all cloud configurations.`);
      fetchTenants();
    } catch (err: any) {
      setError(err.message || 'Failed to delete tenant.');
      setLoadingList(false);
    }
  };

  const handleSelectTenant = async (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setCustomDomainInput(tenant.custom_domain || '');
    setVerificationData(null);
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
    setVerificationData(null);

    try {
      const cleanDomain = customDomainInput.trim().toLowerCase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      if (!token) {
        throw new Error('Unauthorized: You must be logged in to update domains.');
      }

      const res = await fetch('/api/admin/domain/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          tenantId: selectedTenant.id,
          customDomain: cleanDomain || null
        })
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to update domain config.');
      }

      setSelectedTenant((prev: any) => ({
        ...prev,
        custom_domain: cleanDomain || null
      }));
      
      setTenants((prev: Tenant[]) => prev.map(t => 
        t.id === selectedTenant.id ? { ...t, custom_domain: cleanDomain || null } : t
      ));

      if (resData.verification && resData.verification.length > 0) {
        setVerificationData(resData.verification);
        alert('Domain mapped. Please configure your DNS settings with the displayed verification records.');
      } else {
        alert('Custom domain mappings saved successfully!');
      }
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

  const normalizedSearch = clientSearch.trim().toLowerCase();
  const filteredTenants = tenants.filter((tenant) => {
    const tier = (tenant.package_tier || 'Core').toLowerCase();
    const matchesTier = packageFilter === 'all' || tier === packageFilter;
    const matchesSearch = !normalizedSearch || [tenant.name, tenant.subdomain, tenant.ownerName, tenant.ownerEmail]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    return matchesTier && matchesSearch;
  });
  const activeWorkspaceCount = tenants.filter((tenant) => Boolean(tenant.ownerEmail)).length;
  const needsAttentionCount = tenants.length - activeWorkspaceCount;
  const tiersInUse = new Set(tenants.map((tenant) => tenant.package_tier || 'Core')).size;

  if (checkingAuth) return <div className={styles.loadingScreen}>Loading agency workspace…</div>;

  return (
    <div className={styles.dashboardContainer}>
      <header className={styles.header}>
        <div className={styles.headerLogo}>
          <svg className={styles.logoIcon} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
          </svg>
          <h2>KS Agency OS</h2>
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
            <DirectoryIcon />
            Clients
          </button>
          <button
            onClick={() => {
              setActiveView('onboard');
              setSelectedTenant(null);
            }}
            className={`${styles.navButton} ${activeView === 'onboard' ? styles.navButtonActive : ''}`}
          >
            <UserAddIcon />
            Provision client
          </button>
          <a href="https://dashboard.kasimshah.com" target="_blank" rel="noreferrer" className={styles.navButton}>
            <WebsiteIcon />
            Website builder
          </a>
          <button onClick={() => supabase.auth.signOut().then(() => router.push('/admin/login'))} className={styles.logoutBtn}>
            <LogOutIcon />
            Sign Out
          </button>
        </div>
      </header>

      <main className={styles.main}>
        {error && <div className={styles.errorBanner}>{error}</div>}

        {/* VIEW 1: Agency client directory */}
        {activeView === 'list' && (
          <div className={styles.viewSection}>
            <div className={styles.directoryHeading}>
              <div>
                <span className={styles.pageEyebrow}>Agency control centre</span>
                <h3>Client workspaces</h3>
                <p>Track every client, confirm their access, and enter the right workspace with context.</p>
              </div>
              <button type="button" onClick={() => setActiveView('onboard')} className={styles.primaryActionBtn}>
                <UserAddIcon />
                Provision client
              </button>
            </div>

            {loadingList ? (
              <div className={styles.listLoading}>Loading client workspaces…</div>
            ) : tenants.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}>＋</span>
                <h4>No client workspaces yet</h4>
                <p>Provision the first workspace to connect its website, bookings, customers and analytics.</p>
                <button onClick={() => setActiveView('onboard')} className={styles.primaryActionBtn}>
                  Provision first client
                </button>
              </div>
            ) : (
              <>
                <div className={styles.directoryMetrics}>
                  <article><span>Total clients</span><strong>{tenants.length}</strong><small>Provisioned workspaces</small></article>
                  <article><span>Active</span><strong>{activeWorkspaceCount}</strong><small>Owner access configured</small></article>
                  <article><span>Needs attention</span><strong>{needsAttentionCount}</strong><small>Missing owner access</small></article>
                  <article><span>Plans in use</span><strong>{tiersInUse}</strong><small>Across the client base</small></article>
                </div>

                <div className={styles.directoryToolbar}>
                  <label className={styles.searchField}>
                    <span className={styles.visuallyHidden}>Search clients</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <input
                      type="search"
                      value={clientSearch}
                      onChange={(event) => setClientSearch(event.target.value)}
                      placeholder="Search client, owner or workspace"
                    />
                  </label>
                  <label className={styles.filterField}>
                    <span>Plan</span>
                    <select value={packageFilter} onChange={(event) => setPackageFilter(event.target.value)}>
                      <option value="all">All plans</option>
                      <option value="core">Core</option>
                      <option value="growth">Growth</option>
                      <option value="scale">Scale</option>
                    </select>
                  </label>
                  <span className={styles.resultCount}>{filteredTenants.length} of {tenants.length} clients</span>
                </div>

                <div className={styles.clientTableShell}>
                  <table className={styles.clientTable}>
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th>Plan</th>
                        <th>Status</th>
                        <th>Workspace</th>
                        <th>Onboarded</th>
                        <th><span className={styles.visuallyHidden}>Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTenants.length === 0 ? (
                        <tr><td colSpan={6} className={styles.tableEmpty}>No clients match those filters.</td></tr>
                      ) : filteredTenants.map((tenant) => {
                        const isActive = Boolean(tenant.ownerEmail);
                        return (
                          <tr key={tenant.id}>
                            <td>
                              <div className={styles.clientIdentity}>
                                <span className={styles.clientAvatar} style={{ '--client-accent': tenant.accent_color || '#d4af37' } as React.CSSProperties}>
                                  {tenant.name.substring(0, 2).toUpperCase()}
                                </span>
                                <div>
                                  <strong>{tenant.name}</strong>
                                  <small>{tenant.ownerEmail || 'Owner access not configured'}</small>
                                </div>
                              </div>
                            </td>
                            <td><span className={styles.packageBadge}>{tenant.package_tier || 'Core'}</span></td>
                            <td><span className={`${styles.workspaceStatus} ${isActive ? styles.statusActive : styles.statusAttention}`}><i />{isActive ? 'Active' : 'Needs attention'}</span></td>
                            <td>
                              <div className={styles.workspaceUrl}>
                                <code>{tenant.subdomain}.kasimshah.com</code>
                                {tenant.custom_domain && <small>{tenant.custom_domain}</small>}
                              </div>
                            </td>
                            <td className={styles.dateCell}>{tenant.created_at ? new Date(tenant.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                            <td>
                              <div className={styles.rowActions}>
                                <a href={`/${tenant.subdomain}?agencyPreview=1`} className={styles.viewWorkspaceBtn}>View as client</a>
                                <button type="button" onClick={() => handleSelectTenant(tenant)} className={styles.configureBtn}>Configure</button>
                                <details className={styles.moreActions}>
                                  <summary aria-label={`More actions for ${tenant.name}`}>•••</summary>
                                  <div>
                                    {tenant.ownerId && (
                                      <button type="button" onClick={() => { setResetPasswordTenant(tenant); setResetPasswordInput(''); }}>Reset owner password</button>
                                    )}
                                    <button type="button" className={styles.dangerAction} onClick={() => handleDeleteTenant(tenant)}>Delete workspace</button>
                                  </div>
                                </details>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
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
                <span className={styles.pageEyebrow}>Client configuration</span>
                <h3>{selectedTenant.name}</h3>
                <code>{selectedTenant.subdomain}.kasimshah.com</code>
              </div>
              <div className={styles.tenantHeaderActions}>
                <span className={styles.packageBadge}>{selectedTenant.package_tier || 'Core'} plan</span>
                <a href={`/${selectedTenant.subdomain}?agencyPreview=1`} className={styles.viewWorkspaceBtn}>View as client ↗</a>
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

              {verificationData && verificationData.length > 0 && (
                <div style={{ marginTop: '16px', padding: '16px', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}>
                  <h4 style={{ color: '#f8fafc', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold' }}>
                    ⚠️ Action Required: Verify Domain Ownership
                  </h4>
                  <p style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '12px' }}>
                    To complete linking your custom domain, please add the following DNS record(s) at your domain registrar:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {verificationData.map((record) => (
                      <div key={`${record.type}-${record.domain}-${record.value}`} style={{ fontSize: '12px', backgroundColor: '#0f172a', padding: '12px', borderRadius: '6px', border: '1px solid #1e293b' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '4px', marginBottom: '4px' }}>
                          <span style={{ color: '#64748b' }}>Type:</span>
                          <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>{record.type}</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '4px', marginBottom: '4px' }}>
                          <span style={{ color: '#64748b' }}>Name/Host:</span>
                          <code style={{ color: '#e2e8f0', backgroundColor: '#1e293b', padding: '2px 4px', borderRadius: '4px', wordBreak: 'break-all' }}>{record.domain}</code>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '4px' }}>
                          <span style={{ color: '#64748b' }}>Value:</span>
                          <code style={{ color: '#e2e8f0', backgroundColor: '#1e293b', padding: '2px 4px', borderRadius: '4px', wordBreak: 'break-all' }}>{record.value}</code>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p style={{ color: '#94a3b8', fontSize: '11px', marginTop: '12px' }}>
                    Note: DNS changes can take up to 24-48 hours to propagate globally. Vercel will automatically issue the SSL certificate once verification succeeds.
                  </p>
                </div>
              )}
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                    <h4 style={{ margin: 0, color: '#ffffff', fontSize: '15px' }}>Salon Dashboard Overview</h4>
                    <button
                      onClick={() => setShowGrowthReport(true)}
                      style={{
                        background: 'var(--md-sys-color-primary, #d4af37)',
                        color: '#1e1400',
                        border: 'none',
                        borderRadius: '99px',
                        padding: '10px 22px',
                        fontWeight: 800,
                        fontSize: '13px',
                        cursor: 'pointer',
                        boxShadow: '0 4px 14px rgba(212, 175, 55, 0.25)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="20" x2="18" y2="10"></line>
                        <line x1="12" y1="20" x2="12" y2="4"></line>
                        <line x1="6" y1="20" x2="6" y2="14"></line>
                      </svg>
                      Open workspace report
                    </button>
                  </div>

                  <div className={styles.analyticsSummaryCards}>
                    <div className={styles.summaryCard}>
                      <span className={styles.cardIndicator}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--md-sys-color-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="1" x2="12" y2="23"></line>
                          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                        </svg>
                      </span>
                      <div>
                        <h3>£{(totalSales / 100).toFixed(2)}</h3>
                        <p>Recorded revenue</p>
                      </div>
                    </div>
                    <div className={styles.summaryCard}>
                      <span className={styles.cardIndicator}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--md-sys-color-secondary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                          <line x1="16" y1="13" x2="8" y2="13"></line>
                          <line x1="16" y1="17" x2="8" y2="17"></line>
                          <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                      </span>
                      <div>
                        <h3>{salesCount}</h3>
                        <p>Total Completed Checkouts</p>
                      </div>
                    </div>
                    <div className={styles.summaryCard}>
                      <span className={styles.cardIndicator}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="2" y1="12" x2="22" y2="12"></line>
                          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                        </svg>
                      </span>
                      <div>
                        <h3>{services.length}</h3>
                        <p>Active services</p>
                      </div>
                    </div>
                    <div className={styles.summaryCard}>
                      <span className={styles.cardIndicator}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--md-sys-color-tertiary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                          <polyline points="17 6 23 6 23 12"></polyline>
                        </svg>
                      </span>
                      <div>
                        <h3>{staff.length}</h3>
                        <p>Team members</p>
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
                            staffRevenues.map((s) => (
                              <tr key={s.staffName}>
                                <td><strong>{s.staffName}</strong></td>
                                <td>{s.bookings}</td>
                                <td style={{ color: '#10b981', fontWeight: 700 }}>£{(s.revenue / 100).toFixed(2)}</td>
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
                            topServicesList.map((svc) => (
                              <tr key={svc.name}>
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
                          placeholder="Price (£)"
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
                            <span style={{ color: '#10b981', fontWeight: 700 }}>£{(s.price / 100).toFixed(2)}</span>
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
        {/* MODAL 1: Password Reset Dialog */}
        {resetPasswordTenant && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            fontFamily: 'sans-serif'
          }}>
            <div style={{
              background: '#111625',
              border: '1.5px solid rgba(212,175,55,0.2)',
              borderRadius: '16px',
              padding: '28px',
              width: '100%',
              maxWidth: '420px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
            }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 800, color: '#ffffff' }}>
                Reset Business Password
              </h3>
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#94a3b8', lineHeight: 1.4 }}>
                Set a temporary password for <strong>{resetPasswordTenant.name}</strong> owner account ({resetPasswordTenant.ownerEmail}). They will be forced to change it on their next sign-in.
              </p>

              <form onSubmit={handleResetPasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label htmlFor="temp-pw" style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Temporary Password</label>
                  <input
                    id="temp-pw"
                    type="password"
                    required
                    minLength={8}
                    placeholder="Min 8 characters"
                    value={resetPasswordInput}
                    onChange={(e) => setResetPasswordInput(e.target.value)}
                    style={{ fontSize: '14px', padding: '10px 12px', background: '#090d16', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setResetPasswordTenant(null)}
                    style={{ flex: 1, background: '#334155', color: '#ffffff', border: 'none', borderRadius: '99px', padding: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isResettingPassword}
                    style={{ flex: 1, background: '#ef4444', color: '#ffffff', border: 'none', borderRadius: '99px', padding: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    {isResettingPassword ? 'Resetting...' : 'Confirm Reset'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 2: Growth Report Overlay */}
        {showGrowthReport && selectedTenant && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            fontFamily: 'sans-serif',
            padding: '20px',
            boxSizing: 'border-box'
          }}>
            <div style={{
              background: '#090d16',
              border: '2px solid rgba(212,175,55,0.3)',
              borderRadius: '20px',
              padding: '36px',
              width: '100%',
              maxWidth: '650px',
              boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
              overflowY: 'auto',
              maxHeight: '90vh',
              boxSizing: 'border-box',
              color: '#cbd5e1'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid rgba(212,175,55,0.15)', paddingBottom: '16px', marginBottom: '20px' }}>
                <div>
                  <span style={{ fontSize: '10px', background: '#3c2a00', color: '#d4af37', border: '1px solid rgba(212,175,55,0.3)', padding: '2px 8px', borderRadius: '99px', fontWeight: 700, textTransform: 'uppercase' }}>
                    KS Growth Engine
                  </span>
                  <h2 style={{ margin: '6px 0 0 0', fontSize: '24px', fontWeight: 800, color: '#ffffff' }}>
                    Workspace performance report
                  </h2>
                </div>
                <button
                  onClick={() => setShowGrowthReport(false)}
                  style={{ background: 'transparent', color: '#64748b', border: 'none', fontSize: '20px', cursor: 'pointer', outline: 'none' }}
                >
                  ✕
                </button>
              </div>

              {/* Printable Area content */}
              <div id="growth-report-card" style={{ background: '#111625', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '24px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '18px', color: '#ffffff' }}>{selectedTenant.name}</h4>
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>URL: {selectedTenant.subdomain}.kasimshah.com</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>Generated: {new Date().toLocaleDateString()}</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                  <div style={{ background: '#090d16', padding: '12px', borderRadius: '8px', border: '1px solid rgba(212,175,55,0.1)' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Sales Revenue</span>
                    <h3 style={{ margin: '4px 0 0 0', color: '#10b981', fontSize: '20px' }}>£{(totalSales / 100).toFixed(2)}</h3>
                  </div>
                  <div style={{ background: '#090d16', padding: '12px', borderRadius: '8px', border: '1px solid rgba(212,175,55,0.1)' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Checkouts</span>
                    <h3 style={{ margin: '4px 0 0 0', color: '#ffffff', fontSize: '20px' }}>{salesCount} sales</h3>
                  </div>
                  <div style={{ background: '#090d16', padding: '12px', borderRadius: '8px', border: '1px solid rgba(212,175,55,0.1)' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Active services</span>
                    <h3 style={{ margin: '4px 0 0 0', color: '#ffffff', fontSize: '20px' }}>{services.length}</h3>
                  </div>
                  <div style={{ background: '#090d16', padding: '12px', borderRadius: '8px', border: '1px solid rgba(212,175,55,0.1)' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Team members</span>
                    <h3 style={{ margin: '4px 0 0 0', color: '#d4af37', fontSize: '20px' }}>{staff.length}</h3>
                  </div>
                </div>

                <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#ffffff', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }}>
                  Recorded workspace summary
                </h4>
                <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.5, margin: '0 0 12px 0' }}>
                  This report reflects the live records currently available in <strong>KS OS</strong>: <strong>{salesCount}</strong> completed checkouts and <strong>£{(totalSales / 100).toFixed(2)}</strong> in recorded revenue. Website traffic and conversion are intentionally omitted until an analytics source is connected.
                </p>
                <ul style={{ paddingLeft: '18px', fontSize: '12px', color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>
                  <li><strong>{services.length}</strong> services configured in this workspace.</li>
                  <li><strong>{staff.length}</strong> team members configured in this workspace.</li>
                  <li><strong>{waitlistList.length}</strong> current waitlist records.</li>
                </ul>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    const el = document.getElementById('growth-report-card');
                    if (el) {
                      navigator.clipboard.writeText(el.innerText || '');
                      alert('Growth report text copied to clipboard!');
                    }
                  }}
                  style={{ background: 'rgba(212,175,55,0.12)', color: '#d4af37', border: '1px solid rgba(212,175,55,0.25)', borderRadius: '99px', padding: '10px 20px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  📋 Copy Report Data
                </button>
                <button
                  onClick={() => setShowGrowthReport(false)}
                  style={{ background: '#334155', color: '#ffffff', border: 'none', borderRadius: '99px', padding: '10px 20px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
