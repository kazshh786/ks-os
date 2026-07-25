import React, { useState } from 'react';
import {
  CalendarDays, Check, CheckCircle2, Clipboard, Clock3, CreditCard, ExternalLink, FileText,
  Globe, LayoutDashboard, Plus, Search, ShieldCheck, Sparkles, UserCheck, Users, Wallet, X,
} from 'lucide-react';
import { Panel, Status } from './AgencyPages';
import { PublicBookingFlow } from '../bookings/PublicBookingFlow';

export interface AgencyAppointment {
  id: string;
  reference: string;
  serviceName: string;
  staffName: string;
  clientName: string;
  clientEmail: string;
  clientCompany: string;
  startTime: string;
  endTime: string;
  status: 'CONFIRMED' | 'CHECKED_IN' | 'IN_SERVICE' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  paymentStatus: 'NOT_REQUIRED' | 'PENDING' | 'SUCCEEDED';
  quotedAmountMinor: number;
  notes?: string;
}

export interface AgencyServiceItem {
  id: string;
  name: string;
  description: string;
  durationMins: number;
  priceMinor: number;
  requiresDeposit: boolean;
  depositAmountMinor?: number;
  isActive: boolean;
  assignedStaff: string[];
}

export interface AgencyHostSchedule {
  id: string;
  name: string;
  role: string;
  email: string;
  workingDays: string[];
  hours: string;
  isActive: boolean;
}

const INITIAL_AGENCY_SERVICES: AgencyServiceItem[] = [
  {
    id: 'srv-1',
    name: 'Platform Demo & Product Tour',
    description: 'Walkthrough of KS OS multi-tenant capabilities, POS, staff scheduling, and client portal.',
    durationMins: 30,
    priceMinor: 0,
    requiresDeposit: false,
    isActive: true,
    assignedStaff: ['Kasim Shah', 'Sarah Jenkins'],
  },
  {
    id: 'srv-2',
    name: 'Onboarding & Business Setup',
    description: 'Guided technical setup, custom domain routing, staff invitation, and payment gateway activation.',
    durationMins: 45,
    priceMinor: 0,
    requiresDeposit: false,
    isActive: true,
    assignedStaff: ['Kasim Shah', 'David Miller'],
  },
  {
    id: 'srv-3',
    name: 'Growth Strategy & Funnel Review',
    description: 'Dedicated 1-on-1 revenue optimisation session, automated marketing workflows, and client retention funnels.',
    durationMins: 60,
    priceMinor: 9900,
    requiresDeposit: true,
    depositAmountMinor: 4900,
    isActive: true,
    assignedStaff: ['Kasim Shah'],
  },
  {
    id: 'srv-4',
    name: 'Technical Support & Integration Audit',
    description: 'Deep-dive audit into calendar syncs, Xero/QuickBooks integrations, Stripe Terminal, and webhooks.',
    durationMins: 45,
    priceMinor: 0,
    requiresDeposit: false,
    isActive: true,
    assignedStaff: ['David Miller'],
  },
];

const INITIAL_AGENCY_HOSTS: AgencyHostSchedule[] = [
  {
    id: 'host-1',
    name: 'Kasim Shah',
    role: 'Agency Director & Lead Architect',
    email: 'kasim@kasimshah.com',
    workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    hours: '09:00 - 18:00',
    isActive: true,
  },
  {
    id: 'host-2',
    name: 'Sarah Jenkins',
    role: 'Client Onboarding Lead',
    email: 'sarah@ksos.local',
    workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    hours: '09:00 - 17:00',
    isActive: true,
  },
  {
    id: 'host-3',
    name: 'David Miller',
    role: 'Technical Integration Specialist',
    email: 'david@ksos.local',
    workingDays: ['Mon', 'Tue', 'Wed', 'Thu'],
    hours: '10:00 - 18:00',
    isActive: true,
  },
];

const INITIAL_AGENCY_BOOKINGS: AgencyAppointment[] = [
  {
    id: 'app-1',
    reference: 'AGY-10928',
    serviceName: 'Onboarding & Business Setup',
    staffName: 'Kasim Shah',
    clientName: 'Salon A Owner',
    clientEmail: 'owner@salon-a.ksos.local',
    clientCompany: 'Salon A',
    startTime: '2026-07-24T10:00:00.000Z',
    endTime: '2026-07-24T10:45:00.000Z',
    status: 'CONFIRMED',
    paymentStatus: 'NOT_REQUIRED',
    quotedAmountMinor: 0,
    notes: 'Configuring custom domain routing and staff schedules.',
  },
  {
    id: 'app-2',
    reference: 'AGY-10929',
    serviceName: 'Platform Demo & Product Tour',
    staffName: 'Sarah Jenkins',
    clientName: 'Prospect Beauty',
    clientEmail: 'contact@prospectbeauty.local',
    clientCompany: 'Prospect Beauty',
    startTime: '2026-07-24T14:00:00.000Z',
    endTime: '2026-07-24T14:30:00.000Z',
    status: 'CONFIRMED',
    paymentStatus: 'NOT_REQUIRED',
    quotedAmountMinor: 0,
  },
  {
    id: 'app-3',
    reference: 'AGY-10930',
    serviceName: 'Growth Strategy & Funnel Review',
    staffName: 'Kasim Shah',
    clientName: 'Salon B Owner',
    clientEmail: 'owner@salon-b.ksos.local',
    clientCompany: 'Salon B Aesthetics',
    startTime: '2026-07-25T11:00:00.000Z',
    endTime: '2026-07-25T12:00:00.000Z',
    status: 'CONFIRMED',
    paymentStatus: 'SUCCEEDED',
    quotedAmountMinor: 9900,
    notes: 'Paid £49 deposit via Stripe.',
  },
];

type WorkstationTab = 'CALENDAR' | 'SERVICES' | 'HOSTS' | 'POS' | 'PUBLIC_PAGE';

export function AgencyBookingSystemPage() {
  const [activeTab, setActiveTab] = useState<WorkstationTab>('CALENDAR');
  const [bookings, setBookings] = useState<AgencyAppointment[]>(INITIAL_AGENCY_BOOKINGS);
  const [services, setServices] = useState<AgencyServiceItem[]>(INITIAL_AGENCY_SERVICES);
  const [hosts] = useState<AgencyHostSchedule[]>(INITIAL_AGENCY_HOSTS);
  
  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [hostFilter, setHostFilter] = useState<string>('ALL');

  // Dialogs
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddServiceModal, setShowAddServiceModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const agencyPublicUrl = `${window.location.origin}/book/ks-agency`;

  const copyAgencyLink = () => {
    navigator.clipboard.writeText(agencyPublicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  };

  const filteredBookings = bookings.filter(b => {
    const matchesSearch =
      b.clientName.toLowerCase().includes(search.toLowerCase()) ||
      b.clientCompany.toLowerCase().includes(search.toLowerCase()) ||
      b.reference.toLowerCase().includes(search.toLowerCase()) ||
      b.serviceName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || b.status === statusFilter;
    const matchesHost = hostFilter === 'ALL' || b.staffName.includes(hostFilter);
    return matchesSearch && matchesStatus && matchesHost;
  });

  const handleUpdateStatus = (id: string, newStatus: AgencyAppointment['status']) => {
    setBookings(prev => prev.map(b => (b.id === id ? { ...b, status: newStatus } : b)));
  };

  const handleCreateBooking = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const serviceName = String(fd.get('serviceName') || 'Platform Demo & Product Tour');
    const staffName = String(fd.get('staffName') || 'Kasim Shah');
    const clientName = String(fd.get('clientName') || 'New Prospect');
    const clientEmail = String(fd.get('clientEmail') || 'client@example.com');
    const clientCompany = String(fd.get('clientCompany') || 'Client Business');
    const dateStr = String(fd.get('date') || new Date().toISOString().slice(0, 10));
    const timeStr = String(fd.get('time') || '10:00');

    const startIso = new Date(`${dateStr}T${timeStr}:00.000Z`).toISOString();
    const endIso = new Date(new Date(startIso).getTime() + 45 * 60000).toISOString();

    const newAppt: AgencyAppointment = {
      id: `app-${Date.now()}`,
      reference: `AGY-${Math.floor(10000 + Math.random() * 90000)}`,
      serviceName,
      staffName,
      clientName,
      clientEmail,
      clientCompany,
      startTime: startIso,
      endTime: endIso,
      status: 'CONFIRMED',
      paymentStatus: 'NOT_REQUIRED',
      quotedAmountMinor: 0,
      notes: String(fd.get('notes') || ''),
    };

    setBookings(prev => [newAppt, ...prev]);
    setShowCreateModal(false);
  };

  const handleAddService = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const newSrv: AgencyServiceItem = {
      id: `srv-${Date.now()}`,
      name: String(fd.get('name')),
      description: String(fd.get('description')),
      durationMins: Number(fd.get('durationMins')),
      priceMinor: Number(fd.get('pricePounds')) * 100,
      requiresDeposit: Boolean(fd.get('requiresDeposit')),
      depositAmountMinor: Number(fd.get('depositPounds') || 0) * 100,
      isActive: true,
      assignedStaff: ['Kasim Shah'],
    };
    setServices(prev => [...prev, newSrv]);
    setShowAddServiceModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <Panel
        title="KS OS Agency Booking Workstation"
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-black text-white hover:bg-violet-500 shadow-lg shadow-violet-950/50"
            >
              <Plus className="h-4 w-4" />
              + Book Client Session
            </button>
            <button
              type="button"
              onClick={copyAgencyLink}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-bold text-slate-300 hover:text-white"
            >
              <Clipboard className="h-3.5 w-3.5" />
              {copied ? 'Link Copied!' : 'Copy Agency Link'}
            </button>
            <a
              href="/book/ks-agency"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-bold text-slate-300 hover:text-white"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open Live Booking Page
            </a>
          </div>
        }
      >
        <p className="mb-4 text-xs text-slate-400">
          The Agency operates on the full native KS OS Booking Engine — managing agency client consultations, onboarding sessions, strategy reviews, staff availability, and intake checklists with zero compromise.
        </p>

        {/* Tab Navigation */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
          {[
            { id: 'CALENDAR', label: 'Calendar & Dispatch Workstation', icon: CalendarDays },
            { id: 'SERVICES', label: 'Agency Service Catalog', icon: FileText },
            { id: 'HOSTS', label: 'Agency Hosts & Schedules', icon: Users },
            { id: 'POS', label: 'POS & Financial Checkout', icon: CreditCard },
            { id: 'PUBLIC_PAGE', label: 'Live Public Agency Booking Engine', icon: Globe },
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as WorkstationTab)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition ${
                  active
                    ? 'bg-violet-600 text-white shadow-md shadow-violet-950'
                    : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white hover:border-slate-700'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </Panel>

      {/* Tab 1: Calendar & Dispatch Workstation */}
      {activeTab === 'CALENDAR' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 md:grid-cols-4">
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search reference, client name, company, or service..."
                className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-xs text-slate-300 focus:border-violet-500 focus:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="CHECKED_IN">CHECKED_IN</option>
              <option value="IN_SERVICE">IN_SERVICE</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
            <select
              value={hostFilter}
              onChange={e => setHostFilter(e.target.value)}
              className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-xs text-slate-300 focus:border-violet-500 focus:outline-none"
            >
              <option value="ALL">All Agency Hosts</option>
              {hosts.map(h => (
                <option key={h.id} value={h.name}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>

          {/* Bookings List / Grid */}
          <Panel title={`Agency Appointments Dispatch (${filteredBookings.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                  <tr>
                    <th className="p-3">Reference</th>
                    <th>Client & Business</th>
                    <th>Agency Service</th>
                    <th>Assigned Host</th>
                    <th>Scheduled Date & Time</th>
                    <th>Status</th>
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBookings.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-xs text-slate-500">
                        No agency bookings match the current search or filters.
                      </td>
                    </tr>
                  ) : (
                    filteredBookings.map(b => (
                      <tr key={b.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-950/50 transition">
                        <td className="p-3 font-mono text-xs font-bold text-violet-300">{b.reference}</td>
                        <td>
                          <strong className="text-white font-bold">{b.clientName}</strong>
                          <span className="block text-xs text-slate-500">{b.clientCompany} ({b.clientEmail})</span>
                        </td>
                        <td className="font-semibold text-slate-200">{b.serviceName}</td>
                        <td className="text-xs text-slate-400">{b.staffName}</td>
                        <td className="text-xs font-medium text-slate-300">
                          {new Date(b.startTime).toLocaleString('en-GB', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td>
                          <Status value={b.status} />
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {b.status === 'CONFIRMED' && (
                              <button
                                type="button"
                                onClick={() => handleUpdateStatus(b.id, 'COMPLETED')}
                                className="rounded-lg bg-emerald-950/80 border border-emerald-800 px-2.5 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-900"
                              >
                                Complete
                              </button>
                            )}
                            {b.status !== 'CANCELLED' && b.status !== 'COMPLETED' && (
                              <button
                                type="button"
                                onClick={() => handleUpdateStatus(b.id, 'CANCELLED')}
                                className="rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-1 text-[10px] font-bold text-slate-400 hover:text-rose-300 hover:border-rose-800"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* Tab 2: Agency Service Catalog */}
      {activeTab === 'SERVICES' && (
        <div className="space-y-4">
          <Panel
            title="Agency Service Catalog & Offers"
            action={
              <button
                type="button"
                onClick={() => setShowAddServiceModal(true)}
                className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-black text-white hover:bg-violet-500"
              >
                + Add Agency Service
              </button>
            }
          >
            <p className="mb-4 text-xs text-slate-400">
              Configure agency service packages, duration, pricing, and deposit rules for client bookings.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              {services.map(s => (
                <div key={s.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-white text-base">{s.name}</h3>
                      <p className="text-xs text-slate-400 mt-1">{s.description}</p>
                    </div>
                    <span className="rounded-full bg-violet-950/60 border border-violet-800 px-3 py-1 text-xs font-black text-violet-300 whitespace-nowrap">
                      {s.priceMinor === 0 ? 'FREE' : `£${(s.priceMinor / 100).toFixed(2)}`}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 border-t border-slate-900 pt-3">
                    <span className="flex items-center gap-1">
                      <Clock3 className="h-3.5 w-3.5 text-slate-500" />
                      {s.durationMins} mins
                    </span>
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
                      {s.requiresDeposit ? `Deposit: £${((s.depositAmountMinor || 0) / 100).toFixed(2)}` : 'No Deposit'}
                    </span>
                    <span className="flex items-center gap-1 text-slate-500">
                      Hosts: {s.assignedStaff.join(', ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {/* Tab 3: Agency Hosts & Schedules */}
      {activeTab === 'HOSTS' && (
        <Panel title="Agency Team & Host Working Hours">
          <p className="mb-4 text-xs text-slate-400">
            Agency team members assigned to take client consultations, platform walkthroughs, and onboarding calls.
          </p>

          <div className="grid gap-4 md:grid-cols-3">
            {hosts.map(h => (
              <div key={h.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <strong className="text-white text-sm">{h.name}</strong>
                  <Status value={h.isActive ? 'ACTIVE' : 'INACTIVE'} />
                </div>
                <p className="text-xs text-slate-400">{h.role}</p>
                <div className="space-y-1 text-xs text-slate-500 border-t border-slate-900 pt-2">
                  <div>Working Days: <strong className="text-slate-300">{h.workingDays.join(', ')}</strong></div>
                  <div>Hours: <strong className="text-slate-300">{h.hours}</strong></div>
                  <div>Email: <strong className="text-slate-300">{h.email}</strong></div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Tab 4: POS & Financial Checkout */}
      {activeTab === 'POS' && (
        <Panel title="Agency Point of Sale & Consultation Billing">
          <p className="mb-4 text-xs text-slate-400">
            Record strategy consultation payments, setup fees, and deposit receipts processed through Stripe Connect or invoice.
          </p>

          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl bg-slate-900 p-4 border border-slate-800">
                <span className="text-[10px] font-black uppercase text-slate-500">Consultation Revenue (30d)</span>
                <p className="text-2xl font-black text-white mt-1">£99.00</p>
              </div>
              <div className="rounded-xl bg-slate-900 p-4 border border-slate-800">
                <span className="text-[10px] font-black uppercase text-slate-500">Paid Deposits</span>
                <p className="text-2xl font-black text-emerald-400 mt-1">£49.00</p>
              </div>
              <div className="rounded-xl bg-slate-900 p-4 border border-slate-800">
                <span className="text-[10px] font-black uppercase text-slate-500">Free Demos Conducted</span>
                <p className="text-2xl font-black text-violet-300 mt-1">12</p>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {/* Tab 5: Live Public Agency Booking Engine */}
      {activeTab === 'PUBLIC_PAGE' && (
        <div className="rounded-3xl border border-slate-800 bg-slate-950 p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-950/60 px-3 py-1 text-[10px] font-black uppercase text-violet-300 border border-violet-800/50">
                <Sparkles className="h-3 w-3" />
                Native KS OS Agency Engine
              </span>
              <h2 className="mt-2 text-xl font-black text-white">Live Public Agency Booking Engine</h2>
              <p className="text-xs text-slate-400">
                This is the exact native KS OS booking wizard that agency clients experience when booking setup calls, demos, and consultations.
              </p>
            </div>
            <button
              type="button"
              onClick={copyAgencyLink}
              className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-black text-white hover:bg-violet-500"
            >
              {copied ? 'Link Copied!' : 'Copy Agency Link'}
            </button>
          </div>

          <PublicBookingFlow
            slug="ks-agency"
            preview={true}
            onBookingSuccess={payload => {
              const appt: AgencyAppointment = {
                id: payload.booking.reference,
                reference: payload.booking.reference,
                serviceName: payload.booking.serviceName,
                staffName: payload.booking.staffName || 'Kasim Shah',
                clientName: payload.customerName,
                clientEmail: payload.customerEmail,
                clientCompany: 'Client Business',
                startTime: payload.booking.startTime,
                endTime: payload.booking.endTime,
                status: 'CONFIRMED',
                paymentStatus: 'NOT_REQUIRED',
                quotedAmountMinor: 0,
              };
              setBookings(prev => [appt, ...prev]);
            }}
          />
        </div>
      )}

      {/* Modal: Create Client Booking */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
          <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-black text-white text-base">Book Client Session (Agency Dispatch)</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateBooking} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400">Agency Service</label>
                <select name="serviceName" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white">
                  {services.map(s => (
                    <option key={s.id} value={s.name}>
                      {s.name} ({s.durationMins} mins · {s.priceMinor === 0 ? 'FREE' : `£${s.priceMinor / 100}`})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 grid-cols-2">
                <div>
                  <label className="text-xs text-slate-400">Assigned Host</label>
                  <select name="staffName" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white">
                    {hosts.map(h => (
                      <option key={h.id} value={h.name}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Client Name</label>
                  <input name="clientName" required defaultValue="Salon Owner" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white" />
                </div>
              </div>

              <div className="grid gap-3 grid-cols-2">
                <div>
                  <label className="text-xs text-slate-400">Client Email</label>
                  <input name="clientEmail" type="email" required defaultValue="owner@clientbusiness.com" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Client Company</label>
                  <input name="clientCompany" defaultValue="Client Business" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white" />
                </div>
              </div>

              <div className="grid gap-3 grid-cols-2">
                <div>
                  <label className="text-xs text-slate-400">Date</label>
                  <input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Time</label>
                  <input name="time" type="time" required defaultValue="10:00" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white" />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400">Notes / Requirements</label>
                <textarea name="notes" rows={2} placeholder="e.g. Discussing custom domain setup..." className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white" />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
                <button type="button" onClick={() => setShowCreateModal(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300">
                  Cancel
                </button>
                <button type="submit" className="rounded-xl bg-violet-600 px-5 py-2 text-xs font-black text-white hover:bg-violet-500">
                  Confirm & Schedule Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Agency Service */}
      {showAddServiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-black text-white text-base">Add Agency Service Offer</h3>
              <button onClick={() => setShowAddServiceModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddService} className="space-y-3">
              <div>
                <label className="text-xs text-slate-400">Service Name</label>
                <input name="name" required placeholder="e.g. Enterprise Custom Audit" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white" />
              </div>

              <div>
                <label className="text-xs text-slate-400">Description</label>
                <textarea name="description" required rows={2} placeholder="Detailed description of what this session covers..." className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white" />
              </div>

              <div className="grid gap-3 grid-cols-2">
                <div>
                  <label className="text-xs text-slate-400">Duration (Minutes)</label>
                  <input name="durationMins" type="number" defaultValue={45} required className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white" />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Price (£ GBP)</label>
                  <input name="pricePounds" type="number" defaultValue={0} required className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs text-white" />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input type="checkbox" name="requiresDeposit" id="requiresDeposit" className="rounded bg-slate-950 border-slate-700" />
                <label htmlFor="requiresDeposit" className="text-xs text-slate-300">Require Deposit for Booking</label>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
                <button type="button" onClick={() => setShowAddServiceModal(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300">
                  Cancel
                </button>
                <button type="submit" className="rounded-xl bg-violet-600 px-5 py-2 text-xs font-black text-white hover:bg-violet-500">
                  Save Agency Service
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
