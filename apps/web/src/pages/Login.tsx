import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AlertCircle, Eye, EyeOff, LogIn } from 'lucide-react';
import { fetchWithAuth } from '../api/client';
import { AuthSplitLayout, type AuthHighlight } from '../auth/AuthSplitLayout.js';
import { supabase } from '../lib/supabase';

const safeReturnTo = (value: string | null) => value?.startsWith('/') && !value.startsWith('//') ? value : '/app';

const highlights: AuthHighlight[] = [
  {
    eyebrow: 'One operational workspace',
    title: 'Run the working day without jumping between disconnected tools.',
    description: 'Bookings, customers, forms, payments and team access stay connected so the next action is easier to find.',
    metric: 'One view',
    metricLabel: 'Keep the operational context together from booking through payment and follow-up.',
    previewRows: [
      { label: 'Today’s schedule', value: 'Ready to review' },
      { label: 'Customer forms', value: 'In one queue' },
      { label: 'Payments', value: 'Connected' },
    ],
  },
  {
    eyebrow: 'Clear access control',
    title: 'Give each person the access they need, without sharing credentials.',
    description: 'Owner and staff access stays role-aware, while sessions can be revoked centrally when responsibilities change.',
    metric: 'Role-aware',
    metricLabel: 'Account access follows the person and their responsibilities instead of a shared password.',
    previewRows: [
      { label: 'Owner access', value: 'Full workspace' },
      { label: 'Staff access', value: 'Permission based' },
      { label: 'Sessions', value: 'Revocable' },
    ],
  },
  {
    eyebrow: 'Less admin friction',
    title: 'See what needs attention and move straight into the work.',
    description: 'The workspace is designed around daily decisions, with clear status, familiar language and fewer dead ends.',
    metric: 'Action first',
    metricLabel: 'Important operational work is surfaced without turning the sign-in experience into a sales pitch.',
    previewRows: [
      { label: 'Bookings', value: 'Prioritised' },
      { label: 'Operations', value: 'Visible' },
      { label: 'Follow-up', value: 'Trackable' },
    ],
  },
];

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error || !result.data.session) {
        throw new Error('That email and password combination didn’t match. Try again or reset your password.');
      }
      const response = await fetchWithAuth('/api/v1/auth/context', { authContext: 'TENANT' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.data?.next === 'NO_ACCESS') {
        await supabase.auth.signOut({ scope: 'local' });
        navigate('/access-denied?context=tenant', { replace: true });
        return;
      }
      if (body.data.next === 'SELECT_WORKSPACE') {
        navigate('/select-business', { replace: true });
        return;
      }
      navigate(safeReturnTo(search.get('returnTo')), { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We couldn’t complete sign in. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSplitLayout
      portalLabel="Business workspace"
      formTitle="Sign in to your business workspace"
      formDescription="Use the email address and password linked to the business you are authorised to manage."
      highlights={highlights}
      accent="indigo"
      trustLine="Individual accounts, permission-aware access and centrally revocable sessions"
    >
      {search.get('passwordUpdated') === '1' && (
        <p role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Password updated. Sign in again on this device.
        </p>
      )}

      {error && (
        <div role="alert" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="flex items-center gap-2 font-black"><AlertCircle className="h-4 w-4" aria-hidden="true" />We couldn’t sign you in</p>
          <p className="mt-1 leading-5">{error}</p>
        </div>
      )}

      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block text-sm font-bold text-slate-700">
          Email address
          <input
            autoComplete="email"
            type="email"
            required
            value={email}
            onChange={event => setEmail(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100"
          />
        </label>

        <label className="block text-sm font-bold text-slate-700">
          Password
          <span className="relative mt-2 block">
            <input
              autoComplete="current-password"
              type={showPassword ? 'text' : 'password'}
              required
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-12 text-slate-950 outline-none transition focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100"
            />
            <button
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword(value => !value)}
              className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl text-slate-500 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-600"
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </span>
        </label>

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-bold text-indigo-700 hover:text-indigo-900 hover:underline">
            Forgot password?
          </Link>
        </div>

        <button
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthSplitLayout>
  );
};

export default Login;
