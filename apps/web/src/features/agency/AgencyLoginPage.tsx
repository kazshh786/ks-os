import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { AlertCircle, Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react';
import { fetchWithAuth } from '../../api/client';
import { AuthSplitLayout, type AuthHighlight } from '../../auth/AuthSplitLayout.js';
import { supabase } from '../../lib/supabase';

const highlights: AuthHighlight[] = [
  {
    eyebrow: 'Managed business context',
    title: 'Move between client workspaces without losing the operational picture.',
    description: 'Review onboarding, billing, fulfilment and support in the context of the business you are actively managing.',
    metric: 'Context first',
    metricLabel: 'Business switching and management actions stay attached to the correct client workspace.',
    previewRows: [
      { label: 'Client workspace', value: 'Clearly identified' },
      { label: 'Launch readiness', value: 'Visible' },
      { label: 'Operational health', value: 'In context' },
    ],
  },
  {
    eyebrow: 'New security control',
    title: 'Change account passwords with an audit trail, not a shared spreadsheet.',
    description: 'Direct password administration records the reason, updates Supabase Auth and revokes the selected user’s existing sessions.',
    metric: 'Audited',
    metricLabel: 'The password is never stored in KS OS; the administrative action and reason are retained.',
    previewRows: [
      { label: 'Identity selected', value: 'Explicit' },
      { label: 'Sessions', value: 'Revoked' },
      { label: 'Audit reason', value: 'Recorded' },
    ],
  },
  {
    eyebrow: 'Safer support access',
    title: 'Support client teams without asking them to share credentials.',
    description: 'Use controlled support sessions and centrally managed agency identities instead of borrowing a client’s password.',
    metric: 'No sharing',
    metricLabel: 'Individual agency access keeps responsibility, assurance and session controls visible.',
    previewRows: [
      { label: 'Agency identity', value: 'Role owned' },
      { label: 'MFA assurance', value: 'Required where needed' },
      { label: 'Support access', value: 'Time bound' },
    ],
  },
];

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
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const signedIn = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signedIn.error || !signedIn.data.session) {
        throw new Error('Those sign-in details didn’t match an active agency account. Try again or reset your password.');
      }
      const response = await fetchWithAuth('/api/v1/agency/session', { authContext: 'AGENCY' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        await supabase.auth.signOut({ scope: 'local' });
        throw new Error(body?.error?.message || 'This account does not currently have active agency access.');
      }
      if (body.data.mfa.required) {
        const factors = await supabase.auth.mfa.listFactors();
        navigate(factors.data?.totp?.some(factor => factor.status === 'verified') ? '/agency/mfa/challenge' : '/agency/mfa/enrol', { replace: true });
      } else {
        navigate(returnTo, { replace: true });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We couldn’t complete sign in. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthSplitLayout
      portalLabel="Agency portal"
      formTitle="Sign in to the agency portal"
      formDescription="Use your authorised KS OS agency identity. Privileged roles continue through an authenticator check after password verification."
      highlights={highlights}
      accent="violet"
      trustLine="Individual agency identities, MFA assurance and centrally revocable sessions"
    >
      {params.get('passwordUpdated') === '1' && (
        <p role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Password updated. Sign in again to create a new secure session.
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
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-violet-600 focus:ring-4 focus:ring-violet-100"
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
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-12 text-slate-950 outline-none transition focus:border-violet-600 focus:ring-4 focus:ring-violet-100"
            />
            <button
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword(value => !value)}
              className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl text-slate-500 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-600"
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </span>
        </label>

        <div className="flex justify-end">
          <Link to="/agency/forgot-password" className="text-sm font-bold text-violet-700 hover:text-violet-900 hover:underline">
            Forgot password?
          </Link>
        </div>

        <button
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-5 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" aria-hidden="true" />
        Privileged access requires the correct identity, current role permissions and the required authenticator assurance level.
      </p>
    </AuthSplitLayout>
  );
};

export default AgencyLoginPage;
