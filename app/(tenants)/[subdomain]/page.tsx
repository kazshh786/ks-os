'use client';

import React, { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { supabase } from '@/utils/supabase/client';
import WeeklyCalendar from '@/components/calendar/WeeklyCalendar';
import TimeSlotPicker from '@/components/calendar/TimeSlotPicker';
import ClientTimeline from '@/components/crm/ClientTimeline';
import CheckoutDrawer from '@/components/pos/CheckoutDrawer';
import FormBuilder from '@/components/forms/FormBuilder';
import type { FormField } from '@/components/forms/FormRenderer';
import BookingScheduleManager from '@/components/booking/BookingScheduleManager';
import styles from './tenant.module.css';

// SVG Icon Library for Salon Tenant Dashboard
const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
    <line x1="16" y1="2" x2="16" y2="6"></line>
    <line x1="8" y1="2" x2="8" y2="6"></line>
    <line x1="3" y1="10" x2="21" y2="10"></line>
  </svg>
);

const GlobeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="2" y1="12" x2="22" y2="12"></line>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
  </svg>
);

const UsersIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
    <circle cx="9" cy="7" r="4"></circle>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
  </svg>
);

const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
);

const PlusCircleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="8" x2="12" y2="16"></line>
    <line x1="8" y1="12" x2="16" y2="12"></line>
  </svg>
);

const LogOutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
    <polyline points="16 17 21 12 16 7"></polyline>
    <line x1="21" y1="12" x2="9" y2="12"></line>
  </svg>
);

const HomeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M3 10.5 12 3l9 7.5"></path>
    <path d="M5 9.5V21h14V9.5"></path>
    <path d="M9 21v-7h6v7"></path>
  </svg>
);

const FormIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <path d="M14 2v6h6"></path>
    <path d="M8 13h8M8 17h6"></path>
  </svg>
);

interface StaffRevenue {
  staffName: string;
  revenue: number;
  bookings: number;
}

function normalizeFormFields(fields: FormField[]): FormField[] {
  return fields.map((field, index) => ({
    ...field,
    id: field.id || (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `field-${Date.now()}-${index}`),
  }));
}

export default function TenantDashboard({ params }: { params: Promise<{ subdomain: string }> }) {
  const resolvedParams = use(params);
  const subdomain = resolvedParams.subdomain;
  const router = useRouter();
  
  // Auth and Login States
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string>('owner');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isAgencyPreview, setIsAgencyPreview] = useState(false);
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
  const [consentFormFields, setConsentFormFields] = useState<FormField[]>([]);

  // Workspace settings tab and metadata
  const [activeTab, setActiveTab] = useState<'overview' | 'calendar' | 'booking' | 'crm' | 'forms' | 'manage'>('overview');
  const [tenantId, setTenantId] = useState<string>('00000000-0000-0000-0000-000000000000');
  const [tenantName, setTenantName] = useState<string>('');
  const [customDomain, setCustomDomain] = useState<string | null>(null);
  const [packageTier, setPackageTier] = useState<string>('Core');
  
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
        const previewRequested = typeof window !== 'undefined'
          && new URLSearchParams(window.location.search).get('agencyPreview') === '1'
          && user.email === 'kasimashah@gmail.com';
        setIsAgencyPreview(previewRequested);

        // Fetch current tenant configuration to match
        const { data: tenant, error: tErr } = await supabase
          .from('tenants')
          .select('*')
          .eq('subdomain', subdomain.toLowerCase())
          .single();

        if (tErr || !tenant) {
          setCurrentUser(null);
          return;
        }

        if (previewRequested) {
          setCurrentUser(user);
          setTenantId(tenant.id);
          setTenantName(tenant.name);
          setCustomDomain(tenant.custom_domain);
          setPackageTier(tenant.package_tier || 'Core');
          return;
        }

        // Validate user is owner of this tenant
        const { data: profile, error: pErr } = await supabase
          .from('users')
          .select('id, role, tenant_id, permissions')
          .eq('id', user.id)
          .single();

        if (pErr || !profile || !['owner', 'staff'].includes(profile.role) || profile.tenant_id !== tenant.id) {
          await supabase.auth.signOut();
          setCurrentUser(null);
        } else {
          setCurrentUser(user);
          setUserRole(profile.role);
          setTenantId(tenant.id);
          setTenantName(tenant.name);
          setCustomDomain(tenant.custom_domain);
          setPackageTier(tenant.package_tier || 'Core');
          if (profile.permissions?.requires_password_change === true) {
            setMustChangePassword(true);
          }
        }
      } else {
        setCurrentUser(null);
        setIsAgencyPreview(false);
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

      const activeSvcList = svcData || [];
      const activeStaffList = staffData || [];
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
        setConsentFormFields(normalizeFormFields(formTemplate.fields_json || []));
      } else {
        // Seed default template fields in state
        setConsentFormFields(normalizeFormFields([
          { label: 'Do you have any allergies or medical considerations?', type: 'textarea', required: false, placeholder: 'Add anything your provider should know' },
          { label: 'I confirm the information provided is accurate', type: 'checkbox', required: true },
          { label: 'Customer signature', type: 'signature', required: true },
        ]));
      }

    } catch (err) {
      console.error('Failed to load workspace parameters:', err);
      setServices([]);
      setStaff([]);
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
  const handleSaveConsentForm = async () => {
    if (tenantId === '00000000-0000-0000-0000-000000000000') {
      alert('The workspace is not ready yet. Refresh the page and try again.');
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
      alert('Your intake form has been published successfully.');
    } catch (err: any) {
      alert(err.message || 'Failed to publish the intake form.');
    } finally {
      setIsSaving(false);
    }
  };

  // Login handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoggingIn(true);

    try {
      const { data: tenant, error: tErr } = await supabase
        .from('tenants')
        .select('*')
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

      if (!['owner', 'staff'].includes(profile.role) || profile.tenant_id !== tenant.id) {
        await supabase.auth.signOut();
        throw new Error('Access denied: You do not have access to this workspace.');
      }

      setUserRole(profile.role);
      setTenantId(tenant.id);
      setTenantName(tenant.name);
      setCustomDomain(tenant.custom_domain);
      setPackageTier(tenant.package_tier || 'Core');
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
    if (isAgencyPreview) {
      router.push('/admin');
      return;
    }
    await supabase.auth.signOut();
    setCurrentUser(null);
    setMustChangePassword(false);
    setTenantId('00000000-0000-0000-0000-000000000000');
    setActiveTab('overview');
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
      alert('The workspace is not ready yet. Refresh the page and try again.');
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
      alert('The workspace is not ready yet. Refresh the page and try again.');
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
      await supabase.rpc('replace_staff_booking_channel_schedule',{
        p_tenant_id:tenantId,p_staff_id:newUserId,p_booking_channel:'in_shop',
        p_hours:[0,1,2,3,4,5,6].map(dayOfWeek=>({dayOfWeek,enabled:days.includes(dayOfWeek),startTime:'09:00',endTime:'17:00'})),
      });

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

  const isLocalWorkspace = typeof window !== 'undefined' && window.location.host.includes('localhost');
  const publicWorkspaceOrigin = customDomain
    ? `https://${customDomain}`
    : isLocalWorkspace
      ? `http://${subdomain}.localhost:3000`
      : `https://${subdomain}.kasimshah.com`;
  const bookingPageUrl = `${publicWorkspaceOrigin}/book`;
  const iframeEmbedCode = `<iframe src="${bookingPageUrl}" title="${tenantName || 'Customer'} booking page" width="100%" height="700" style="border:0; border-radius:12px;"></iframe>`;

  // UI GATE A: Checking session loading state
  if (checkingAuth) {
    return (
      <div className={styles.loadingScreen}>
        Resolving owner credentials and workspace settings...
      </div>
    );
  }

  // UI GATE B: Login Screen
  if (!currentUser) {
    return (
      <div className={styles.authPageWrapper}>
        <div className={styles.authCard}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <span className={styles.authIcon}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--md-sys-color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto' }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </span>
            <h2>{subdomain.toUpperCase()} Workspace</h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>Sign in to access your administrative control panel.</p>
          </div>

          {authError && (
            <div className={styles.authError}>
              ⚠️ {authError}
            </div>
          )}

          {showForgot ? (
            <form onSubmit={handleForgotPassword} className={styles.authForm}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label htmlFor="forgotEmail" className={styles.authLabel}>Email Address</label>
                <input
                  id="forgotEmail"
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="owner@yourstudio.com"
                  className={styles.authInput}
                />
              </div>
              <button
                type="submit"
                disabled={isLoggingIn}
                className={styles.authBtn}
              >
                {isLoggingIn ? 'Sending link...' : 'Send Recovery Email'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForgot(false);
                  setAuthError(null);
                }}
                className={styles.forgotBtn}
                style={{ marginTop: '8px' }}
              >
                ← Back to Sign In
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className={styles.authForm}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label htmlFor="loginEmail" className={styles.authLabel}>Email Address</label>
                <input
                  id="loginEmail"
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="owner@yourstudio.com"
                  className={styles.authInput}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="loginPassword" className={styles.authLabel}>Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgot(true);
                      setAuthError(null);
                    }}
                    className={styles.forgotBtn}
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
                  className={styles.authInput}
                />
              </div>
              <button
                type="submit"
                disabled={isLoggingIn}
                className={styles.authBtn}
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
      <div className={styles.authPageWrapper}>
        <div className={styles.authCard}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <span className={styles.authIcon}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--md-sys-color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto' }}>
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
              </svg>
            </span>
            <h2>Set New Password</h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>For security, please change the temporary password provided by your agency admin.</p>
          </div>

          {passwordChangeError && (
            <div className={styles.authError}>
              ⚠️ {passwordChangeError}
            </div>
          )}

          <form onSubmit={handleChangePassword} className={styles.authForm}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="newPassword" className={styles.authLabel}>New Password</label>
              <input
                id="newPassword"
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className={styles.authInput}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="confirmNewPassword" className={styles.authLabel}>Confirm Password</label>
              <input
                id="confirmNewPassword"
                type="password"
                required
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Confirm password"
                className={styles.authInput}
              />
            </div>
            <button
              type="submit"
              disabled={isChangingPassword}
              className={styles.authBtn}
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
    <div className={`${styles.dashboardContainer} ${isAgencyPreview ? styles.previewMode : ''}`}>
      {isAgencyPreview && (
        <div className={styles.impersonationBanner} role="status">
          <div>
            <span className={styles.impersonationIcon} aria-hidden="true">↳</span>
            <span>You are viewing <strong>{tenantName}</strong> as agency admin. Changes affect this client workspace.</span>
          </div>
          <button type="button" onClick={() => router.push('/admin')}>Exit client view</button>
        </div>
      )}
      <header className={styles.header}>
        <div className={styles.headerLogo}>
          <svg className={styles.logoIcon} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          <h1>
            {tenantName || subdomain} Workspace
          </h1>
          <span className={styles.ownerBadge}>
            {packageTier} plan
          </span>
        </div>
        
        <div className={styles.headerActions}>
          <span className={styles.navSectionLabel}>Workspace</span>
          <button
            onClick={() => setActiveTab('overview')}
            className={`${styles.sidebarBtn} ${activeTab === 'overview' ? styles.sidebarBtnActive : ''}`}
          >
            <HomeIcon />
            Overview
          </button>
          <button
            onClick={() => { window.location.href = '/book-manual'; }}
            className={styles.specialBtn}
          >
            <PlusCircleIcon />
            Manual Booking Desk
          </button>
          <button
            onClick={() => setActiveTab('calendar')}
            className={`${styles.sidebarBtn} ${activeTab === 'calendar' ? styles.sidebarBtnActive : ''}`}
          >
            <CalendarIcon />
            Calendar
          </button>
          <button
            onClick={() => setActiveTab('booking')}
            className={`${styles.sidebarBtn} ${activeTab === 'booking' ? styles.sidebarBtnActive : ''}`}
          >
            <GlobeIcon />
            Booking page
          </button>
          <button
            onClick={() => setActiveTab('crm')}
            className={`${styles.sidebarBtn} ${activeTab === 'crm' ? styles.sidebarBtnActive : ''}`}
          >
            <UsersIcon />
            Customers
          </button>
          {userRole === 'owner' && (
            <>
              <button
                onClick={() => setActiveTab('forms')}
                className={`${styles.sidebarBtn} ${activeTab === 'forms' ? styles.sidebarBtnActive : ''}`}
              >
                <FormIcon />
                Intake forms
              </button>
              <button
                onClick={() => setActiveTab('manage')}
                className={`${styles.sidebarBtn} ${activeTab === 'manage' ? styles.sidebarBtnActive : ''}`}
              >
                <SettingsIcon />
                Settings & analytics
              </button>
            </>
          )}
          
          <button
            onClick={handleLogout}
            className={styles.logoutBtn}
          >
            <LogOutIcon />
            {isAgencyPreview ? 'Exit client view' : 'Sign out'}
          </button>
        </div>
      </header>

      <main className={styles.main}>
        {loading ? (
          <div className={styles.loadingScreen}>Loading workspace analytics and configurations...</div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <div className={styles.overviewPage}>
            {/* STUDIO QUICK ACCESS DOCK (ONE-STOP SHOP) */}
            <div className={styles.quickAccessPanel}>
              <div className={styles.quickAccessText}>
                <h3>
                  ⚡ Studio Quick Access Control
                </h3>
                <p>
                  Manage external links, contact support, and share your web booking address.
                </p>
              </div>

              <div className={styles.quickAccessActions}>
                <a
                  href={`mailto:${currentUser?.email}?subject=KS%20OS%20Mailbox`}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.pillLinkOutlined}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                    <polyline points="22,6 12,13 2,6"></polyline>
                  </svg>
                  Access Webmail
                </a>
                <a
                  href={bookingPageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.pillLinkFilled}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                  </svg>
                  Visit Booking Site
                </a>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(bookingPageUrl);
                    alert('Public Booking Web Address copied to clipboard!');
                  }}
                  className={styles.actionBtnSuccess}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  Copy Web Address
                </button>
              </div>
            </div>
                <div className={styles.pageHeading}>
                  <div>
                    <span className={styles.pageEyebrow}>Workspace overview</span>
                    <h2>Good to see you, {tenantName || 'there'}.</h2>
                    <p>Monitor the essentials, open a tool, or continue setting up your customer journey.</p>
                  </div>
                  <button type="button" className={styles.primaryAction} onClick={() => setActiveTab('calendar')}>
                    View calendar
                  </button>
                </div>

                <div className={styles.overviewMetrics}>
                  {userRole === 'owner' && (
                    <>
                      <article className={styles.overviewMetric}>
                        <span>Revenue</span>
                        <strong>£{(totalSales / 100).toFixed(2)}</strong>
                        <small>Recorded checkout revenue</small>
                      </article>
                      <article className={styles.overviewMetric}>
                        <span>Completed sales</span>
                        <strong>{salesCount}</strong>
                        <small>All recorded transactions</small>
                      </article>
                      <article className={styles.overviewMetric}>
                        <span>Booking conversion</span>
                        <strong>{conversionRate}%</strong>
                        <small>Completed appointments</small>
                      </article>
                    </>
                  )}
                  <article className={styles.overviewMetric}>
                    <span>Active tools</span>
                    <strong>{userRole === 'owner' ? '5' : '3'}</strong>
                    <small>Included in your {packageTier} plan</small>
                  </article>
                </div>

                <section className={styles.modulesSection} aria-labelledby="workspace-tools-title">
                  <div className={styles.sectionTitleRow}>
                    <div>
                      <h3 id="workspace-tools-title">Your tools</h3>
                      <p>Everything available in this workspace, with clear live and roadmap states.</p>
                    </div>
                    <span className={styles.planPill}>{packageTier} plan</span>
                  </div>

                  <div className={styles.moduleGrid}>
                    <article className={styles.moduleCard}>
                      <div className={styles.moduleCardTop}><span className={styles.moduleIcon}>W</span><span className={styles.liveStatus}><i /> Live</span></div>
                      <h4>Website</h4>
                      <p>Open your live site and customer-facing pages.</p>
                      <a href={publicWorkspaceOrigin} target="_blank" rel="noreferrer">Open website <span>↗</span></a>
                    </article>
                    <article className={styles.moduleCard}>
                      <div className={styles.moduleCardTop}><span className={styles.moduleIcon}>B</span><span className={styles.liveStatus}><i /> Live</span></div>
                      <h4>Bookings</h4>
                      <p>Manage availability and test your booking journey.</p>
                      <button type="button" onClick={() => setActiveTab('booking')}>Open bookings <span>→</span></button>
                    </article>
                    <article className={styles.moduleCard}>
                      <div className={styles.moduleCardTop}><span className={styles.moduleIcon}>C</span><span className={styles.liveStatus}><i /> Live</span></div>
                      <h4>Customers</h4>
                      <p>Review customer profiles, history and loyalty activity.</p>
                      <button type="button" onClick={() => setActiveTab('crm')}>Open customers <span>→</span></button>
                    </article>
                    {userRole === 'owner' && (
                      <article className={styles.moduleCard}>
                        <div className={styles.moduleCardTop}><span className={styles.moduleIcon}>F</span><span className={styles.liveStatus}><i /> Live</span></div>
                        <h4>Intake forms</h4>
                        <p>Create consent and consultation forms with a live preview.</p>
                        <button type="button" onClick={() => setActiveTab('forms')}>Build a form <span>→</span></button>
                      </article>
                    )}
                    <article className={`${styles.moduleCard} ${styles.moduleCardMuted}`} aria-disabled="true">
                      <div className={styles.moduleCardTop}><span className={styles.moduleIcon}>E</span><span className={styles.comingSoonStatus}>Coming soon</span></div>
                      <h4>Email marketing</h4>
                      <p>Campaigns, customer segments and automated follow-ups.</p>
                      <span className={styles.unavailableText}>Not available yet</span>
                    </article>
                    <article className={`${styles.moduleCard} ${styles.moduleCardMuted}`} aria-disabled="true">
                      <div className={styles.moduleCardTop}><span className={styles.moduleIcon}>S</span><span className={styles.comingSoonStatus}>Coming soon</span></div>
                      <h4>Social marketing</h4>
                      <p>Plan content, publish posts and manage conversations.</p>
                      <span className={styles.unavailableText}>Not available yet</span>
                    </article>
                  </div>
                </section>

                <aside className={styles.setupPanel}>
                  <div>
                    <span className={styles.setupIcon} aria-hidden="true">✓</span>
                    <div>
                      <strong>Keep your workspace ready for customers</strong>
                      <p>{services.length} services and {staff.length} team members are currently configured.</p>
                    </div>
                  </div>
                  {userRole === 'owner' && <button type="button" onClick={() => setActiveTab('manage')}>Review settings</button>}
                </aside>
              </div>
            )}
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
                <div className={styles.posRibbon}>
                  <div className={styles.posText}>
                    <h4>POS Checkout Terminal</h4>
                    <p>Checkout completed bookings, calculate loyalty rewards, and record checkout sales totals.</p>
                  </div>
                  <button
                    onClick={() => {
                      setCheckoutApptId('88888888-8888-8888-8888-888888888888');
                      setIsCheckoutOpen(true);
                    }}
                    className={styles.posLaunchBtn}
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

            {activeTab === 'forms' && (
              <FormBuilder
                title={consentFormTitle}
                fields={consentFormFields}
                onTitleChange={setConsentFormTitle}
                onFieldsChange={setConsentFormFields}
                onSave={handleSaveConsentForm}
                isSaving={isSaving}
                isPublished={Boolean(consentFormId)}
              />
            )}

            {activeTab === 'manage' && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '28px' }}>
                <BookingScheduleManager tenantId={tenantId} staff={staff}/>
                
                {/* Section A: Revenue Metrics for this salon */}
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
                      <p>Total Revenue Made</p>
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
                      <h3>{conversionRate}%</h3>
                      <p>Booked-to-Sold Conversion</p>
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
                      <p>Completed Transactions</p>
                    </div>
                  </div>
                </div>

                {/* Section B: Staff Revenue Breakdown Table */}
                <div className={styles.performanceBox}>
                  <h4>Stylist Performance Breakdown</h4>
                  <p>Total bookings completed and revenue contribution generated by each provider.</p>
                  
                  <table className={styles.perfTable}>
                    <thead>
                      <tr>
                        <th>Provider</th>
                        <th>Bookings</th>
                        <th style={{ textAlign: 'right' }}>Revenue Generated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffRevenues.length === 0 ? (
                        <tr>
                          <td colSpan={3} className={styles.tableEmpty}>No completed payments recorded.</td>
                        </tr>
                      ) : (
                        staffRevenues.map((s) => (
                          <tr key={s.staffName}>
                            <td><strong>{s.staffName}</strong></td>
                            <td>{s.bookings}</td>
                            <td style={{ fontWeight: 700, textAlign: 'right', color: 'var(--md-sys-color-primary)' }}>
                              £{(s.revenue / 100).toFixed(2)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Section C: Services catalog and staff registry forms */}
                <div className={styles.gridSplit}>
                  
                  {/* Local services catalog creator */}
                  <div className={styles.formBox}>
                    <h4>Add Studio Service</h4>
                    <p>Publish new treatments and custom price/discount structures instantly.</p>
                    
                    <form onSubmit={handleAddService} className={styles.formGroup}>
                      <input
                        type="text"
                        required
                        placeholder="Service Name (e.g. Skin Fade & Wash)"
                        value={newServiceName}
                        onChange={(e) => setNewServiceName(e.target.value)}
                        className={styles.formInput}
                      />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: '10px' }}>
                        <input
                          type="number"
                          required
                          step="0.01"
                          placeholder="Price (£)"
                          value={newServicePrice}
                          onChange={(e) => setNewServicePrice(e.target.value)}
                          className={styles.formInput}
                        />
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Discount (£)"
                          value={newServiceDiscount}
                          onChange={(e) => setNewServiceDiscount(e.target.value)}
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
                        </select>
                      </div>
                      <button type="submit" disabled={isSaving} className={styles.submitBtn}>
                        {isSaving ? 'Publishing...' : 'Add Service'}
                      </button>
                    </form>

                    <div className={styles.catalogBox}>
                      <h5>Published Catalog</h5>
                      <ul className={styles.catalogList}>
                        {services.map((s) => (
                          <li key={s.id} className={styles.catalogItem}>
                            {editingServiceId === s.id ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <input
                                  type="text"
                                  value={editServiceName}
                                  onChange={(e) => setEditServiceName(e.target.value)}
                                  className={styles.formInput}
                                />
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px', gap: '8px' }}>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={editServicePrice}
                                    onChange={(e) => setEditServicePrice(e.target.value)}
                                    placeholder="Price"
                                    className={styles.formInput}
                                  />
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={editServiceDiscount}
                                    onChange={(e) => setEditServiceDiscount(e.target.value)}
                                    placeholder="Discount"
                                    className={styles.formInput}
                                  />
                                  <select
                                    value={editServiceDuration}
                                    onChange={(e) => setEditServiceDuration(e.target.value)}
                                    className={styles.formSelect}
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
                                      Discount applied: −£{(s.discount / 100).toFixed(2)}
                                    </span>
                                  )}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                  <div style={{ textAlign: 'right' }}>
                                    {s.discount > 0 ? (
                                      <>
                                        <s style={{ fontSize: '11px', color: '#64748b', marginRight: '6px' }}>£{(s.price / 100).toFixed(2)}</s>
                                        <strong style={{ color: 'var(--md-sys-color-primary)' }}>£{((s.price - s.discount) / 100).toFixed(2)}</strong>
                                      </>
                                    ) : (
                                      <strong style={{ color: 'var(--md-sys-color-primary)' }}>£{(s.price / 100).toFixed(2)}</strong>
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
                    <div className={styles.formBox}>
                      <h4>Update Password</h4>
                      <p>Securely change your dashboard owner account credentials.</p>
                      
                      {passwordChangeError && (
                        <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '8px', fontWeight: 600 }}>⚠️ {passwordChangeError}</div>
                      )}
                      {passwordChangeSuccess && (
                        <div style={{ color: '#10b981', fontSize: '12px', marginBottom: '8px', fontWeight: 600 }}>✅ Password updated successfully!</div>
                      )}

                      <form onSubmit={handleChangePassword} className={styles.formGroup}>
                        <input
                          type="password"
                          required
                          placeholder="New password (min. 8 chars)"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className={styles.formInput}
                        />
                        <input
                          type="password"
                          required
                          placeholder="Confirm new password"
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          className={styles.formInput}
                        />
                        <button type="submit" disabled={isChangingPassword} className={styles.submitBtn} style={{ background: '#475569', color: 'white' }}>
                          {isChangingPassword ? 'Updating...' : 'Update Password'}
                        </button>
                      </form>
                    </div>

                    {/* Local staff registry creator */}
                    <div className={styles.formBox}>
                      <h4>Register Stylist</h4>
                      <p>Register team members and allocate default work hour blocks.</p>
                      
                      <form onSubmit={handleAddStaff} className={styles.formGroup}>
                        <input
                          type="text"
                          required
                          placeholder="Stylist Name"
                          value={newStaffName}
                          onChange={(e) => setNewStaffName(e.target.value)}
                          className={styles.formInput}
                        />
                        <input
                          type="email"
                          required
                          placeholder="Stylist Email"
                          value={newStaffEmail}
                          onChange={(e) => setNewStaffEmail(e.target.value)}
                          className={styles.formInput}
                        />
                        <button type="submit" disabled={isSaving} className={styles.submitBtn}>
                          {isSaving ? 'Registering...' : 'Register Stylist'}
                        </button>
                      </form>

                      <div className={styles.catalogBox}>
                        <h5>Active Team Directory</h5>
                        <ul className={styles.catalogList}>
                          {staff.map((st) => (
                            <li key={st.id} className={styles.catalogItem} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <strong style={{ color: '#ffffff' }}>{st.name}</strong>
                              <span style={{ fontSize: '11px', color: '#94a3b8' }}>{st.email}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                  </div>

                </div>

                {/* Section D: Website Widget Embed Iframe snippet */}
                <div className={styles.formBox} style={{ marginTop: '24px' }}>
                  <h4>Integrate Booking Page into Your Website</h4>
                  <p>Showcase real-time slot availability on your own custom site using this copyable iframe embed code.</p>
                  
                  <textarea
                    readOnly
                    value={iframeEmbedCode}
                    onClick={(e) => {
                      (e.target as HTMLTextAreaElement).select();
                      navigator.clipboard.writeText(iframeEmbedCode);
                      alert('Widget embed code copied to clipboard!');
                    }}
                    className={styles.formTextarea}
                    style={{
                      fontFamily: 'monospace',
                      color: 'var(--md-sys-color-primary)',
                      resize: 'none',
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
