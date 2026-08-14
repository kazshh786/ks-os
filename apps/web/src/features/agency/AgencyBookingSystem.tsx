import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock3, CreditCard, ExternalLink, Globe2, Scissors, ShieldCheck } from 'lucide-react';
import type { BusinessTenant } from '../../data/types.js';
import { fetchWithAuth, setDefaultAuthContextOverride } from '../../api/client.js';
import { BookingOperationsCalendar } from '../bookings/BookingOperationsCalendar.js';
import { ServicesPage } from '../services/ServicesPage.js';
import AvailabilityPage from '../team/AvailabilityPage.js';
import POSCheckout from '../../components/POSCheckout.js';
import { agencyFetch } from './AgencyAuth.js';

type AgencyBookingTab = 'calendar' | 'services' | 'availability' | 'pos' | 'public';
type WorkspaceActivation = {
  tenant: {
    id: string;
    name: string;
    subdomain: string;
    timezone: string;
    currency: string;
    primaryColor: string;
    secondaryColor: string;
  };
  membershipReference: string;
  publicBookingPath: string;
};

const tabs: Array<{ id: AgencyBookingTab; label: string; icon: typeof CalendarDays }> = [
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'services', label: 'Services', icon: Scissors },
  { id: 'availability', label: 'Availability', icon: Clock3 },
  { id: 'pos', label: 'POS checkout', icon: CreditCard },
  { id: 'public', label: 'Public booking page', icon: Globe2 },
];

function toBusinessTenant(workspace: WorkspaceActivation): BusinessTenant {
  return {
    id: workspace.tenant.id,
    name: workspace.tenant.name,
    subdomain: workspace.tenant.subdomain,
    primaryColor: workspace.tenant.primaryColor,
    secondaryColor: workspace.tenant.secondaryColor,
    timezone: workspace.tenant.timezone,
    currency: workspace.tenant.currency,
    plan: 'Pro',
    paymentPolicy: 'CustomerChoice',
    depositPercentage: 0,
  };
}

export function AgencyBookingSystemPage() {
  const [activeTab, setActiveTab] = useState<AgencyBookingTab>('calendar');
  const [workspace, setWorkspace] = useState<WorkspaceActivation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const mounted = useRef(true);

  const activate = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await agencyFetch('/booking-workspace/activate', { method: 'POST' }) as WorkspaceActivation;
      const selection = await fetchWithAuth('/api/v1/auth/select-workspace', {
        method: 'POST',
        authContext: 'TENANT',
        body: JSON.stringify({ businessReference: result.tenant.id }),
      });
      const body = await selection.json().catch(() => ({}));
      if (!selection.ok) throw new Error(body?.error?.message || 'The agency booking workspace could not be selected.');
      if (!mounted.current) return;
      setDefaultAuthContextOverride('TENANT');
      setWorkspace(result);
    } catch (cause) {
      if (!mounted.current) return;
      setDefaultAuthContextOverride(null);
      setError(cause instanceof Error ? cause.message : 'The agency booking workspace could not be opened.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    void activate();
    return () => {
      mounted.current = false;
      setDefaultAuthContextOverride(null);
    };
  }, []);

  if (loading) {
    return <div role="status" className="grid min-h-80 place-items-center rounded-3xl border border-slate-800 bg-slate-900 text-sm font-bold text-slate-300">Opening the dedicated agency booking workspace…</div>;
  }
  if (error || !workspace) {
    return <div role="alert" className="rounded-3xl border border-rose-900 bg-rose-950/30 p-6 text-rose-200"><h1 className="text-xl font-black">Agency booking workspace unavailable</h1><p className="mt-2 text-sm">{error}</p><button type="button" onClick={() => void activate()} className="mt-5 rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950">Try again</button></div>;
  }

  const tenant = toBusinessTenant(workspace);
  const publicUrl = workspace.publicBookingPath;

  return <div className="space-y-5">
    <header className="rounded-3xl border border-violet-800/70 bg-gradient-to-br from-violet-950 to-slate-900 p-4 shadow-xl sm:p-6">
      <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-violet-300"><ShieldCheck className="h-4 w-4" />Dedicated internal workspace</div>
          <h1 className="mt-2 text-2xl font-black text-white sm:text-3xl">KS OS Agency Bookings</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">The agency now uses the same live, tenant-isolated booking engine as client businesses. Services, bookings, customers, payments, forms and availability persist independently under <strong>KS OS Agency</strong>.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
          <a href="/app/calendar" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-center text-sm font-black text-white hover:bg-violet-400"><ExternalLink className="h-4 w-4 shrink-0" />Open full booking workspace</a>
          <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-950/60 px-4 py-2 text-center text-sm font-black text-white"><Globe2 className="h-4 w-4 shrink-0" />Open public booking page</a>
        </div>
      </div>
      <nav aria-label="Agency booking tools" className="mt-6 flex flex-wrap gap-2 border-t border-white/10 pt-5">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} aria-pressed={activeTab === tab.id} className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-xs font-black ${activeTab === tab.id ? 'bg-white text-slate-950' : 'border border-slate-700 bg-slate-950/50 text-slate-300 hover:text-white'}`}><Icon className="h-4 w-4" />{tab.label}</button>;
        })}
      </nav>
    </header>

    <section className="rounded-3xl bg-slate-100 p-3 text-slate-950 sm:p-5">
      {activeTab === 'calendar' && <BookingOperationsCalendar tenantOverride={tenant} />}
      {activeTab === 'services' && <ServicesPage tenantOverride={tenant} />}
      {activeTab === 'availability' && <AvailabilityPage />}
      {activeTab === 'pos' && <POSCheckout tenant={tenant} onCheckoutCompleted={() => setActiveTab('calendar')} />}
      {activeTab === 'public' && <div className="space-y-4">
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border bg-white p-4 sm:flex-row sm:items-center sm:p-5">
          <div><h2 className="text-xl font-black">Live agency booking page</h2><p className="mt-1 text-sm text-slate-600">This is the customer-facing booking journey for agency consultations and support sessions.</p></div>
          <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white sm:w-auto">Open in a new tab</a>
        </div>
        <iframe title="KS OS Agency public booking page" src={publicUrl} className="h-[75dvh] min-h-[560px] w-full rounded-2xl border bg-white sm:h-[760px]" />
      </div>}
    </section>
  </div>;
}
