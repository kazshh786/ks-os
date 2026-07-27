import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { Eye, EyeOff } from 'lucide-react';
import type { AgencyCapability, AgencyRole } from '@ks-os/contracts';
import { fetchWithAuth } from '../../api/client';
import { supabase } from '../../lib/supabase';

export interface AgencySession {
  authenticated: true; context: 'AGENCY'; user: { email: string; displayName: string; role: AgencyRole };
  capabilities: AgencyCapability[]; mfa: { required: boolean; assuranceLevel: 'aal1' | 'aal2' }; expiresAt: string;
}
interface AgencyContextValue { session: AgencySession | null; loading: boolean; reload: () => Promise<void>; signOut: () => Promise<void> }
const AgencyContext = createContext<AgencyContextValue | undefined>(undefined);

export const AgencyAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<AgencySession | null>(null);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);

  const reload = useCallback(async () => {
    const isInitialLoad = !hasLoadedRef.current;
    if (!window.location.pathname.startsWith('/agency')) {
      setSession(null);
      hasLoadedRef.current = true;
      setLoading(false);
      return;
    }
    if (isInitialLoad) setLoading(true);
    try {
      const response = await fetchWithAuth('/api/v1/agency/session', { authContext: 'AGENCY' });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.data) setSession(body.data);
      else if (isInitialLoad) setSession(null);
    } catch {
      // A background token refresh must not unmount the active route or erase
      // unsaved form input because of a transient session-check failure.
      if (isInitialLoad) setSession(null);
    } finally {
      hasLoadedRef.current = true;
      if (isInitialLoad) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setLoading(false);
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') void reload();
    });
    return () => data.subscription.unsubscribe();
  }, [reload]);

  const signOut = async () => {
    sessionStorage.removeItem('ks-os-support-session');
    sessionStorage.removeItem('ks-os-support-metadata');
    await fetchWithAuth('/api/v1/auth/logout', { method: 'POST', authContext: 'AGENCY' }).catch(() => undefined);
    await supabase.auth.signOut({ scope: 'local' });
    setSession(null);
  };
  return <AgencyContext.Provider value={{ session, loading, reload, signOut }}>{children}</AgencyContext.Provider>;
};

export const useAgencyAuth = () => {
  const value = useContext(AgencyContext);
  if (!value) throw new Error('useAgencyAuth must be used inside AgencyAuthProvider');
  return value;
};

export const AgencyGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, loading } = useAgencyAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen bg-slate-950 grid place-items-center text-slate-300">Opening the secure agency portal…</div>;
  if (!session) return <Navigate to={`/agency/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (session.mfa.required) return <Navigate to="/agency/mfa/challenge" replace />;
  return <>{children}</>;
};

export const AgencyCapabilityRoute: React.FC<{ capabilities: AgencyCapability[]; children: React.ReactNode }> = ({ capabilities, children }) => {
  const { session, loading } = useAgencyAuth();
  if (loading) return null;
  if (!session) return <Navigate to="/agency/login" replace />;
  if (!capabilities.some(capability => session.capabilities.includes(capability))) return <Navigate to="/access-denied?context=agency" replace />;
  return <>{children}</>;
};

export interface AgencyRequestError extends Error {
  code?: string;
  details?: unknown;
  status?: number;
  path?: string;
  requestId?: string;
}

export async function agencyFetch(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetchWithAuth(`/api/v1/agency${path}`, { ...options, headers, authContext: 'AGENCY' });
  const requestId = response.headers.get('x-request-id') || response.headers.get('x-correlation-id') || undefined;
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  const expectsJson = contentType.includes('application/json') || contentType.includes('+json');
  let body: any = null;

  if (response.status !== 204 && expectsJson) {
    try {
      body = await response.json();
    } catch {
      const parseError = new Error('The agency API returned an unreadable response. Please retry after the API deployment is checked.') as AgencyRequestError;
      parseError.code = 'AGENCY_API_INVALID_RESPONSE';
      parseError.status = response.status;
      parseError.path = path;
      parseError.requestId = requestId;
      throw parseError;
    }
  } else if (response.status !== 204 && !expectsJson) {
    // Consume the body so the browser can reuse the connection, but never expose
    // an HTML proxy or SPA fallback response in the operator interface.
    await response.text().catch(() => '');
    const transportError = new Error(`The agency API is unavailable for this action (HTTP ${response.status}). The frontend and Fastify deployment may be out of sync.`) as AgencyRequestError;
    transportError.code = 'AGENCY_API_UNAVAILABLE';
    transportError.status = response.status;
    transportError.path = path;
    transportError.requestId = requestId;
    throw transportError;
  }

  if (!response.ok) {
    const error = new Error(body?.error?.message || 'Agency request failed.') as AgencyRequestError;
    error.code = body?.error?.code;
    error.details = body?.error?.details ?? body?.details;
    error.status = response.status;
    error.path = path;
    error.requestId = requestId;
    throw error;
  }
  return body?.data ?? body;
}

export const AgencyLoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const returnTo = params.get('returnTo')?.startsWith('/agency') ? params.get('returnTo')! : '/agency';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const signedIn = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signedIn.error || !signedIn.data.session) throw new Error('The email or password is incorrect.');
      const response = await fetchWithAuth('/api/v1/agency/session', { authContext: 'AGENCY' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        await supabase.auth.signOut({ scope: 'local' });
        throw new Error(body?.error?.message || body?.error?.code || 'This account does not have active agency access.');
      }
      if (body.data.mfa.required) {
        const factors = await supabase.auth.mfa.listFactors();
        navigate(factors.data?.totp?.some(factor => factor.status === 'verified') ? '/agency/mfa/challenge' : '/agency/mfa/enrol', { replace: true });
      } else navigate(returnTo, { replace: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign in could not be completed.'); }
    finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-slate-950 grid place-items-center p-6 text-white"><form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 space-y-5 shadow-2xl"><div><div className="h-11 w-11 rounded-xl bg-violet-600 grid place-items-center font-black mb-4">KS</div><h1 className="text-2xl font-black">Agency portal</h1><p className="text-sm text-slate-400 mt-2">Restricted access for authorised KS OS agency operators.</p></div>{params.get('passwordUpdated') === '1' && <p className="rounded-xl border border-emerald-800 bg-emerald-950/50 p-3 text-sm text-emerald-200">Password updated. Sign in again.</p>}{error && <p role="alert" className="rounded-xl bg-rose-950/50 border border-rose-800 p-3 text-sm text-rose-200">{error}</p>}<label className="block text-sm text-slate-300">Agency email<input autoComplete="email" type="email" required value={email} onChange={event => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3" /></label><label className="block text-sm text-slate-300">Password<span className="relative mt-2 block"><input autoComplete="current-password" type={showPassword ? 'text' : 'password'} required value={password} onChange={event => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 pr-12" /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)} className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl text-slate-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"><span aria-hidden="true">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</span></button></span></label><button disabled={busy} className="w-full rounded-xl bg-violet-600 py-3 text-sm font-black disabled:opacity-50">{busy ? 'Signing in…' : 'Continue securely'}</button><Link to="/agency/forgot-password" className="block text-center text-xs font-bold text-violet-200">Forgot password?</Link><p className="text-[11px] text-slate-500">Privileged access requires an authenticator and centrally revocable application session.</p></form></main>;
};

export const AgencyMfaPage: React.FC<{ mode: 'enrol' | 'challenge' }> = ({ mode }) => {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const navigate = useNavigate();
  const { reload } = useAgencyAuth();
  useEffect(() => {
    let active = true;
    void (async () => {
      const agencyAccess = await fetchWithAuth('/api/v1/agency/session', { authContext: 'AGENCY' });
      if (!agencyAccess.ok) { navigate('/access-denied?context=agency', { replace: true }); return; }
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw new Error(factors.error.message);
      const verified = factors.data?.totp?.find(factor => factor.status === 'verified');
      if (mode === 'challenge' && verified) { if (active) setFactorId(verified.id); return; }
      if (mode === 'challenge' && !verified) { navigate('/agency/mfa/enrol', { replace: true }); return; }
      if (verified) { navigate('/agency/mfa/challenge', { replace: true }); return; }
      for (const factor of factors.data?.all?.filter(factor => factor.factor_type === 'totp' && factor.status === 'unverified') ?? []) {
        const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (removed.error) throw new Error(removed.error.message);
      }
      const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'KS OS Agency' });
      if (enrolled.error) throw new Error(enrolled.error.message || 'Authenticator enrolment could not be started.');
      if (active) { setFactorId(enrolled.data.id); setQr(enrolled.data.totp.qr_code); }
    })().catch(cause => active && setError(cause instanceof Error ? cause.message : 'Authenticator setup failed.')).finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [mode, navigate]);
  const verify = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      if (!factorId) throw new Error('Authenticator setup is incomplete.');
      const verified = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (verified.error) throw new Error('That code could not be verified. Try the current six-digit code.');
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error) throw new Error('Authenticator verification succeeded, but the secure session could not be refreshed. Sign in again.');
      await reload(); navigate('/agency', { replace: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Verification failed.'); }
    finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-slate-950 grid place-items-center p-6 text-white"><form onSubmit={verify} className="w-full max-w-md space-y-5 rounded-3xl border border-slate-800 bg-slate-900 p-8"><h1 className="text-2xl font-black">{mode === 'enrol' ? 'Set up an authenticator' : 'Authenticator check'}</h1><p className="text-sm text-slate-400">{mode === 'enrol' ? 'Scan this QR code in your authenticator app, then enter its current six-digit code.' : 'Enter the current six-digit code from your authenticator app.'}</p>{error && <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-200">{error}</p>}{qr && <img src={qr} alt="Authenticator QR code" className="mx-auto h-52 w-52 rounded-xl bg-white p-3" />}<label className="block text-sm text-slate-300">Six-digit code<input aria-label="Authenticator code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-center text-xl tracking-[0.35em]" /></label><button disabled={busy || code.length !== 6} className="w-full rounded-xl bg-violet-600 py-3 text-sm font-black disabled:opacity-50">{busy ? 'Checking…' : 'Verify and continue'}</button></form></main>;
};
