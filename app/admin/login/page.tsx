'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import styles from './login.module.css';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Auth state flags
  const [mustReset, setMustReset] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const router = useRouter();

  const AUTHORIZED_AGENCY_EMAIL = 'kasimashah@gmail.com';

  // Redirect to onboarding dashboard if already logged in as admin
  useEffect(() => {
    const checkActiveSession = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.email === AUTHORIZED_AGENCY_EMAIL) {
        // Double check if password reset is still required
        const { data: profile } = await supabase
          .from('users')
          .select('permissions')
          .eq('id', user.id)
          .single();

        if (profile?.permissions?.requires_password_change === true) {
          setUserId(user.id);
          setMustReset(true);
        } else {
          router.push('/admin/onboard');
        }
      }
    };
    checkActiveSession();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    setError(null);

    try {
      const { data, error: authErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authErr) throw authErr;

      const user = data.user;
      if (user && user.email === AUTHORIZED_AGENCY_EMAIL) {
        // Query the profile permissions block to check for force password reset
        const { data: profile, error: dbErr } = await supabase
          .from('users')
          .select('permissions')
          .eq('id', user.id)
          .single();

        if (dbErr) throw dbErr;

        if (profile?.permissions?.requires_password_change === true) {
          setUserId(user.id);
          setMustReset(true);
        } else {
          router.push('/admin/onboard');
        }
      } else {
        // Sign out if unauthorized account
        await supabase.auth.signOut();
        setError('Access Denied: This account is not authorized as the Agency Master Admin.');
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
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

    if (newPassword === 'Monopoly12') {
      setError('You cannot reuse the temporary password. Please create a new secure password.');
      setIsProcessing(false);
      return;
    }

    try {
      // 1. Update password inside Supabase Auth
      const { error: authErr } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (authErr) throw authErr;

      // 2. Remove force change flag in public.users permissions
      if (userId) {
        const { error: dbErr } = await supabase
          .from('users')
          .update({
            permissions: { admin: true } // Overwrite block to remove requires_password_change
          })
          .eq('id', userId);

        if (dbErr) throw dbErr;
      }

      // Successful password change - route to dashboard
      router.push('/admin/onboard');
    } catch (err: any) {
      setError(err.message || 'Failed to update secure password.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className={styles.pageWrapper}>
      <div className={styles.loginCard}>
        <div className={styles.logoBadge}>KS</div>

        {/* SCREEN 1: Force Password Reset Form */}
        {mustReset ? (
          <>
            <h2 className={styles.title}>Secure Your Account</h2>
            <p className={styles.subtitle}>You logged in with a temporary password. Create a secure password to activate your session.</p>

            {error && <div className={styles.errorMessage}>{error}</div>}

            <form onSubmit={handlePasswordReset} className={styles.form}>
              <div className={styles.inputGroup}>
                <label htmlFor="new-password" className={styles.label}>New Secure Password</label>
                <input
                  id="new-password"
                  type="password"
                  required
                  className={styles.input}
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>

              <div className={styles.inputGroup}>
                <label htmlFor="confirm-password" className={styles.label}>Confirm Password</label>
                <input
                  id="confirm-password"
                  type="password"
                  required
                  className={styles.input}
                  placeholder="Repeat new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className={styles.submitButton}
                disabled={isProcessing}
              >
                {isProcessing ? 'Updating Credentials...' : 'Save & Login to Dashboard'}
              </button>
            </form>
          </>
        ) : (
          /* SCREEN 2: Standard Login Form */
          <>
            <h2 className={styles.title}>Agency Administrator</h2>
            <p className={styles.subtitle}>Sign in to provision and manage salon workspaces.</p>

            {error && <div className={styles.errorMessage}>{error}</div>}

            <form onSubmit={handleLogin} className={styles.form}>
              <div className={styles.inputGroup}>
                <label htmlFor="email" className={styles.label}>Admin Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  className={styles.input}
                  placeholder="admin@ks-studio.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className={styles.inputGroup}>
                <label htmlFor="password" className={styles.label}>Password</label>
                <input
                  id="password"
                  type="password"
                  required
                  className={styles.input}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className={styles.submitButton}
                disabled={isProcessing}
              >
                {isProcessing ? 'Verifying Session...' : 'Authenticate Master Session'}
              </button>
            </form>
          </>
        )}

        <div className={styles.footerNote}>
          🔒 Secure Agency Provisioning Gateway
        </div>
      </div>
    </div>
  );
}
