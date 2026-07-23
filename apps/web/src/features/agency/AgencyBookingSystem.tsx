import React, { useState } from 'react';
import { CalendarDays, CheckCircle2, Clipboard, ExternalLink, Globe, LayoutDashboard, Plus, Sparkles } from 'lucide-react';
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
  status: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  notes?: string;
}

const MOCK_AGENCY_BOOKINGS: AgencyAppointment[] = [
  {
    id: '1',
    reference: 'AGY-10928',
    serviceName: 'Onboarding & Business Setup',
    staffName: 'Kasim Shah (Agency Director)',
    clientName: 'Salon A Owner',
    clientEmail: 'owner@salon-a.ksos.local',
    clientCompany: 'Salon A',
    startTime: '2026-07-24T10:00:00.000Z',
    endTime: '2026-07-24T10:45:00.000Z',
    status: 'CONFIRMED',
    notes: 'Configuring domain routing and staff schedules.',
  },
  {
    id: '2',
    reference: 'AGY-10929',
    serviceName: 'Platform Demo & Tour',
    staffName: 'Sarah Jenkins (Onboarding Lead)',
    clientName: 'Prospect Beauty',
    clientEmail: 'contact@prospectbeauty.local',
    clientCompany: 'Prospect Beauty',
    startTime: '2026-07-24T14:00:00.000Z',
    endTime: '2026-07-24T14:30:00.000Z',
    status: 'CONFIRMED',
  },
];

export function AgencyBookingSystemPage() {
  const [viewMode, setViewMode] = useState<'MANAGEMENT' | 'PUBLIC_BOOKING_FLOW'>('MANAGEMENT');
  const [bookings, setBookings] = useState<AgencyAppointment[]>(MOCK_AGENCY_BOOKINGS);
  const [copied, setCopied] = useState(false);

  const agencyPublicUrl = `${window.location.origin}/book/ks-agency`;

  const copyAgencyLink = () => {
    navigator.clipboard.writeText(agencyPublicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <Panel
        title="KS OS Agency Booking System"
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyAgencyLink}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-slate-300 hover:text-white"
            >
              <Clipboard className="h-3.5 w-3.5" />
              {copied ? 'Link Copied!' : 'Copy Agency Link'}
            </button>
            <a
              href="/book/ks-agency"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-1.5 text-xs font-black text-white hover:bg-violet-500"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open Live Booking Page
            </a>
          </div>
        }
      >
        <p className="mb-4 text-xs text-slate-400">
          Dedicated, agency-owned KS OS booking system for scheduling client onboarding sessions, platform demos, strategy reviews, and technical audits.
        </p>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-4">
          <button
            type="button"
            onClick={() => setViewMode('MANAGEMENT')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition ${
              viewMode === 'MANAGEMENT'
                ? 'bg-violet-600 text-white'
                : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
            }`}
          >
            <LayoutDashboard className="h-4 w-4" />
            Agency Sessions Management
          </button>
          <button
            type="button"
            onClick={() => setViewMode('PUBLIC_BOOKING_FLOW')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition ${
              viewMode === 'PUBLIC_BOOKING_FLOW'
                ? 'bg-violet-600 text-white'
                : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
            }`}
          >
            <Globe className="h-4 w-4" />
            Interactive Agency Booking Engine
          </button>
        </div>
      </Panel>

      {/* Main View Area */}
      {viewMode === 'PUBLIC_BOOKING_FLOW' ? (
        <div className="rounded-3xl border border-slate-800 bg-slate-950 p-6">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-950/60 px-3 py-1 text-[10px] font-black uppercase text-violet-300 border border-violet-800/50">
                <Sparkles className="h-3 w-3" />
                Native KS OS Agency Engine
              </span>
              <h2 className="mt-2 text-xl font-black text-white">Agency Service Booking Wizard</h2>
              <p className="text-xs text-slate-400">
                Previewing live client booking flow for KS OS Agency services.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setViewMode('MANAGEMENT')}
              className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:text-white"
            >
              ← Back to Management
            </button>
          </div>

          <PublicBookingFlow
            slug="ks-agency"
            preview={true}
            onBookingSuccess={newBooking => {
              const appt: AgencyAppointment = {
                id: newBooking.id,
                reference: newBooking.bookingReference,
                serviceName: newBooking.serviceName,
                staffName: newBooking.staffName || 'Kasim Shah (Agency Director)',
                clientName: newBooking.customerName,
                clientEmail: newBooking.customerEmail,
                clientCompany: 'Client Business',
                startTime: newBooking.startTime,
                endTime: newBooking.endTime,
                status: 'CONFIRMED',
              };
              setBookings(prev => [appt, ...prev]);
            }}
          />
        </div>
      ) : (
        <Panel title={`Scheduled Client Sessions (${bookings.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <tr>
                  <th className="p-3">Reference</th>
                  <th>Client & Company</th>
                  <th>Agency Service</th>
                  <th>Assigned Host</th>
                  <th>Scheduled Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map(b => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
