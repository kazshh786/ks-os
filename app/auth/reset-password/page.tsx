'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';

export default function AuthResetPasswordPage() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  // Make sure they are actually authenticated by the recovery token
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Session expired or invalid reset link. Please request a new link.');
      }
    };
    checkSession();
  }, []);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    setError(null);

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      setIsProcessing(false);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      setIsProcessing(false);
      return;
    }

    try {
      // 1. Update password in Supabase Auth
      const { error: authErr } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (authErr) throw authErr;

      // 2. Fetch user profile to resolve tenant subdomain
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User session not found.');

      const { data: profile, error: dbErr } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (dbErr || !profile) {
        throw new Error('Profile details not found in database.');
      }

      // Clear the forced password change flag
      await supabase
        .from('users')
        .update({
          permissions: { requires_password_change: false }
        })
        .eq('id', user.id);

      const { data: tenant } = await supabase
        .from('tenants')
        .select('subdomain')
        .eq('id', profile.tenant_id)
        .single();

      setSuccess(true);
      
      // 3. Smart redirection back to tenant portal
      setTimeout(() => {
        if (tenant) {
          const isLocal = window.location.host.includes('localhost');
          const newUrl = isLocal 
            ? `http://${tenant.subdomain}.localhost:3000/` 
            : `https://${tenant.subdomain}.kasimshah.com/`;
          window.location.href = newUrl;
        } else {
          router.push('/admin/login');
        }
      }, 1500);

    } catch (err: any) {
      setError(err.message || 'Failed to reset password.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#090d16',
      fontFamily: 'sans-serif',
      padding: '16px',
      boxSizing: 'border-box'
    }}>
      <div style={{
        background: '#111625',
        border: '1px solid rgba(212, 175, 55, 0.15)',
        borderRadius: '16px',
        padding: '32px',
        width: '100%',
        maxWidth: '400px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <span style={{ fontSize: '40px' }}>🔑</span>
          <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#ffffff', margin: '12px 0 6px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Set New Password
          </h2>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>Provide a new secure password for your workspace account.</p>
        </div>

        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#ef4444', borderRadius: '8px', padding: '12px', fontSize: '12px', marginBottom: '16px', fontWeight: 600 }}>
            ⚠️ {error}
          </div>
        )}

        {success && (
          <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.25)', color: '#10b981', borderRadius: '8px', padding: '12px', fontSize: '12px', marginBottom: '16px', fontWeight: 600 }}>
            ✅ Password updated! Redirecting to your dashboard...
          </div>
        )}

        <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="new-pw" style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>New Password</label>
            <input
              id="new-pw"
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min. 8 characters"
              style={{ fontSize: '14px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="confirm-pw" style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Confirm Password</label>
            <input
              id="confirm-pw"
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              style={{ fontSize: '14px', padding: '12px', background: '#090d16', border: '1px solid rgba(212, 175, 55, 0.15)', borderRadius: '8px', color: '#ffffff', outline: 'none' }}
            />
          </div>
          <button
            type="submit"
            disabled={isProcessing || success}
            style={{ background: '#d4af37', color: '#1e1400', border: 'none', borderRadius: '99px', padding: '12px', fontWeight: 800, cursor: 'pointer', fontSize: '13px', marginTop: '8px', boxShadow: '0 4px 14px rgba(212, 175, 55, 0.25)' }}
          >
            {isProcessing ? 'Updating...' : 'Save & Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
