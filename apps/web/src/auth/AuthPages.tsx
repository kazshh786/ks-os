import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import type { ApplicationContext } from '@ks-os/contracts';
import { fetchWithAuth } from '../api/client';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

const loginFor = (context: ApplicationContext) => context === 'AGENCY' ? '/agency/login' : context === 'CUSTOMER' ? '/customer/login' : '/login';
const homeFor = (context: ApplicationContext) => context === 'AGENCY' ? '/agency' : context === 'CUSTOMER' ? '/customer' : '/app';
const resetFor = (context: ApplicationContext) => context === 'AGENCY' ? '/agency/reset-password' : '/reset-password';

function AuthShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <main className="min-h-screen bg-slate-950 px-5 py-12 text-white grid place-items-center">
    <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-7 shadow-2xl">
      <div className="mb-6"><div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-indigo-600 font-black">KS</div><h1 className="text-2xl font-black">{title}</h1><p className="mt-2 text-sm leading-6 text-slate-400">{description}</p></div>
      {children}
    </section>
  </main>;
}

export function AuthCallbackPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const parsed = ['AGENCY','TENANT','CUSTOMER'].includes(search.get('context') || '') ? search.get('context') as ApplicationContext : 'TENANT';
      const code = search.get('code');
      let current = await supabase.auth.getSession();
      if (!current.data.session && code) {
        const exchanged = await supabase.auth.exchangeCodeForSession(code);
        if (exchanged.error) throw new Error('This secure link has expired or has already been used.');
        current = await supabase.auth.getSession();
      }
      if (!current.data.session) throw new Error('This secure link is unavailable. Request a new one and try again.');
      if (search.get('recovery') === '1') { navigate(resetFor(parsed), { replace: true }); return; }
      const invitation = search.get('invitation');
      if (invitation) {
        navigate(`${parsed === 'AGENCY' ? '/agency/accept-invite' : '/accept-invite'}?invitation=${encodeURIComponent(invitation)}`, { replace: true });
        return;
      }
      const response = await fetchWithAuth('/api/v1/auth/context', { authContext: parsed });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.data?.next === 'NO_ACCESS') { navigate(`/access-denied?context=${parsed.toLowerCase()}`, { replace: true }); return; }
      if (body.data.next === 'SELECT_WORKSPACE') { navigate('/select-business', { replace: true }); return; }
      if (parsed === 'AGENCY' && ['MFA_ENROL','MFA_CHALLENGE'].includes(body.data.next)) {
        const factors = await supabase.auth.mfa.listFactors();
        const verified = factors.data?.totp?.some(factor => factor.status === 'verified');
        navigate(verified ? '/agency/mfa/challenge' : '/agency/mfa/enrol', { replace: true }); return;
      }
      navigate(homeFor(parsed), { replace: true });
    })().catch(cause => setError(cause instanceof Error ? cause.message : 'The secure link could not be verified.'));
  }, [navigate, search]);
  return <AuthShell title={error ? 'Link unavailable' : 'Verifying secure link'} description={error || 'Please wait while we securely complete your request.'}>
    {error ? <Link className="block rounded-xl bg-indigo-600 px-4 py-3 text-center text-sm font-bold" to="/login">Return to sign in</Link> : <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slate-700 border-t-indigo-400" />}
  </AuthShell>;
}

export function PasswordRecoveryPage({ context, mode }: { context: ApplicationContext; mode: 'request' | 'reset' }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      if (mode === 'request') {
        await fetch('/api/v1/auth/password-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, context }) });
        setMessage('If this address is eligible, a password reset email will arrive shortly.');
      } else {
        if (password.length < 10) throw new Error('Use at least 10 characters for your new password.');
        if (password !== confirm) throw new Error('The passwords do not match.');
        const updated = await supabase.auth.updateUser({ password });
        if (updated.error) throw new Error('Your password could not be updated. Request a new reset link and try again.');
        await fetchWithAuth('/api/v1/auth/logout-all', { method: 'POST', authContext: context }).catch(() => undefined);
        await supabase.auth.signOut({ scope: 'global' });
        navigate(`${loginFor(context)}?passwordUpdated=1`, { replace: true });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The request could not be completed.'); }
    finally { setBusy(false); }
  };
  return <AuthShell title={mode === 'request' ? 'Reset your password' : 'Choose a new password'} description={mode === 'request' ? 'Enter your sign-in address. We will send instructions if the account is eligible.' : 'After the update, all existing sessions will be signed out for your security.'}>
    <form onSubmit={submit} className="space-y-4">
      {error && <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-200">{error}</p>}
      {message && <p role="status" className="rounded-xl border border-emerald-800 bg-emerald-950/50 p-3 text-sm text-emerald-200">{message}</p>}
      {mode === 'request' ? <label className="block text-sm text-slate-300">Email address<input autoComplete="email" type="email" required value={email} onChange={event => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3" /></label> : <>
        <label className="block text-sm text-slate-300">New password<input autoComplete="new-password" type="password" minLength={10} required value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3" /></label>
        <label className="block text-sm text-slate-300">Confirm new password<input autoComplete="new-password" type="password" minLength={10} required value={confirm} onChange={event => setConfirm(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3" /></label>
      </>}
      <button disabled={busy} className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black disabled:opacity-50">{busy ? 'Working…' : mode === 'request' ? 'Send reset instructions' : 'Update password'}</button>
      <Link className="block text-center text-sm font-bold text-indigo-300" to={loginFor(context)}>Back to sign in</Link>
    </form>
  </AuthShell>;
}

export function InvitationAcceptancePage({ context }: { context: 'AGENCY' | 'TENANT' }) {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const invitation = search.get('invitation');
  useEffect(() => {
    if (!invitation) return;
    void supabase.auth.getSession().then(async ({ data }) => {
      setSignedIn(!!data.session);
      if (!data.session) return;
      const path = context === 'AGENCY' ? `/api/v1/agency/invitations/${invitation}` : `/api/v1/workspace/invitations/${invitation}`;
      const response = await fetchWithAuth(path, { authContext: context });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || 'This invitation is unavailable.');
      setRequiresPassword(body.data.requiresPasswordSetup);
    }).catch(cause => setError(cause instanceof Error ? cause.message : 'This invitation is unavailable.'));
  }, [context, invitation]);
  const accept = async () => {
    if (!invitation) return;
    setBusy(true); setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { navigate(`${loginFor(context)}?returnTo=${encodeURIComponent(location.pathname + location.search)}`); return; }
      if (requiresPassword) {
        if (password.length < 10) throw new Error('Use at least 10 characters for your password.');
        if (password !== confirm) throw new Error('The passwords do not match.');
        const updated = await supabase.auth.updateUser({ password });
        if (updated.error) throw new Error('Your password could not be saved. Request a new invitation and try again.');
      }
      const path = context === 'AGENCY' ? `/api/v1/agency/invitations/${invitation}/accept` : `/api/v1/workspace/invitations/${invitation}/accept`;
      const response = await fetchWithAuth(path, { method: 'POST', authContext: context });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || 'This invitation cannot be accepted.');
      if (context === 'AGENCY') {
        const factors = await supabase.auth.mfa.listFactors();
        navigate(factors.data?.totp?.some(factor => factor.status === 'verified') ? '/agency/mfa/challenge' : '/agency/mfa/enrol', { replace: true });
      } else navigate('/app', { replace: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'This invitation cannot be accepted.'); }
    finally { setBusy(false); }
  };
  if (!invitation) return <Navigate to={`/access-denied?context=${context.toLowerCase()}`} replace />;
  return <AuthShell title="Review your invitation" description={`Continue to activate access to ${context === 'AGENCY' ? 'the agency control plane' : 'this business workspace'}.`}>
    {error && <p role="alert" className="mb-4 rounded-xl border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-200">{error}</p>}
    {requiresPassword && <div className="mb-4 space-y-3"><label className="block text-sm text-slate-300">Create a password<input autoComplete="new-password" type="password" minLength={10} required value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3" /></label><label className="block text-sm text-slate-300">Confirm password<input autoComplete="new-password" type="password" minLength={10} required value={confirm} onChange={event => setConfirm(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3" /></label></div>}
    <button onClick={accept} disabled={busy} className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black disabled:opacity-50">{busy ? 'Checking invitation…' : signedIn ? 'Accept invitation' : 'Sign in to continue'}</button>
  </AuthShell>;
}

export function SelectBusinessPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (auth.isLoading) return <AuthShell title="Loading your businesses" description="Checking the workspaces available to you."><div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slate-700 border-t-indigo-400" /></AuthShell>;
  if (!auth.memberships.length) return <Navigate to="/access-denied?context=tenant" replace />;
  return <AuthShell title="Choose a business" description="Your account has access to more than one workspace. You can switch again from security settings.">
    {error && <p role="alert" className="mb-4 text-sm text-rose-300">{error}</p>}
    <div className="space-y-3">{auth.memberships.map(membership => <button key={membership.businessReference} disabled={!!busy} onClick={async () => { setBusy(membership.businessReference); try { await auth.selectWorkspace(membership.businessReference); navigate('/app', { replace: true }); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Business unavailable.'); } finally { setBusy(null); } }} className="w-full rounded-2xl border border-slate-700 bg-slate-950 p-4 text-left hover:border-indigo-500 disabled:opacity-50"><strong className="block">{membership.businessName}</strong><span className="text-xs text-slate-400">{membership.role === 'owner' ? 'Owner' : 'Team member'} · {membership.businessSlug}</span></button>)}</div>
  </AuthShell>;
}

export function SecuritySettingsPage({ context }: { context: 'AGENCY' | 'TENANT' }) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    const response = await fetchWithAuth('/api/v1/auth/sessions', { authContext: context });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || 'Sessions could not be loaded.');
    setSessions(body.data);
  };
  useEffect(() => { void load().catch(cause => setError(cause.message)); }, [context]);
  const revoke = async (sessionReference: string, current: boolean) => {
    const response = await fetchWithAuth(`/api/v1/auth/sessions/${sessionReference}/revoke`, { method: 'POST', authContext: context });
    if (!response.ok) { setError('That session could not be ended.'); return; }
    if (current) { await supabase.auth.signOut({ scope: 'local' }); navigate(loginFor(context), { replace: true }); }
    else await load();
  };
  const all = async () => {
    await fetchWithAuth('/api/v1/auth/logout-all', { method: 'POST', authContext: context });
    await supabase.auth.signOut({ scope: 'global' });
    navigate(loginFor(context), { replace: true });
  };
  return <div className="mx-auto max-w-3xl space-y-5 p-6"><div><h1 className="text-2xl font-black">Security</h1><p className="mt-1 text-sm text-slate-500">Review and end application sessions. Access changes take effect immediately in KS OS.</p></div>{error && <p role="alert" className="rounded-xl bg-rose-100 p-3 text-sm text-rose-800">{error}</p>}<div className="space-y-3">{sessions.map(session => <div key={session.sessionReference} className="flex flex-col gap-3 rounded-2xl border bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><div><strong>{session.current ? 'This device' : 'Signed-in device'}</strong><p className="text-xs text-slate-500">Last active {new Date(session.lastSeenAt).toLocaleString()} · {session.device || 'Device details unavailable'}</p></div><button onClick={() => revoke(session.sessionReference, session.current)} className="rounded-xl border px-3 py-2 text-sm font-bold">End session</button></div>)}</div><button onClick={all} className="rounded-xl bg-rose-700 px-4 py-3 text-sm font-black text-white">Sign out everywhere</button></div>;
}

export function SessionExpiredPage() { return <AuthShell title="Your session has ended" description="For your security, sign in again to continue."><Link className="block rounded-xl bg-indigo-600 p-3 text-center font-bold" to="/login">Return to sign in</Link></AuthShell>; }
export function AccessDeniedPage() { const location = useLocation();const context=new URLSearchParams(location.search).get('context');const agency=context==='agency';const customer=context==='customer';const signIn=agency?'/agency/login':customer?'/customer/login':'/login';const label=agency?'Agency sign in':customer?'Customer sign in':'Business sign in';const subject=agency?'agency portal':customer?'customer account':'business workspace';return <AuthShell title="Access unavailable" description={`This account does not have active access to the ${subject}.`}><div className="space-y-3"><Link className="block rounded-xl bg-indigo-600 p-3 text-center font-bold" to={signIn}>{label}</Link>{location.state && <p className="text-xs text-slate-500">Try signing in with a different account.</p>}</div></AuthShell>; }
