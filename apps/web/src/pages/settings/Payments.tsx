import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CreditCard,
  Landmark,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  WalletCards,
} from 'lucide-react';
import { useAuth } from '../../auth/useAuth.js';
import { fetchWithAuth } from '../../api/client.js';

type StripeStatus =
  | 'NOT_CONNECTED'
  | 'ONBOARDING'
  | 'ACTION_REQUIRED'
  | 'PENDING_VERIFICATION'
  | 'READY'
  | 'RESTRICTED'
  | 'DISABLED';

interface StripeConnection {
  stripeAccountId: string | null;
  connectionStatus: StripeStatus;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  currentlyDue: string[];
  eventuallyDue: string[];
  pastDue: string[];
  disabledReason: string | null;
  lastSyncedAt: string | null;
}

const STRIPE_API = '/api/v1/integrations/stripe';

const formatRequirement = (requirement: string) => requirement
  .replace(/^individual\.|^company\.|^business_profile\./, '')
  .replace(/[._]/g, ' ')
  .replace(/\b\w/g, character => character.toUpperCase());

async function stripeRequest<T>(path = '', init?: RequestInit): Promise<T> {
  const response = await fetchWithAuth(`${STRIPE_API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.error?.code || 'Stripe setup could not be completed.');
  }
  return body as T;
}

const statusPresentation: Record<StripeStatus, {
  label: string;
  summary: string;
  badge: string;
}> = {
  NOT_CONNECTED: {
    label: 'Not connected',
    summary: 'Set up Stripe to accept booking and point-of-sale payments.',
    badge: 'bg-slate-100 text-slate-700',
  },
  ONBOARDING: {
    label: 'Setup started',
    summary: 'Complete your business, identity and payout details securely with Stripe.',
    badge: 'bg-amber-100 text-amber-800',
  },
  ACTION_REQUIRED: {
    label: 'Action required',
    summary: 'Stripe needs some more information before payments can be fully enabled.',
    badge: 'bg-amber-100 text-amber-800',
  },
  PENDING_VERIFICATION: {
    label: 'Stripe is reviewing',
    summary: 'Your details have been submitted and Stripe is completing its checks.',
    badge: 'bg-blue-100 text-blue-800',
  },
  READY: {
    label: 'Connected',
    summary: 'Stripe payments and payouts are ready for this business.',
    badge: 'bg-emerald-100 text-emerald-800',
  },
  RESTRICTED: {
    label: 'Needs attention',
    summary: 'Open the secure Stripe setup to resolve the outstanding requirement.',
    badge: 'bg-rose-100 text-rose-800',
  },
  DISABLED: {
    label: 'Disabled',
    summary: 'Stripe has disabled this account. Review the account in Stripe for next steps.',
    badge: 'bg-rose-100 text-rose-800',
  },
};

export function Payments() {
  const { role } = useAuth();
  const [connection, setConnection] = useState<StripeConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'connect' | 'refresh' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const status: StripeStatus = connection?.connectionStatus || 'NOT_CONNECTED';
  const presentation = statusPresentation[status];

  const requirements = useMemo(() => {
    const values = [...(connection?.pastDue || []), ...(connection?.currentlyDue || [])];
    return [...new Set(values)].slice(0, 6);
  }, [connection]);

  const loadConnection = async () => {
    if (role === 'staff') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await stripeRequest<{ data: StripeConnection | null }>('/connection');
      setConnection(response.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Stripe status could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const returnedFromStripe = new URLSearchParams(window.location.search).get('stripe') === 'returned';
    if (returnedFromStripe) {
      setNotice('Welcome back. Your latest Stripe status is shown below.');
      window.history.replaceState({}, '', window.location.pathname);
    }
    void loadConnection();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const startStripeSetup = async () => {
    setAction('connect');
    setError('');
    setNotice('');
    try {
      const response = await stripeRequest<{ data: StripeConnection; url: string }>('/connect', { method: 'POST' });
      if (!response.url) throw new Error('Stripe did not return a secure setup link.');
      window.location.assign(response.url);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Stripe setup could not be started.');
      setAction(null);
    }
  };

  const refreshStatus = async () => {
    setAction('refresh');
    setError('');
    setNotice('');
    try {
      const response = await stripeRequest<{ data: StripeConnection }>('/sync', { method: 'POST' });
      setConnection(response.data);
      setNotice(response.data.connectionStatus === 'READY'
        ? 'Stripe is connected and ready to take payments.'
        : 'Stripe status has been refreshed.');
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Stripe status could not be refreshed.');
    } finally {
      setAction(null);
    }
  };

  if (role === 'staff') {
    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <h1 className="font-black text-amber-950">Owner access required</h1>
              <p className="mt-1 text-sm leading-6 text-amber-800">Only the account owner can connect Stripe or manage payout details.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid min-h-[520px] place-items-center p-6">
        <div className="text-center">
          <Loader2 className="mx-auto h-9 w-9 animate-spin text-indigo-600" />
          <p className="mt-3 text-sm font-bold text-slate-700">Checking Stripe…</p>
        </div>
      </div>
    );
  }

  const setupSteps = [
    {
      title: 'Connect or sign in',
      description: 'Open the secure Stripe setup. Existing Stripe users can sign in; new users can create an account.',
      complete: Boolean(connection),
      active: !connection,
      icon: CreditCard,
    },
    {
      title: 'Add business and bank details',
      description: 'Stripe securely collects identity, company and payout information. KS OS never sees your Stripe password.',
      complete: connection?.detailsSubmitted === true,
      active: Boolean(connection) && !connection?.detailsSubmitted,
      icon: Building2,
    },
    {
      title: 'Start taking payments',
      description: 'Once Stripe approves the account, online bookings, POS card payments and payouts switch on automatically.',
      complete: connection?.chargesEnabled === true && connection?.payoutsEnabled === true,
      active: connection?.detailsSubmitted === true && status !== 'READY',
      icon: Sparkles,
    },
  ];

  const primaryLabel = status === 'NOT_CONNECTED'
    ? 'Set up Stripe'
    : status === 'READY'
      ? 'Manage in Stripe'
      : status === 'PENDING_VERIFICATION'
        ? 'Review setup in Stripe'
        : 'Continue Stripe setup';

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600">Payments</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Set up Stripe</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Connect once to accept online booking payments, deposits and card payments through the POS.</p>
        </div>
        <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-2 text-xs font-black ${presentation.badge}`}>
          {status === 'READY' ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-3 w-3 fill-current" />}
          {presentation.label}
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div><p className="font-black">Stripe could not be updated</p><p className="mt-1 leading-6">{error}</p></div>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="font-semibold leading-6">{notice}</p>
        </div>
      )}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="grid lg:grid-cols-[1.2fr_0.8fr]">
          <div className="p-5 sm:p-8">
            <div className="flex items-start gap-4">
              <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${status === 'READY' ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white'}`}>
                {status === 'READY' ? <ShieldCheck className="h-7 w-7" /> : <WalletCards className="h-7 w-7" />}
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-black text-slate-950">{presentation.label}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">{presentation.summary}</p>
                {connection?.stripeAccountId && <p className="mt-2 font-mono text-xs font-semibold text-slate-400">{connection.stripeAccountId}</p>}
              </div>
            </div>

            {requirements.length > 0 && (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                  <div>
                    <p className="font-black text-amber-950">Stripe needs more information</p>
                    <ul className="mt-2 grid gap-1.5 text-sm text-amber-800 sm:grid-cols-2">
                      {requirements.map(requirement => <li key={requirement}>• {formatRequirement(requirement)}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {connection?.disabledReason && (
              <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                <p className="font-black">Stripe account notice</p>
                <p className="mt-1">{formatRequirement(connection.disabledReason)}</p>
              </div>
            )}

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              {status === 'READY' ? (
                <a href="https://dashboard.stripe.com" target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 text-sm font-black text-white transition hover:bg-indigo-700">
                  {primaryLabel}<ArrowUpRight className="h-4 w-4" />
                </a>
              ) : (
                <button type="button" onClick={() => void startStripeSetup()} disabled={action !== null} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 text-sm font-black text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">
                  {action === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                  {action === 'connect' ? 'Opening Stripe…' : primaryLabel}
                  {action !== 'connect' && <ChevronRight className="h-4 w-4" />}
                </button>
              )}
              {connection && (
                <button type="button" onClick={() => void refreshStatus()} disabled={action !== null} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
                  <RefreshCw className={`h-4 w-4 ${action === 'refresh' ? 'animate-spin' : ''}`} />
                  Refresh status
                </button>
              )}
            </div>

            <div className="mt-5 flex items-start gap-2 text-xs leading-5 text-slate-500">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p>Setup opens on Stripe’s secure website. Bank details, identity documents and login credentials are entered directly with Stripe.</p>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-slate-50 p-5 sm:p-8 lg:border-l lg:border-t-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">What gets enabled</p>
            <div className="mt-4 space-y-3">
              {[
                { label: 'Online booking payments', detail: 'Deposits and full payments', enabled: connection?.chargesEnabled === true, icon: Smartphone },
                { label: 'Point-of-sale card payments', detail: 'Stripe Terminal and Tap to Pay flows', enabled: connection?.chargesEnabled === true, icon: CreditCard },
                { label: 'Payouts to your bank', detail: 'Managed directly by Stripe', enabled: connection?.payoutsEnabled === true, icon: Landmark },
              ].map(item => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${item.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}><Icon className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1"><p className="text-sm font-black text-slate-900">{item.label}</p><p className="mt-0.5 text-xs text-slate-500">{item.detail}</p></div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${item.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{item.enabled ? 'Ready' : 'Off'}</span>
                  </div>
                );
              })}
            </div>
            {connection?.lastSyncedAt && <p className="mt-4 text-xs text-slate-400">Last checked {new Date(connection.lastSyncedAt).toLocaleString('en-GB')}</p>}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">How it works</p><h2 className="mt-1 text-xl font-black text-slate-950">Three simple steps</h2></div>
          <div className="hidden rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-black text-indigo-700 sm:block">Usually completed in Stripe</div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {setupSteps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.title} className={`relative rounded-2xl border p-5 ${step.complete ? 'border-emerald-200 bg-emerald-50/50' : step.active ? 'border-indigo-300 bg-indigo-50/60 ring-2 ring-indigo-100' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className={`grid h-11 w-11 place-items-center rounded-xl ${step.complete ? 'bg-emerald-600 text-white' : step.active ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500'}`}>{step.complete ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}</div>
                  <span className="text-xs font-black text-slate-400">0{index + 1}</span>
                </div>
                <h3 className="mt-5 font-black text-slate-950">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
