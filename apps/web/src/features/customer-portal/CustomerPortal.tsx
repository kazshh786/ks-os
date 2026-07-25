import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Outlet, useNavigate, useParams, useSearchParams } from 'react-router';
import { supabase } from '../../lib/supabase.js';
import { fetchWithAuth } from '../../api/client.js';
import { customerPortalProvider } from './customer-portal-provider.js';
import { CustomerBookingPolicyActions } from './CustomerBookingManagement.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type Business = {
  businessSlug: string;
  displayName: string;
  primaryColor: string;
  logoUrl: string | null;
  contactPhone: string | null;
};

type CustomerSession = {
  customer: { displayName: string; email: string; phone: string | null };
  linkedBusinesses: Business[];
};

// ── Context ───────────────────────────────────────────────────────────────────

const CustomerContext = createContext<CustomerSession | null>(null);
const useCustomer = () => useContext(CustomerContext);

// ── Utilities ─────────────────────────────────────────────────────────────────

const formatMoney = (minor: number, currency = 'GBP') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100);

const formatWhen = (value: string, timezone?: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value));

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value));

const portalError = (error: unknown) =>
  error instanceof Error ? error.message : 'CUSTOMER_PORTAL_UNAVAILABLE';

// ── Status colours ────────────────────────────────────────────────────────────

const statusColour = (status: string) => {
  const map: Record<string, string> = {
    'Awaiting confirmation': 'bg-amber-100 text-amber-800',
    'Confirmed':             'bg-emerald-100 text-emerald-800',
    'Checked in':            'bg-sky-100 text-sky-800',
    'In progress':           'bg-violet-100 text-violet-800',
    'Payment due':           'bg-rose-100 text-rose-800',
    'Completed':             'bg-slate-100 text-slate-700',
    'Cancelled':             'bg-red-100 text-red-700',
    'Missed appointment':    'bg-orange-100 text-orange-700',
  };
  return map[status] ?? 'bg-slate-100 text-slate-600';
};

const paymentColour = (status: string) => {
  if (status === 'Paid') return 'text-emerald-600';
  if (status === 'Payment due') return 'text-rose-600';
  if (status.includes('Partial')) return 'text-amber-600';
  return 'text-slate-500';
};

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-700" />
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-white py-12 text-center shadow-sm">
      <span className="text-4xl">{icon}</span>
      <p className="font-semibold text-slate-800">{title}</p>
      <p className="max-w-xs text-sm text-slate-500">{body}</p>
    </div>
  );
}

function AlertBanner({ kind, children }: { kind: 'error' | 'info' | 'warn'; children: React.ReactNode }) {
  const styles = {
    error: 'bg-red-50 border border-red-200 text-red-800',
    warn:  'bg-amber-50 border border-amber-200 text-amber-800',
    info:  'bg-sky-50 border border-sky-200 text-sky-800',
  };
  return (
    <div role="alert" className={`rounded-xl px-4 py-3 text-sm ${styles[kind]}`}>
      {children}
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColour(label)}`}>
      {label}
    </span>
  );
}

// ── Login Page ────────────────────────────────────────────────────────────────

export function CustomerLoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search] = useSearchParams();
  const claim = search.get('claim');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const callback = new URL('/customer/auth/callback', window.location.origin);
      if (claim) callback.searchParams.set('claim', claim);
      await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: callback.toString() } });
    } finally {
      // Deliberately neutral — neither Supabase errors nor account existence are revealed.
      setBusy(false);
      setSent(true);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-12">
      {/* Decorative blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-violet-600 opacity-10 blur-3xl" />
        <div className="absolute -bottom-20 -right-20 h-96 w-96 rounded-full bg-emerald-500 opacity-10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo area */}
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-emerald-500 shadow-lg">
            <span className="text-2xl">✨</span>
          </div>
          <p className="mt-3 text-sm font-medium tracking-wide text-slate-400 uppercase">KS OS</p>
          <h1 className="mt-1 text-2xl font-black text-white">Customer Portal</h1>
        </div>

        {/* Card */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-xl">
          {sent ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20">
                <span className="text-2xl">📬</span>
              </div>
              <div>
                <p className="font-bold text-white">Check your inbox</p>
                <p className="mt-1 text-sm text-slate-400">
                  If an eligible account exists, we'll send a secure sign-in link.
                </p>
              </div>
              <button
                className="text-sm text-slate-400 underline hover:text-white"
                onClick={() => setSent(false)}
              >
                Try another email
              </button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <div>
                <label className="block text-sm font-medium text-slate-300">
                  Email address
                </label>
                <input
                  id="customer-email"
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-slate-500 outline-none ring-0 transition focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                  placeholder="you@example.com"
                />
              </div>
              <button
                id="customer-login-submit"
                disabled={busy}
                className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-emerald-500 px-4 py-3 font-bold text-white shadow-lg transition hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Sending secure link…' : 'Email me a secure sign-in link'}
              </button>
              <p className="text-center text-xs text-slate-500">
                We'll never ask you to create a password.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Auth Callback ─────────────────────────────────────────────────────────────

export function CustomerAuthCallbackPage() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const code = search.get('code');
      if (code) await supabase.auth.exchangeCodeForSession(code);
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      const claim = search.get('claim');
      if (data.session) navigate(claim ? `/customer/claim/${claim}` : '/customer', { replace: true });
      else setError(true);
    })().catch(() => active && setError(true));
    return () => { active = false; };
  }, [navigate, search]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-8 text-center shadow-sm">
        {error ? (
          <>
            <span className="text-4xl">🔗</span>
            <h1 className="mt-4 text-xl font-bold text-slate-900">This sign-in link is unavailable</h1>
            <p className="mt-2 text-sm text-slate-600">
              It may have expired. Request a new secure sign-in link to continue.
            </p>
            <Link
              to="/customer/login"
              className="mt-5 inline-block rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-700" />
            <p className="mt-4 text-slate-600">Signing you in securely…</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Claim Page ────────────────────────────────────────────────────────────────

export function CustomerClaimPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) { setError(true); return; }
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate(`/customer/login?claim=${encodeURIComponent(token)}`, { replace: true });
        return;
      }
      const result = await fetchWithAuth(`/api/v1/customer/claims/${token}/complete`, { method: 'POST' });
      if (!result.ok) throw new Error('CUSTOMER_CLAIM_INVALID');
      if (active) navigate('/customer', { replace: true });
    })().catch(() => active && setError(true));
    return () => { active = false; };
  }, [navigate, token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-8 text-center shadow-sm">
        {error ? (
          <>
            <span className="text-4xl">🔒</span>
            <h1 className="mt-4 text-xl font-bold text-slate-900">This secure link is unavailable</h1>
            <p className="mt-2 text-sm text-slate-600">
              It may have expired or already been used. Ask your salon to send a new link.
            </p>
            <Link
              to="/customer/login"
              className="mt-5 inline-block rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white"
            >
              Go to sign in
            </Link>
          </>
        ) : (
          <>
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-violet-600" />
            <p className="mt-4 text-slate-600">Securely linking your salon account…</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Portal Layout ─────────────────────────────────────────────────────────────

export function CustomerPortalLayout() {
  const navigate = useNavigate();
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    customerPortalProvider.getSession().then(setSession).catch((reason) => setError(portalError(reason)));
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate('/customer/login', { replace: true });
  };

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm text-center">
          <span className="text-4xl">⚠️</span>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Customer portal unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">
            {error === 'CUSTOMER_ACCESS_DENIED'
              ? 'This signed-in account is a staff account and cannot access the customer portal.'
              : 'Please sign in again to continue.'}
          </p>
          <Link className="mt-5 inline-block rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white" to="/customer/login">
            Customer sign in
          </Link>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner />
      </div>
    );
  }

  const navLinks = [
    { to: '/customer/appointments', label: 'Appointments' },
    { to: '/customer/forms',        label: 'Forms' },
    { to: '/customer/payments',     label: 'Payments' },
    { to: '/customer/profile',      label: 'Profile' },
  ];

  return (
    <CustomerContext.Provider value={session}>
      <div className="min-h-screen bg-slate-50">
        {/* Top nav */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm">
          <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
            <Link to="/customer" className="mr-auto flex items-center gap-2 font-black text-slate-900">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-emerald-500 text-xs text-white">✨</span>
              My Portal
            </Link>

            {/* Desktop nav */}
            <nav className="hidden items-center gap-1 sm:flex" aria-label="Customer portal navigation">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  {link.label}
                </Link>
              ))}
              <button
                onClick={signOut}
                className="ml-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Sign out
              </button>
            </nav>

            {/* Mobile hamburger */}
            <button
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 sm:hidden"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Open navigation"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {menuOpen
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
              </svg>
            </button>
          </div>

          {/* Mobile menu */}
          {menuOpen && (
            <div className="border-t border-slate-100 bg-white px-4 pb-4 sm:hidden">
              <nav className="flex flex-col gap-1 pt-2">
                {navLinks.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setMenuOpen(false)}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {link.label}
                  </Link>
                ))}
                <button
                  onClick={signOut}
                  className="mt-1 rounded-lg px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Sign out
                </button>
              </nav>
            </div>
          )}
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </CustomerContext.Provider>
  );
}

// ── Home Page ─────────────────────────────────────────────────────────────────

export function CustomerHomePage() {
  const customer = useCustomer();
  const [appointments, setAppointments] = useState<any[]>([]);
  const [forms, setForms] = useState<any[]>([]);
  const [reviewInvitations, setReviewInvitations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      customerPortalProvider.listAppointments({ status: 'UPCOMING', limit: '3' }),
      customerPortalProvider.listForms(),
      customerPortalProvider.listReviewInvitations(),
    ])
      .then(([next, assigned, reviews]) => { setAppointments(next); setForms(assigned); setReviewInvitations(reviews); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (!customer) return null;

  const outstanding = forms.filter((f) => ['PENDING', 'OPENED'].includes(f.status));
  const nextAppt = appointments[0];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <p className="text-sm text-slate-500">Welcome back</p>
        <h1 className="text-3xl font-black text-slate-900">{customer.customer.displayName}</h1>
      </div>

      {error && (
        <AlertBanner kind="error">
          We couldn't load your portal information. Please refresh to try again.
        </AlertBanner>
      )}

      {reviewInvitations.map((invitation) => (
        <AlertBanner key={invitation.id} kind="info">
          <span className="font-semibold">{invitation.salonName} would value your honest feedback.</span>{' '}
          <Link to={invitation.reviewPath} className="underline">Choose a review provider →</Link>
          <span className="ml-2 text-xs">There is no obligation to leave a review.</span>
        </AlertBanner>
      ))}

      {/* Outstanding forms alert */}
      {outstanding.length > 0 && (
        <AlertBanner kind="warn">
          <span className="font-semibold">
            {outstanding.length} form{outstanding.length > 1 ? 's' : ''} need{outstanding.length === 1 ? 's' : ''} your attention.
          </span>{' '}
          <Link to="/customer/forms" className="underline">View forms →</Link>
        </AlertBanner>
      )}

      {/* Next appointment hero */}
      {nextAppt && (
        <Link
          to={`/customer/appointments/${nextAppt.bookingReference}`}
          className="block rounded-2xl bg-gradient-to-br from-violet-600 to-emerald-500 p-px shadow-lg transition hover:opacity-95"
        >
          <div className="rounded-2xl bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">Next appointment</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">{nextAppt.serviceName}</h2>
            <p className="mt-1 text-sm text-slate-600">{nextAppt.salonName} · {nextAppt.staffName}</p>
            <p className="mt-2 font-medium text-slate-800">{formatWhen(nextAppt.startTime, nextAppt.timezone)}</p>
            <div className="mt-3">
              <Badge label={nextAppt.status} />
            </div>
          </div>
        </Link>
      )}

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Salons */}
        <article className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your salons</h2>
          {customer.linkedBusinesses.length ? (
            <ul className="mt-3 space-y-2">
              {customer.linkedBusinesses.map((business) => (
                <li key={business.businessSlug} className="flex items-center gap-3">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white text-sm font-bold"
                    style={{ background: business.primaryColor }}
                  >
                    {business.displayName[0]}
                  </div>
                  <span className="font-medium text-slate-800">{business.displayName}</span>
                </li>
              ))}
            </ul>
          ) : loading ? (
            <Spinner />
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              No linked salons yet. Use the secure link from a booking confirmation email.
            </p>
          )}
          {customer.linkedBusinesses.length > 1 && (
            <Link to="/customer/businesses" className="mt-4 block text-sm font-medium text-violet-600 hover:underline">
              View all salons →
            </Link>
          )}
        </article>

        {/* Outstanding forms */}
        <article className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Outstanding forms</h2>
          <p className="mt-3 text-5xl font-black text-slate-900">{outstanding.length}</p>
          <Link to="/customer/forms" className="mt-3 inline-block text-sm font-medium text-violet-600 hover:underline">
            View forms →
          </Link>
        </article>
      </div>

      {/* Recent appointments */}
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Upcoming appointments</h2>
          <Link to="/customer/appointments" className="text-sm font-medium text-violet-600 hover:underline">
            View all
          </Link>
        </div>
        {loading ? (
          <Spinner />
        ) : appointments.length ? (
          <ul className="mt-4 divide-y divide-slate-100">
            {appointments.map((appt) => (
              <li key={appt.bookingReference} className="py-3">
                <Link className="flex items-start justify-between gap-4" to={`/customer/appointments/${appt.bookingReference}`}>
                  <div>
                    <p className="font-semibold text-slate-900">{appt.serviceName}</p>
                    <p className="mt-0.5 text-sm text-slate-500">{appt.salonName} · {appt.staffName}</p>
                    <p className="mt-1 text-sm text-slate-700">{formatWhen(appt.startTime, appt.timezone)}</p>
                  </div>
                  <Badge label={appt.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No upcoming appointments.</p>
        )}
      </section>
    </div>
  );
}

// ── Businesses Page ───────────────────────────────────────────────────────────

export function CustomerBusinessesPage() {
  const customer = useCustomer();
  if (!customer) return null;
  return (
    <section className="space-y-5">
      <h1 className="text-3xl font-black text-slate-900">Your salons</h1>
      {customer.linkedBusinesses.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {customer.linkedBusinesses.map((business) => (
            <article
              key={business.businessSlug}
              className="rounded-2xl bg-white p-5 shadow-sm transition hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xl font-black text-white shadow"
                  style={{ background: business.primaryColor }}
                >
                  {business.displayName[0]}
                </div>
                <div>
                  <h2 className="font-bold text-slate-900">{business.displayName}</h2>
                  {business.contactPhone && (
                    <p className="text-sm text-slate-500">{business.contactPhone}</p>
                  )}
                </div>
              </div>
              <Link
                className="mt-4 inline-block text-sm font-medium text-violet-600 hover:underline"
                to={`/customer/appointments?business=${business.businessSlug}`}
              >
                View appointments →
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="🏪"
          title="No linked salons"
          body="Use the secure link from a booking confirmation email to link your first salon."
        />
      )}
    </section>
  );
}

// ── Appointments List ─────────────────────────────────────────────────────────

export function CustomerAppointmentsPage() {
  const [search] = useSearchParams();
  const [status, setStatus] = useState('UPCOMING');
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const business = search.get('business') || '';

  useEffect(() => {
    setLoading(true);
    setError(false);
    customerPortalProvider
      .listAppointments({ status, ...(business ? { business } : {}) })
      .then(setAppointments)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [status, business]);

  const tabs = [
    { key: 'UPCOMING',  label: 'Upcoming' },
    { key: 'PAST',      label: 'Past' },
    { key: 'CANCELLED', label: 'Cancelled' },
  ];

  return (
    <section className="space-y-5">
      <h1 className="text-3xl font-black text-slate-900">Appointments</h1>

      {/* Tab bar */}
      <div role="tablist" className="flex gap-2">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            id={`appt-tab-${key.toLowerCase()}`}
            role="tab"
            aria-selected={status === key}
            onClick={() => setStatus(key)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              status === key
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <Spinner />}

      {!loading && error && (
        <AlertBanner kind="error">Appointments could not be loaded. Please refresh to try again.</AlertBanner>
      )}

      {!loading && !error && (
        appointments.length ? (
          <ul className="space-y-3">
            {appointments.map((appt) => (
              <li key={appt.bookingReference}>
                <Link
                  id={`appt-card-${appt.bookingReference}`}
                  className="flex items-start justify-between gap-4 rounded-2xl bg-white p-5 shadow-sm transition hover:shadow-md"
                  to={`/customer/appointments/${appt.bookingReference}`}
                >
                  <div className="min-w-0">
                    <h2 className="font-semibold text-slate-900">{appt.serviceName}</h2>
                    <p className="mt-0.5 text-sm text-slate-500">{appt.salonName} · {appt.staffName}</p>
                    <p className="mt-2 text-sm text-slate-700">{formatWhen(appt.startTime, appt.timezone)}</p>
                    <p className={`mt-1 text-sm font-medium ${paymentColour(appt.payment.status)}`}>
                      {appt.payment.status}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <Badge label={appt.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={status === 'UPCOMING' ? '📅' : status === 'PAST' ? '🕰️' : '❌'}
            title={`No ${status.toLowerCase()} appointments`}
            body="Nothing to show in this section."
          />
        )
      )}
    </section>
  );
}

// ── Appointment Detail ────────────────────────────────────────────────────────

export function CustomerAppointmentDetailPage() {
  const { bookingReference } = useParams();
  const [appointment, setAppointment] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!bookingReference) return;
    customerPortalProvider
      .getAppointment(bookingReference)
      .then(setAppointment)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [bookingReference]);

  if (loading) return <Spinner />;
  if (error) return (
    <AlertBanner kind="error">This appointment is unavailable. It may have been removed or you may not have access.</AlertBanner>
  );
  if (!appointment) return null;

  const outstandingForms = appointment.forms?.filter((f: any) => ['PENDING', 'OPENED'].includes(f.status)) ?? [];

  return (
    <section className="space-y-5">
      {/* Header */}
      <div>
        <p className="text-sm text-slate-500">{appointment.salon.displayName}</p>
        <h1 className="mt-1 text-3xl font-black text-slate-900">{appointment.serviceName}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge label={appointment.status} />
          <span className="text-sm text-slate-500">{appointment.location}</span>
        </div>
        <p className="mt-3 font-medium text-slate-800">{formatWhen(appointment.startTime, appointment.timezone)}</p>
        <p className="text-sm text-slate-500">{appointment.staffName}</p>
      </div>

      {/* Outstanding forms alert */}
      {outstandingForms.length > 0 && (
        <AlertBanner kind="warn">
          <span className="font-semibold">
            {outstandingForms.length} form{outstandingForms.length > 1 ? 's' : ''} outstanding.
          </span>{' '}
          <Link to="/customer/forms" className="underline">Complete now →</Link>
        </AlertBanner>
      )}

      {/* Payment */}
      <article className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-800">Payment</h2>
        <p className={`mt-1 text-sm font-medium ${paymentColour(appointment.payment.status)}`}>
          {appointment.payment.status}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          {[
            { label: 'Quoted', value: formatMoney(appointment.payment.quotedAmount) },
            { label: 'Paid',   value: formatMoney(appointment.payment.paidAmount) },
            { label: 'Outstanding', value: formatMoney(appointment.payment.outstandingAmount) },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="text-slate-500">{label}</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      </article>

      {/* Forms */}
      {appointment.forms?.length > 0 && (
        <article className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-800">Forms</h2>
          <ul className="mt-3 space-y-2">
            {appointment.forms.map((form: any) => (
              <li key={form.assignmentReference} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-800">{form.title}</p>
                  <p className="text-xs text-slate-500">Version {form.version}</p>
                </div>
                {['PENDING', 'OPENED'].includes(form.status) ? (
                  <Link
                    to={`/customer/forms/${form.assignmentReference}`}
                    className="shrink-0 rounded-full bg-violet-600 px-3 py-1 text-xs font-bold text-white hover:bg-violet-700"
                  >
                    Complete
                  </Link>
                ) : (
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    form.status === 'SUBMITTED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {form.status === 'SUBMITTED' ? 'Completed' : form.status}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </article>
      )}

      <CustomerBookingPolicyActions bookingReference={bookingReference!} appointment={appointment} />

      {/* Salon contact */}
      {appointment.salon.contactPhone && (
        <p className="text-sm text-slate-500">
          Need help? Contact {appointment.salon.displayName} on{' '}
          <a href={`tel:${appointment.salon.contactPhone}`} className="font-medium text-slate-800 hover:underline">
            {appointment.salon.contactPhone}
          </a>
        </p>
      )}
    </section>
  );
}

// ── Forms List ────────────────────────────────────────────────────────────────

export function CustomerFormsPage() {
  const [forms, setForms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    customerPortalProvider.listForms()
      .then(setForms)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const groupedForms = useMemo(() => ({
    outstanding: forms.filter((f) => ['PENDING', 'OPENED'].includes(f.status)),
    completed:   forms.filter((f) => f.status === 'SUBMITTED'),
    other:       forms.filter((f) => ['EXPIRED', 'CANCELLED'].includes(f.status)),
  }), [forms]);

  return (
    <section className="space-y-5">
      <h1 className="text-3xl font-black text-slate-900">Forms</h1>

      {loading && <Spinner />}
      {!loading && error && (
        <AlertBanner kind="error">Forms could not be loaded. Please refresh to try again.</AlertBanner>
      )}

      {!loading && !error && !forms.length && (
        <EmptyState icon="📋" title="No forms assigned" body="Your salon will notify you when a form needs completing." />
      )}

      {groupedForms.outstanding.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700">
            ⚠ Needs attention ({groupedForms.outstanding.length})
          </h2>
          {groupedForms.outstanding.map((form) => (
            <FormCard key={form.assignmentReference} form={form} />
          ))}
        </div>
      )}

      {groupedForms.completed.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
            ✓ Completed ({groupedForms.completed.length})
          </h2>
          {groupedForms.completed.map((form) => (
            <FormCard key={form.assignmentReference} form={form} />
          ))}
        </div>
      )}

      {groupedForms.other.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Other ({groupedForms.other.length})
          </h2>
          {groupedForms.other.map((form) => (
            <FormCard key={form.assignmentReference} form={form} />
          ))}
        </div>
      )}
    </section>
  );
}

function FormCard({ form }: { form: any }) {
  const outstanding = ['PENDING', 'OPENED'].includes(form.status);
  return (
    <article
      id={`form-card-${form.assignmentReference}`}
      className={`rounded-2xl bg-white p-5 shadow-sm ${outstanding ? 'ring-2 ring-amber-200' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-slate-900">{form.title}</h3>
          <p className="mt-0.5 text-sm text-slate-500">{form.salonName} · Version {form.version}</p>
          {form.status === 'SUBMITTED' && form.submittedAt && (
            <p className="mt-1 text-xs text-emerald-600">Completed {formatDate(form.submittedAt)}</p>
          )}
          {form.status === 'EXPIRED' && <p className="mt-1 text-xs text-slate-400">Expired</p>}
          {form.status === 'CANCELLED' && <p className="mt-1 text-xs text-slate-400">Cancelled</p>}
        </div>
        {outstanding && (
          <Link
            to={`/customer/forms/${form.assignmentReference}`}
            className="shrink-0 rounded-full bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700"
          >
            Complete
          </Link>
        )}
      </div>
    </article>
  );
}

// ── Form Completion ───────────────────────────────────────────────────────────

export function CustomerFormPage() {
  const { assignmentReference } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [name, setName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    if (!assignmentReference) return;
    customerPortalProvider.getForm(assignmentReference)
      .then(setData)
      .catch(() => setError('This form is unavailable.'));
  }, [assignmentReference]);

  if (error && !data) return (
    <AlertBanner kind="error">{error}</AlertBanner>
  );
  if (!data) return <Spinner />;
  if (data.completed) return (
    <div className="max-w-xl space-y-4">
      <div className="rounded-2xl bg-emerald-50 p-6 text-center">
        <span className="text-4xl">✅</span>
        <h1 className="mt-3 text-xl font-bold text-emerald-900">Form completed</h1>
        <p className="mt-1 text-sm text-emerald-700">This form has already been submitted.</p>
      </div>
      <Link to="/customer/forms" className="inline-block text-sm font-medium text-violet-600 hover:underline">
        ← Back to forms
      </Link>
    </div>
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await customerPortalProvider.submitForm(assignmentReference!, {
        answers,
        acknowledgement: { accepted: true, name },
        idempotencyKey,
        language: navigator.language || 'en-GB',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        trackingParameters: {},
      });
      navigate('/customer/forms', { replace: true });
    } catch {
      setError('Your form could not be submitted. Please check your answers and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm font-semibold" style={{ color: data.salon.primaryColor }}>
          {data.salon.name}
        </p>
        <h1 className="mt-1 text-3xl font-black text-slate-900">{data.form.title}</h1>
        {data.form.description && (
          <p className="mt-2 text-slate-600">{data.form.description}</p>
        )}
      </div>

      <form onSubmit={submit} className="space-y-5">
        {data.form.schema.fields.map((field: any) => (
          <FormField key={field.id} field={field} setAnswers={setAnswers} />
        ))}

        {/* Acknowledgement */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-800">Acknowledgement</h2>
          <p className="mt-2 text-sm text-slate-600">{data.form.acknowledgementText}</p>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input
              required
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600"
            />
            <span>I have read and accept the above acknowledgement.</span>
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Full name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
              placeholder="Your full name"
            />
          </label>
        </div>

        {error && <AlertBanner kind="error">{error}</AlertBanner>}

        <button
          disabled={!accepted || submitting}
          className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-emerald-500 px-4 py-3 font-bold text-white shadow-lg transition hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit form'}
        </button>
      </form>
    </section>
  );
}

function FormField({ field, setAnswers }: { field: any; setAnswers: React.Dispatch<React.SetStateAction<Record<string, unknown>>> }) {
  if (field.type === 'INFORMATION') {
    return (
      <div className="rounded-2xl bg-sky-50 p-4 text-sm text-sky-800">
        {field.label}
      </div>
    );
  }

  const set = (value: unknown) => setAnswers((prev) => ({ ...prev, [field.id]: value }));
  const inputClass = 'mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500';

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <label className="block text-sm font-semibold text-slate-800">
        {field.label}
        {field.required && <span className="ml-1 text-rose-500">*</span>}
      </label>
      {field.helpText && (
        <p className="mt-1 text-sm text-slate-500">{field.helpText}</p>
      )}
      {['SHORT_TEXT', 'EMAIL', 'PHONE', 'DATE'].includes(field.type) && (
        <input
          required={field.required}
          type={field.type === 'EMAIL' ? 'email' : field.type === 'PHONE' ? 'tel' : field.type === 'DATE' ? 'date' : 'text'}
          className={inputClass}
          onChange={(e) => set(e.target.value)}
        />
      )}
      {field.type === 'LONG_TEXT' && (
        <textarea required={field.required} className={`${inputClass} min-h-[100px] resize-y`} onChange={(e) => set(e.target.value)} />
      )}
      {['YES_NO', 'CONSENT_CHECKBOX'].includes(field.type) && (
        <label className="mt-2 flex items-center gap-3 text-sm">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-violet-600" onChange={(e) => set(e.target.checked)} />
          <span>Yes</span>
        </label>
      )}
      {['SINGLE_CHOICE', 'SELECT'].includes(field.type) && (
        <select required={field.required} className={inputClass} defaultValue="" onChange={(e) => set(e.target.value)}>
          <option disabled value="">Select…</option>
          {field.options.map((opt: any) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
      )}
      {field.type === 'MULTIPLE_CHOICE' && (
        <div className="mt-2 space-y-2">
          {field.options.map((opt: any) => (
            <label key={opt.id} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-violet-600"
                onChange={(e) => setAnswers((prev) => {
                  const arr = Array.isArray(prev[field.id]) ? prev[field.id] as string[] : [];
                  return { ...prev, [field.id]: e.target.checked ? [...arr, opt.id] : arr.filter((id) => id !== opt.id) };
                })}
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Payments ──────────────────────────────────────────────────────────────────

export function CustomerPaymentsPage() {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    customerPortalProvider.listPayments()
      .then(setPayments)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="space-y-5">
      <h1 className="text-3xl font-black text-slate-900">Payments &amp; refunds</h1>
      {loading && <Spinner />}
      {!loading && error && (
        <AlertBanner kind="error">Payment history could not be loaded. Please refresh to try again.</AlertBanner>
      )}
      {!loading && !error && (
        payments.length ? (
          <ul className="space-y-3">
            {payments.map((payment, i) => (
              <li key={`${payment.bookingReference}-${i}`}>
                <article className="rounded-2xl bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="font-semibold text-slate-900">{payment.salonName}</h2>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {formatDate(payment.date)} · {payment.paymentSource}
                      </p>
                    </div>
                    <p className="shrink-0 font-bold text-slate-900">
                      {formatMoney(payment.netPaid, payment.currency)}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-sm">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      payment.paymentStatus === 'Paid' || payment.paymentStatus === 'Partially refunded'
                        ? 'bg-emerald-100 text-emerald-700'
                        : payment.paymentStatus === 'Refunded'
                          ? 'bg-sky-100 text-sky-700'
                          : payment.paymentStatus === 'Failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-slate-100 text-slate-600'
                    }`}>
                      {payment.paymentStatus}
                    </span>
                    {payment.refundedAmount > 0 && (
                      <span className="text-slate-500 text-xs">
                        Refunded {formatMoney(payment.refundedAmount, payment.currency)}
                      </span>
                    )}
                  </div>
                </article>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="💳" title="No payment history" body="Payments from your salon appointments will appear here." />
        )
      )}
    </section>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────────

export function CustomerProfilePage() {
  const customer = useCustomer();
  const [profile, setProfile] = useState<any>();
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [messageKind, setMessageKind] = useState<'error' | 'info'>('info');

  useEffect(() => {
    customerPortalProvider.getProfile().then((value) => {
      setProfile(value);
      setDisplayName(value.displayName);
      setPhone(value.phone || '');
    }).catch(() => { setMessage('Your profile could not be loaded.'); setMessageKind('error'); });
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const updated = await customerPortalProvider.updateProfile({ displayName, phone: phone || null });
      setProfile({ ...profile, ...updated });
      setMessage('Profile updated. Linked salon records were not changed.');
      setMessageKind('info');
    } catch {
      setMessage('Profile update failed. Use an international phone number such as +447700900123.');
      setMessageKind('error');
    } finally {
      setSaving(false);
    }
  };

  if (!profile && !message) return <Spinner />;
  if (!profile) return <AlertBanner kind="error">{message}</AlertBanner>;

  return (
    <section className="max-w-xl space-y-6">
      <h1 className="text-3xl font-black text-slate-900">Your profile</h1>

      <form onSubmit={save} className="rounded-2xl bg-white p-5 shadow-sm space-y-4">
        {/* Verified email — read-only */}
        <div>
          <label className="block text-sm font-semibold text-slate-700">Verified email</label>
          <input
            disabled
            value={profile.email}
            className="mt-1 w-full rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-slate-500"
          />
          <p className="mt-1 text-xs text-slate-400">
            To change your email, use the secure email-change process in your sign-in provider.
          </p>
        </div>

        {/* Display name */}
        <div>
          <label className="block text-sm font-semibold text-slate-700">
            Display name
            <input
              required
              id="customer-profile-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
            />
          </label>
        </div>

        {/* Phone */}
        <div>
          <label className="block text-sm font-semibold text-slate-700">
            Phone (optional)
            <input
              id="customer-profile-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+447700900123"
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
            />
          </label>
          <p className="mt-1 text-xs text-slate-400">International format required.</p>
        </div>

        {message && <AlertBanner kind={messageKind}>{message}</AlertBanner>}

        <button
          id="customer-profile-save"
          disabled={saving}
          className="rounded-xl bg-gradient-to-r from-violet-600 to-emerald-500 px-5 py-3 font-bold text-white shadow-md transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </form>

      {/* Linked salons */}
      {profile.linkedBusinesses?.length > 0 && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-800">Linked salons</h2>
          <ul className="mt-3 space-y-2">
            {profile.linkedBusinesses.map((business: any) => (
              <li key={business.businessSlug} className="flex items-center gap-3 text-sm">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white text-xs font-bold"
                  style={{ background: business.primaryColor }}
                >
                  {business.displayName[0]}
                </div>
                <span className="text-slate-700">{business.displayName}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
