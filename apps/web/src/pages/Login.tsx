import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Lock, LogIn } from 'lucide-react';
import { fetchWithAuth } from '../api/client';
import { supabase } from '../lib/supabase';

const safeReturnTo = (value: string | null) => value?.startsWith('/') && !value.startsWith('//') ? value : '/app';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError(null);
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error || !result.data.session) throw new Error('The email or password is incorrect.');
      const response = await fetchWithAuth('/api/v1/auth/context', { authContext: 'TENANT' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.data?.next === 'NO_ACCESS') {
        await supabase.auth.signOut({ scope: 'local' });
        navigate('/access-denied?context=tenant', { replace: true }); return;
      }
      if (body.data.next === 'SELECT_WORKSPACE') { navigate('/select-business', { replace: true }); return; }
      navigate(safeReturnTo(search.get('returnTo')), { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in could not be completed.');
    } finally { setLoading(false); }
  };

  return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
    <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
      <div className="text-center"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 font-black">KS</div><h1 className="text-2xl font-black">Business workspace</h1><p className="mt-2 text-sm text-slate-400">Sign in to the salon businesses you are authorised to manage.</p></div>
      {search.get('passwordUpdated') === '1' && <p role="status" className="mt-5 rounded-xl border border-emerald-800 bg-emerald-950/50 p-3 text-sm text-emerald-200">Password updated. Sign in again on this device.</p>}
      {error && <div role="alert" className="mt-5 rounded-xl border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-200"><p className="flex items-center gap-2 font-bold"><AlertCircle className="h-4 w-4" /> Sign in unsuccessful</p><p className="mt-1">{error}</p></div>}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block text-sm text-slate-300">Email address<input autoComplete="email" type="email" required value={email} onChange={event => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 outline-none focus:border-indigo-500" /></label>
        <label className="block text-sm text-slate-300">Password<input autoComplete="current-password" type="password" required value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 outline-none focus:border-indigo-500" /></label>
        <button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-black disabled:opacity-50"><LogIn className="h-4 w-4" />{loading ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <div className="mt-5 text-center text-xs font-bold"><Link to="/forgot-password" className="text-indigo-300">Forgot password?</Link></div>
      <p className="mt-6 flex items-center justify-center gap-1 text-[11px] text-slate-500"><Lock className="h-3 w-3" /> Protected by Supabase Auth</p>
    </section>
  </main>;
};

export default Login;
