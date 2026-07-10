'use client';

import React, { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  
  // Auth and Login States
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  // Password change states
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordChangeError, setPasswordChangeError] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordChangeSuccess, setPasswordChangeSuccess] = useState(false);

  // Forgotten password states
  const [showForgot, setShowForgot] = useState(false);

  // Customizable Consent Form Builder states
  const [consentFormId, setConsentFormId] = useState<string | null>(null);
  const [consentFormTitle, setConsentFormTitle] = useState('Medical Consent Form');
  const [consentFormFields, setConsentFormFields] = useState<any[]>([]);
  
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<'text' | 'textarea' | 'checkbox' | 'select' | 'radio' | 'signature'>('text');
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldOptions, setNewFieldOptions] = useState('');

  // Workspace settings tab and metadata
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
  const [conversionRate, setConversionRate] = useState(0);
  const [staffRevenues, setStaffRevenues] = useState<StaffRevenue[]>([]);

  // Service Inline Editing State
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editServiceName, setEditServiceName] = useState('');
  const [editServicePrice, setEditServicePrice] = useState('');
  const [editServiceDuration, setEditServiceDuration] = useState('30');
  const [editServiceDiscount, setEditServiceDiscount] = useState('0');

  // Studio Forms States (Adding service / staff)
  const [newServiceName, setNewServiceName] = useState('');
  const [newServicePrice, setNewServicePrice] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState('30');
  const [newServiceDiscount, setNewServiceDiscount] = useState('0');
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // POS Drawer States
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [checkoutApptId, setCheckoutApptId] = useState<string | null>(null);

  // Active client selected for CRM view
  const [selectedClientId, setSelectedClientId] = useState<string>('99999999-9999-9999-9999-999999999999');

  // Check auth session on load
  const checkAuthSession = async () => {
    try {
      setCheckingAuth(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Fetch current tenant configuration to match
        const { data: tenant, error: tErr } = await supabase
          .from('tenants')
          .select('id, name, custom_domain')
          .eq('subdomain', subdomain.toLowerCase())
          .single();

        if (tErr || !tenant) {
          setCurrentUser(null);
          return;
        }

        // Validate user is owner of this tenant
        const { data: profile, error: pErr } = await supabase
          .from('users')
          .select('id, role, tenant_id, permissions')
          .eq('id', user.id)
          .single();

        if (pErr || !profile || profile.role !== 'owner' || profile.tenant_id !== tenant.id) {
          await supabase.auth.signOut();
          setCurrentUser(null);
        } else {
          setCurrentUser(user);
          setTenantId(tenant.id);
          setTenantName(tenant.name);
          setCustomDomain(tenant.custom_domain);
          if (profile.permissions?.requires_password_change === true) {
            setMustChangePassword(true);
          }
        }
      } else {
        setCurrentUser(null);
      }
    } catch (err) {
      console.error('Session validation error:', err);
    } finally {
      setCheckingAuth(false);
    }
  };

  useEffect(() => {
    checkAuthSession();
  }, [subdomain]);

  const loadWorkspaceData = async () => {
    if (!currentUser) return;
    try {
      setLoading(true);
      
      // 1. Fetch services (including discount)
      const { data: svcData } = await supabase
        .from('services')
        .select('id, name, price, duration, discount')
        .eq('tenant_id', tenantId);
      
      // 2. Fetch staff
      const { data: staffData } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('tenant_id', tenantId);

      const activeSvcList = svcData && svcData.length > 0 ? svcData : MOCK_SERVICES;
      const activeStaffList = staffData && staffData.length > 0 ? staffData : MOCK_STAFF;
      setServices(activeSvcList);
      setStaff(activeStaffList);

      // 3. Fetch local checkout transactions for analytics calculations
      const { data: transactions } = await supabase
        .from('checkout_transactions')
        .select('total_amount, appointments(user_id)')
        .eq('tenant_id', tenantId);

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

      // 4. Fetch appointments to calculate booked-to-sold conversion rates
      const { data: apptData } = await supabase
        .from('appointments')
        .select('id, status')
        .eq('tenant_id', tenantId);

      if (apptData && apptData.length > 0) {
        const total = apptData.length;
        const sold = apptData.filter((a: any) => a.status === 'COMPLETED').length;
        const rate = Math.round((sold / total) * 100);
        setConversionRate(rate);
      } else {
        setConversionRate(0);
      }

      // 5. Fetch dynamic consent form template
      const { data: formTemplate } = await supabase
        .from('forms')
        .select('*')
        .eq('tenant_id', tenantId)
        .limit(1)
        .maybeSingle();

      if (formTemplate) {
        setConsentFormId(formTemplate.id);
        setConsentFormTitle(formTemplate.title);
        setConsentFormFields(formTemplate.fields_json || []);
      } else {
        // Seed default template fields in state
        setConsentFormFields([
          { label: 'Do you have skin allergies?', type: 'textarea', required: false },
          { label: 'I consent to the treatment', type: 'checkbox', required: true },
          { label: 'Client Signature', type: 'signature', required: true }
        ]);
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
    if (currentUser && tenantId !== '00000000-0000-0000-0000-000000000000') {
      loadWorkspaceData();
    }
  }, [currentUser, tenantId]);

  // Forgot Password email request
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoggingIn(true);
    try {
      const isLocal = window.location.host.includes('localhost');
      const redirectUrl = isLocal 
        ? `http://localhost:3000/auth/reset-password` 
        : `https://kasimshah.com/auth/reset-password`; // Recovery points back to root domain recovery router
        
      const { error } = await supabase.auth.resetPasswordForEmail(loginEmail, {
        redirectTo: redirectUrl
      });
      if (error) throw error;
      alert(`Reset password email sent! Check your inbox for recovery link.`);
      setShowForgot(false);
    } catch (err: any) {
      setAuthError(err.message || 'Failed to trigger password recovery.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Form customizer handlers
  const handleSaveConsentForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tenantId === '00000000-0000-0000-0000-000000000000') {
      alert('Mock environment: changes will not save.');
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        tenant_id: tenantId,
        title: consentFormTitle,
        fields_json: consentFormFields
      };

      let error;
      if (consentFormId) {
        const { error: err } = await supabase
          .from('forms')
          .update(payload)
          .eq('id', consentFormId);
        error = err;
      } else {
        const { data, error: err } = await supabase
          .from('forms')
          .insert(payload)
          .select('id')
          .single();
        error = err;
        if (data) setConsentFormId(data.id);
      }

      if (error) throw error;
      alert('Consent Form layout configurations saved successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to save consent form layout.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddField = () => {
    if (!newFieldLabel.trim()) return;
    const optionsArray = newFieldOptions
      ? newFieldOptions.split(',').map((o) => o.trim()).filter(Boolean)
      : undefined;

    const newField = {
      label: newFieldLabel,
      type: newFieldType,
      required: newFieldRequired,
      ...(optionsArray && { options: optionsArray })
    };

    setConsentFormFields((prev) => [...prev, newField]);
    setNewFieldLabel('');
    setNewFieldRequired(false);
    setNewFieldOptions('');
  };

  const handleRemoveField = (idx: number) => {
    setConsentFormFields((prev) => prev.filter((_, i) => i !== idx));
  };

  // Login handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoggingIn(true);

    try {
      const { data: tenant, error: tErr } = await supabase
        .from('tenants')
        .select('id, name, custom_domain')
        .eq('subdomain', subdomain.toLowerCase())
        .single();

      if (tErr || !tenant) {
        throw new Error('Tenant workspace not found.');
      }

      const { data: authData, error: loginErr } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword
      });

      if (loginErr) throw loginErr;
      if (!authData.user) throw new Error('Could not retrieve authenticated user details.');

      // Check role
      const { data: profile, error: pErr } = await supabase
        .from('users')
        .select('id, role, tenant_id, permissions')
        .eq('id', authData.user.id)
        .single();

      if (pErr || !profile) {
        await supabase.auth.signOut();
        throw new Error('Owner profile details not found in database.');
      }

      if (profile.role !== 'owner' || profile.tenant_id !== tenant.id) {
        await supabase.auth.signOut();
        throw new Error('Access denied: You do not have owner administrative rights for this workspace.');
      }

      setTenantId(tenant.id);
      setTenantName(tenant.name);
      setCustomDomain(tenant.custom_domain);
      setCurrentUser(authData.user);
      
      if (profile.permissions?.requires_password_change === true) {
        setMustChangePassword(true);
      }
    } catch (err: any) {
      setAuthError(err.message || 'Login credentials invalid.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Logout handler
  const handleLogout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setMustChangePassword(false);
    setTenantId('00000000-0000-0000-0000-000000000000');
    setActiveTab('calendar');
  };

  // Change password handler (handles both forced and manual resets)
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordChangeError(null);
    setPasswordChangeSuccess(false);
    setIsChangingPassword(true);

    if (newPassword !== confirmNewPassword) {
      setPasswordChangeError('Passwords do not match.');
      setIsChangingPassword(false);
      return;
    }

    if (newPassword.length < 8) {
      setPasswordChangeError('Password must be at least 8 characters long.');
      setIsChangingPassword(false);
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      // Update public.users database metadata flag
      if (currentUser) {
        const { error: dbErr } = await supabase
          .from('users')
          .update({
            permissions: { requires_password_change: false }
          })
          .eq('id', currentUser.id);
        
        if (dbErr) console.warn('Could not clear force password flag in profile:', dbErr.message);
      }

      setPasswordChangeSuccess(true);
      setNewPassword('');
      setConfirmNewPassword('');
      
      if (mustChangePassword) {
        setMustChangePassword(false);
        alert('Password successfully updated! Redirecting to workspace...');
        await loadWorkspaceData();
      } else {
        alert('Password updated successfully!');
      }
    } catch (err: any) {
      setPasswordChangeError(err.message || 'Failed to update password.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Create new service
  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tenantId === '00000000-0000-0000-0000-000000000000') {
      alert('Mock environment: changes will not save to database.');
      return;
    }
    setIsSaving(true);

    try {
      const priceCents = Math.round(parseFloat(newServicePrice) * 100);
      const discountCents = Math.round(parseFloat(newServiceDiscount || '0') * 100);

      if (isNaN(priceCents) || priceCents <= 0) throw new Error('Specify a valid price.');
      if (isNaN(discountCents) || discountCents < 0) throw new Error('Specify a valid discount.');
      if (discountCents > priceCents) throw new Error('Discount cannot exceed the service price.');

      const { data, error } = await supabase
        .from('services')
        .insert({
          tenant_id: tenantId,
          name: newServiceName,
          description: 'Custom service added by Studio Owner.',
          duration: parseInt(newServiceDuration, 10),
          price: priceCents,
          discount: discountCents,
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;
      setServices((prev) => [...prev, data]);
      setNewServiceName('');
      setNewServicePrice('');
      setNewServiceDiscount('0');
      alert('New service added successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to add service.');
    } finally {
      setIsSaving(false);
    }
  };

  // Update existing service
  const handleUpdateService = async (serviceId: string) => {
    setIsSaving(true);
    try {
      const priceCents = Math.round(parseFloat(editServicePrice) * 100);
      const discountCents = Math.round(parseFloat(editServiceDiscount) * 100);

      if (isNaN(priceCents) || priceCents <= 0) throw new Error('Specify a valid price.');
      if (isNaN(discountCents) || discountCents < 0) throw new Error('Specify a valid discount.');
      if (discountCents > priceCents) throw new Error('Discount cannot exceed the service price.');

      const { data, error } = await supabase
        .from('services')
        .update({
          name: editServiceName,
          price: priceCents,
          duration: parseInt(editServiceDuration, 10),
          discount: discountCents
        })
        .eq('id', serviceId)
        .select()
        .single();

      if (error) throw error;
      
      setServices((prev) => prev.map((s) => (s.id === serviceId ? data : s)));
      setEditingServiceId(null);
      alert('Service catalog item updated successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to update service.');
    } finally {
      setIsSaving(false);
    }
  };

  // Delete service
  const handleDeleteService = async (serviceId: string) => {
    if (!confirm('Are you sure you want to permanently remove this service from the catalog?')) return;
    try {
      const { error } = await supabase
        .from('services')
        .delete()
        .eq('id', serviceId);

      if (error) throw error;
      setServices((prev) => prev.filter((s) => s.id !== serviceId));
      alert('Service deleted successfully.');
    } catch (err: any) {
      alert(err.message || 'Failed to delete service.');
    }
  };

  const handleStartEditService = (s: any) => {
    setEditingServiceId(s.id);
    setEditServiceName(s.name);
    setEditServicePrice((s.price / 100).toString());
    setEditServiceDuration(s.duration.toString());
    setEditServiceDiscount((s.discount / 100).toString());
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

  // UI GATE A: Checking session loading state
  if (checkingAuth) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#090d16', color: '#94a3b8', fontSize: '14px', fontWeight: 700 }}>
        Resolving owner credentials and workspace settings...
      </div>
    );
  }

  // UI GATE B: Login Screen
  if (!currentUser) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#090d16', fontFamily: 'sans-serif', padding: '16px', boxSizing: 'border-box' }}>
        <div style={{ background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '400px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <span style={{ fontSize: '40px' }}>🔒</span>
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#ffffff', margin: '12px 0 6px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {subdomain.toUpperCase()} Workspace
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>Sign in to access your administrative control panel.</p>
          </div>

          {authError && (
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#ef4444', borderRadius: '8px', padding: '12px', fontSize: '12px', marginBottom: '16px', fontWeight: 600 }}>
              ⚠️ {authError}
            </div>
          )}

          {showForgot ? (
            <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label htmlFor="forgotEmail" style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Email Address</label>
                <input
                  id="forgotEmail"
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="owner@yourstudio.com"
                  style={{ fontSize: '14px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                />
              </div>
              <button
                type="submit"
                disabled={isLoggingIn}
                style={{ background: '#d4af37', color: '#1e1400', border: 'none', borderRadius: '99px', padding: '12px', fontWeight: 800, cursor: 'pointer', fontSize: '13px', marginTop: '8px', boxShadow: '0 4px 14px rgba(212, 175, 55, 0.25)' }}
              >
                {isLoggingIn ? 'Sending link...' : 'Send Recovery Email'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForgot(false);
                  setAuthError(null);
                }}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '12px', cursor: 'pointer', marginTop: '8px' }}
              >
                ← Back to Sign In
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label htmlFor="loginEmail" style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Email Address</label>
                <input
                  id="loginEmail"
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="owner@yourstudio.com"
                  style={{ fontSize: '14px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="loginPassword" style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgot(true);
                      setAuthError(null);
                    }}
                    style={{ background: 'transparent', border: 'none', color: '#d4af37', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Forgot Password?
                  </button>
                </div>
                <input
                  id="loginPassword"
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{ fontSize: '14px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                />
              </div>
              <button
                type="submit"
                disabled={isLoggingIn}
                style={{ background: '#d4af37', color: '#1e1400', border: 'none', borderRadius: '99px', padding: '12px', fontWeight: 800, cursor: 'pointer', fontSize: '13px', marginTop: '8px', boxShadow: '0 4px 14px rgba(212, 175, 55, 0.25)' }}
              >
                {isLoggingIn ? 'Authenticating...' : 'Sign In'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // UI GATE C: Force Password Reset view (for requires_password_change = true)
  if (mustChangePassword) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#090d16', fontFamily: 'sans-serif', padding: '16px', boxSizing: 'border-box' }}>
        <div style={{ background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '400px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <span style={{ fontSize: '40px' }}>🔑</span>
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#ffffff', margin: '12px 0 6px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Set New Password
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>For security, please change the temporary password provided by your agency admin.</p>
          </div>

          {passwordChangeError && (
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#ef4444', borderRadius: '8px', padding: '12px', fontSize: '12px', marginBottom: '16px', fontWeight: 600 }}>
              ⚠️ {passwordChangeError}
            </div>
          )}

          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="newPassword" style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>New Password</label>
              <input
                id="newPassword"
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                style={{ fontSize: '14px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="confirmNewPassword" style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Confirm Password</label>
              <input
                id="confirmNewPassword"
                type="password"
                required
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Confirm password"
                style={{ fontSize: '14px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
              />
            </div>
            <button
              type="submit"
              disabled={isChangingPassword}
              style={{ background: '#d4af37', color: '#1e1400', border: 'none', borderRadius: '99px', padding: '12px', fontWeight: 800, cursor: 'pointer', fontSize: '13px', marginTop: '8px', boxShadow: '0 4px 14px rgba(212, 175, 55, 0.25)' }}
            >
              {isChangingPassword ? 'Saving Password...' : 'Save & Enter Dashboard'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Dashboard Frame (Authenticated and Verified)
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#090d16', color: '#cbd5e1', fontFamily: 'sans-serif' }}>
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
          <span style={{ fontSize: '22px' }}>🏢</span>
          <h1 style={{ fontSize: '18px', fontWeight: 800, margin: 0, background: 'linear-gradient(135deg, #ffffff 0%, #d4af37 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {tenantName ? tenantName.toUpperCase() : subdomain.toUpperCase()} Studio
          </h1>
          <span style={{ fontSize: '10px', background: '#3c2a00', color: '#d4af37', border: '1px solid rgba(212,175,55,0.3)', padding: '2px 10px', borderRadius: '99px', fontWeight: 700 }}>
            Owner Control Panel
          </span>
        </div>
        
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={() => router.push('/book-manual')}
            style={{ background: 'rgba(212, 175, 55, 0.12)', color: '#d4af37', border: '1px solid rgba(212, 175, 55, 0.25)', borderRadius: '99px', padding: '8px 18px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s', marginRight: '8px' }}
          >
            ➕ Manual Booking Desk
          </button>
          <button
            onClick={() => setActiveTab('calendar')}
            style={{ background: activeTab === 'calendar' ? '#d4af37' : 'transparent', color: activeTab === 'calendar' ? '#1e1400' : '#94a3b8', border: 'none', borderRadius: '99px', padding: '8px 18px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
          >
            Schedules Calendar
          </button>
          <button
            onClick={() => setActiveTab('booking')}
            style={{ background: activeTab === 'booking' ? '#d4af37' : 'transparent', color: activeTab === 'booking' ? '#1e1400' : '#94a3b8', border: 'none', borderRadius: '99px', padding: '8px 18px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
          >
            Live Booking Page
          </button>
          <button
            onClick={() => setActiveTab('crm')}
            style={{ background: activeTab === 'crm' ? '#d4af37' : 'transparent', color: activeTab === 'crm' ? '#1e1400' : '#94a3b8', border: 'none', borderRadius: '99px', padding: '8px 18px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
          >
            Client CRM
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            style={{ background: activeTab === 'manage' ? '#d4af37' : 'transparent', color: activeTab === 'manage' ? '#1e1400' : '#94a3b8', border: 'none', borderRadius: '99px', padding: '8px 18px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
          >
            Manage Studio
          </button>
          
          <button
            onClick={handleLogout}
            style={{ background: '#3b0712', color: '#fca5a5', border: '1px solid #7f1d1d', borderRadius: '99px', padding: '8px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', marginLeft: '12px' }}
          >
            Logout ➡️
          </button>
        </div>
      </header>

      <main style={{ flex: 1, padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '1200px', margin: '0 auto', boxSizing: 'border-box' }}>
        {loading ? (
          <div style={{ padding: '60px', fontWeight: 'bold', color: '#94a3b8', fontSize: '14px' }}>Loading workspace analytics and configurations...</div>
        ) : (
          <>
            {/* STUDIO QUICK ACCESS DOCK (ONE-STOP SHOP) */}
            <div style={{
              width: '100%',
              background: 'linear-gradient(135deg, #111625 0%, #171d31 100%)',
              border: '1.5px solid rgba(212, 175, 55, 0.2)',
              borderRadius: '16px',
              padding: '18px 24px',
              marginBottom: '28px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
              boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
              boxSizing: 'border-box'
            }}>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>
                  ⚡ Studio Quick Access Control
                </h3>
                <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>
                  Manage external links, contact support, and share your web booking address.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <a
                  href={`mailto:${currentUser?.email}?subject=KS%20OS%20Mailbox`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    color: '#ffffff',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '12px',
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                >
                  📧 Access Webmail
                </a>
                <a
                  href={`http://${subdomain}.localhost:3000/book`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    background: 'rgba(212,175,55,0.12)',
                    color: '#d4af37',
                    border: '1px solid rgba(212, 175, 55, 0.25)',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '12px',
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(212,175,55,0.2)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'rgba(212,175,55,0.12)'}
                >
                  🌐 Visit Booking Site
                </a>
                <button
                  onClick={() => {
                    const isLocal = window.location.host.includes('localhost');
                    const link = isLocal 
                      ? `http://${subdomain}.localhost:3000/book` 
                      : `https://${subdomain}.kasimshah.com/book`;
                    navigator.clipboard.writeText(link);
                    alert('Public Booking Web Address copied to clipboard!');
                  }}
                  style={{
                    background: '#10b981',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '9px 16px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s',
                    boxShadow: '0 4px 10px rgba(16, 185, 129, 0.15)'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = '#059669'}
                  onMouseOut={(e) => e.currentTarget.style.background = '#10b981'}
                >
                  📋 Copy Web Address
                </button>
              </div>
            </div>
            {activeTab === 'calendar' && (
              <div style={{ width: '100%' }}>
                <WeeklyCalendar 
                  tenantId={tenantId} 
                  staffMembers={staff} 
                  services={services} 
                  onCheckoutAppt={(apptId) => {
                    setCheckoutApptId(apptId);
                    setIsCheckoutOpen(true);
                  }}
                />
                <div style={{ marginTop: '24px', background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
                  <div>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: '#ffffff' }}>POS Checkout Terminal</h4>
                    <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>Checkout completed bookings, calculate loyalty rewards, and record checkout sales totals.</p>
                  </div>
                  <button
                    onClick={() => {
                      setCheckoutApptId('88888888-8888-8888-8888-888888888888');
                      setIsCheckoutOpen(true);
                    }}
                    style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '99px', padding: '10px 22px', fontWeight: 800, fontSize: '13px', cursor: 'pointer', boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25)' }}
                  >
                    Launch Checkout Terminal
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'booking' && (
              <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                <TimeSlotPicker 
                  tenantId={tenantId} 
                  services={services} 
                  staffMembers={staff} 
                  onSlotSelected={(slot) => {
                    loadWorkspaceData();
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

            {activeTab === 'manage' && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '28px' }}>
                
                {/* Section A: Revenue Metrics for this salon */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
                  <div style={{ background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{ fontSize: '32px' }}>💰</span>
                    <div>
                      <h3 style={{ margin: '0 0 4px 0', fontSize: '26px', fontWeight: 850, color: '#d4af37' }}>
                        ${(totalSales / 100).toFixed(2)}
                      </h3>
                      <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', fontWeight: 700 }}>Total Revenue Made</p>
                    </div>
                  </div>
                  <div style={{ background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{ fontSize: '32px' }}>📈</span>
                    <div>
                      <h3 style={{ margin: '0 0 4px 0', fontSize: '26px', fontWeight: 850, color: '#10b981' }}>
                        {conversionRate}%
                      </h3>
                      <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', fontWeight: 700 }}>Booked-to-Sold Conversion</p>
                    </div>
                  </div>
                  <div style={{ background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{ fontSize: '32px' }}>📅</span>
                    <div>
                      <h3 style={{ margin: '0 0 4px 0', fontSize: '26px', fontWeight: 850, color: '#d4af37' }}>
                        {salesCount}
                      </h3>
                      <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', fontWeight: 700 }}>Completed Transactions</p>
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
                    <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: '#94a3b8' }}>Publish new treatments and custom price/discount structures instantly.</p>
                    
                    <form onSubmit={handleAddService} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <input
                        type="text"
                        required
                        placeholder="Service Name (e.g. Skin Fade & Wash)"
                        value={newServiceName}
                        onChange={(e) => setNewServiceName(e.target.value)}
                        style={{ fontFamily: 'sans-serif', fontSize: '13px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                      />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: '10px' }}>
                        <input
                          type="number"
                          required
                          step="0.01"
                          placeholder="Price ($)"
                          value={newServicePrice}
                          onChange={(e) => setNewServicePrice(e.target.value)}
                          style={{ fontFamily: 'sans-serif', fontSize: '13px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                        />
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Discount ($)"
                          value={newServiceDiscount}
                          onChange={(e) => setNewServiceDiscount(e.target.value)}
                          style={{ fontFamily: 'sans-serif', fontSize: '13px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                        />
                        <select
                          value={newServiceDuration}
                          onChange={(e) => setNewServiceDuration(e.target.value)}
                          style={{ fontFamily: 'sans-serif', fontSize: '13px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
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
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {services.map((s) => (
                          <li key={s.id} style={{ background: '#090d16', border: '1px solid rgba(212,175,55,0.1)', borderRadius: '8px', padding: '12px 14px', fontSize: '13px' }}>
                            {editingServiceId === s.id ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <input
                                  type="text"
                                  value={editServiceName}
                                  onChange={(e) => setEditServiceName(e.target.value)}
                                  style={{ fontFamily: 'sans-serif', fontSize: '12px', padding: '8px', background: '#111625', border: '1px solid #d4af37', borderRadius: '6px', color: '#ffffff' }}
                                />
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px', gap: '8px' }}>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={editServicePrice}
                                    onChange={(e) => setEditServicePrice(e.target.value)}
                                    placeholder="Price"
                                    style={{ fontFamily: 'sans-serif', fontSize: '12px', padding: '8px', background: '#111625', border: '1px solid #d4af37', borderRadius: '6px', color: '#ffffff' }}
                                  />
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={editServiceDiscount}
                                    onChange={(e) => setEditServiceDiscount(e.target.value)}
                                    placeholder="Discount"
                                    style={{ fontFamily: 'sans-serif', fontSize: '12px', padding: '8px', background: '#111625', border: '1px solid #d4af37', borderRadius: '6px', color: '#ffffff' }}
                                  />
                                  <select
                                    value={editServiceDuration}
                                    onChange={(e) => setEditServiceDuration(e.target.value)}
                                    style={{ fontFamily: 'sans-serif', fontSize: '12px', padding: '8px', background: '#111625', border: '1px solid #d4af37', borderRadius: '6px', color: '#ffffff' }}
                                  >
                                    <option value="15">15m</option>
                                    <option value="30">30m</option>
                                    <option value="45">45m</option>
                                    <option value="60">60m</option>
                                    <option value="90">90m</option>
                                  </select>
                                </div>
                                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                                  <button onClick={() => handleUpdateService(s.id)} disabled={isSaving} style={{ flex: 1, background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', padding: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
                                    Save
                                  </button>
                                  <button onClick={() => setEditingServiceId(null)} style={{ flex: 1, background: '#475569', color: 'white', border: 'none', borderRadius: '4px', padding: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <span style={{ fontWeight: 600, color: '#ffffff' }}>{s.name}</span>
                                  <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '6px' }}>({s.duration} min)</span>
                                  {s.discount > 0 && (
                                    <span style={{ display: 'block', fontSize: '11px', color: '#ef4444', marginTop: '2px', fontWeight: 'bold' }}>
                                      🏷️ discount applied: -${(s.discount / 100).toFixed(2)}
                                    </span>
                                  )}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                  <div style={{ textAlign: 'right' }}>
                                    {s.discount > 0 ? (
                                      <>
                                        <s style={{ fontSize: '11px', color: '#64748b', marginRight: '6px' }}>${(s.price / 100).toFixed(2)}</s>
                                        <strong style={{ color: '#d4af37' }}>${((s.price - s.discount) / 100).toFixed(2)}</strong>
                                      </>
                                    ) : (
                                      <strong style={{ color: '#d4af37' }}>${(s.price / 100).toFixed(2)}</strong>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    <button onClick={() => handleStartEditService(s)} style={{ background: 'rgba(212,175,55,0.15)', color: '#d4af37', border: 'none', borderRadius: '4px', padding: '5px 8px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
                                      Edit
                                    </button>
                                    <button onClick={() => handleDeleteService(s.id)} style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: 'none', borderRadius: '4px', padding: '5px 8px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Right hand forms: Register Stylist AND Change Password Settings */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    
                    {/* Change Password settings form */}
                    <div style={{ background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '24px' }}>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>Update Password</h4>
                      <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: '#94a3b8' }}>Securely change your dashboard owner account credentials.</p>
                      
                      {passwordChangeError && (
                        <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '8px', fontWeight: 600 }}>⚠️ {passwordChangeError}</div>
                      )}
                      {passwordChangeSuccess && (
                        <div style={{ color: '#10b981', fontSize: '12px', marginBottom: '8px', fontWeight: 600 }}>✅ Password updated successfully!</div>
                      )}

                      <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <input
                          type="password"
                          required
                          placeholder="New password (min. 8 chars)"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          style={{ fontFamily: 'sans-serif', fontSize: '13px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                        />
                        <input
                          type="password"
                          required
                          placeholder="Confirm new password"
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          style={{ fontFamily: 'sans-serif', fontSize: '13px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                        />
                        <button type="submit" disabled={isChangingPassword} style={{ background: '#475569', color: 'white', border: 'none', borderRadius: '99px', padding: '11px', fontWeight: 800, cursor: 'pointer', fontSize: '13px' }}>
                          {isChangingPassword ? 'Updating...' : 'Update Password'}
                        </button>
                      </form>
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
                          style={{ fontFamily: 'sans-serif', fontSize: '13px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                        />
                        <input
                          type="email"
                          required
                          placeholder="Stylist Email"
                          value={newStaffEmail}
                          onChange={(e) => setNewStaffEmail(e.target.value)}
                          style={{ fontFamily: 'sans-serif', fontSize: '13px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
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

                    {/* Customizable Consent Form Builder Panel */}
                    <div style={{ background: '#111625', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '16px', padding: '24px' }}>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>Custom Consent Form Builder</h4>
                      <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: '#94a3b8' }}>Create bespoke medical intake questions, dropdown lists, and electronic signature pads.</p>
                      
                      <form onSubmit={handleSaveConsentForm} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label htmlFor="form-title" style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Form Title</label>
                          <input
                            id="form-title"
                            type="text"
                            required
                            placeholder="e.g. Laser Consultation Waiver"
                            value={consentFormTitle}
                            onChange={(e) => setConsentFormTitle(e.target.value)}
                            style={{ fontFamily: 'sans-serif', fontSize: '13px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
                          />
                        </div>

                        {/* Current fields preview list */}
                        <div style={{ marginTop: '8px' }}>
                          <h5 style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#ffffff', fontWeight: 800 }}>Active Form Fields Check</h5>
                          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {consentFormFields.length === 0 ? (
                              <li style={{ color: '#64748b', fontSize: '12px', fontStyle: 'italic' }}>No fields configured yet. Add fields below.</li>
                            ) : (
                              consentFormFields.map((field, idx) => (
                                <li key={idx} style={{ background: '#090d16', border: '1px solid rgba(212,175,55,0.1)', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div>
                                    <span style={{ fontWeight: 600, color: '#ffffff' }}>{field.label}</span>
                                    <span style={{ fontSize: '10px', background: '#1e293b', color: '#94a3b8', padding: '2px 6px', borderRadius: '4px', marginLeft: '6px', textTransform: 'uppercase' }}>
                                      {field.type}
                                    </span>
                                    {field.required && (
                                      <span style={{ color: '#ef4444', marginLeft: '6px', fontSize: '10px', fontWeight: 'bold' }}>REQUIRED</span>
                                    )}
                                    {field.options && field.options.length > 0 && (
                                      <div style={{ fontSize: '10px', color: '#d4af37', marginTop: '2px' }}>
                                        Options: {field.options.join(', ')}
                                      </div>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveField(idx)}
                                    style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '13px' }}
                                  >
                                    ✕
                                  </button>
                                </li>
                              ))
                            )}
                          </ul>
                        </div>

                        {/* Add Field Box */}
                        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <h5 style={{ margin: 0, fontSize: '12px', color: '#ffffff', fontWeight: 800 }}>Add New Input Field</h5>
                          <input
                            type="text"
                            placeholder="Field Label (e.g. Skin Tone Option)"
                            value={newFieldLabel}
                            onChange={(e) => setNewFieldLabel(e.target.value)}
                            style={{ fontFamily: 'sans-serif', fontSize: '12px', padding: '10px', background: '#090d16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#ffffff' }}
                          />
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '8px' }}>
                            <select
                              value={newFieldType}
                              onChange={(e) => setNewFieldType(e.target.value as any)}
                              style={{ fontFamily: 'sans-serif', fontSize: '12px', padding: '10px', background: '#090d16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#ffffff' }}
                            >
                              <option value="text">Single Line Text</option>
                              <option value="textarea">Multi-line Description</option>
                              <option value="checkbox">Single Agreement Checkbox</option>
                              <option value="select">Dropdown Options list</option>
                              <option value="radio">Radio Buttons select</option>
                              <option value="signature">Canvas Signature Pad</option>
                            </select>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#94a3b8', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={newFieldRequired}
                                onChange={(e) => setNewFieldRequired(e.target.checked)}
                              />
                              Required
                            </label>
                          </div>

                          {(newFieldType === 'select' || newFieldType === 'radio') && (
                            <input
                              type="text"
                              placeholder="Comma separated choices: e.g. Fair, Medium, Dark"
                              value={newFieldOptions}
                              onChange={(e) => setNewFieldOptions(e.target.value)}
                              style={{ fontFamily: 'sans-serif', fontSize: '12px', padding: '10px', background: '#090d16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#ffffff' }}
                            />
                          )}

                          <button
                            type="button"
                            onClick={handleAddField}
                            style={{ background: '#334155', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                          >
                            ➕ Insert Field into Schema
                          </button>
                        </div>

                        <button
                          type="submit"
                          disabled={isSaving}
                          style={{ background: '#d4af37', color: '#1e1400', border: 'none', borderRadius: '99px', padding: '12px', fontWeight: 800, cursor: 'pointer', fontSize: '13px', boxShadow: '0 4px 14px rgba(212, 175, 55, 0.25)' }}
                        >
                          {isSaving ? 'Saving form layout...' : 'Publish Consent Form'}
                        </button>
                      </form>
                    </div>

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
