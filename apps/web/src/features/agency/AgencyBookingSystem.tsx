import React, { useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronRight, Clock, Plus, User, Video } from 'lucide-react';
import { Panel, Status } from './AgencyPages';

export interface AgencyService {
  id: string;
  name: string;
  duration: number;
  priceMinor: number;
  description: string;
  category: 'onboarding' | 'demo' | 'strategy' | 'support';
}

export interface AgencyStaff {
  id: string;
  name: string;
  role: string;
  email: string;
  avatarUrl?: string;
}

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

export const AGENCY_SERVICES: AgencyService[] = [
  {
    id: 'demo',
    name: 'Platform Demo & Tour',
    duration: 30,
    priceMinor: 0,
    description: 'Guided walkthrough of the KS OS platform capabilities and tenant workflows.',
    category: 'demo',
  },
  {
    id: 'onboarding',
    name: 'Onboarding & Business Setup',
    duration: 45,
    priceMinor: 0,
    description: 'Dedicated setup session to configure brand, services, staff, and domain routing.',
    category: 'onboarding',
  },
  {
    id: 'strategy',
    name: 'Growth Strategy & Funnel Review',
    duration: 60,
    priceMinor: 9900,
    description: 'Deep dive review into client acquisition, booking conversion, and retention automations.',
    category: 'strategy',
  },
  {
    id: 'support',
    name: 'Technical Support & Integration Audit',
    duration: 45,
    priceMinor: 0,
    description: 'Audit database migrations, Stripe Connect status, and API integration webhooks.',
    category: 'support',
  },
];

export const AGENCY_STAFF: AgencyStaff[] = [
  { id: 'kasim', name: 'Kasim Shah', role: 'Agency Director', email: 'kasim@kasimshah.com' },
  { id: 'sarah', name: 'Sarah Jenkins', role: 'Onboarding Specialist', email: 'sarah@ksos.local' },
  { id: 'david', name: 'David Miller', role: 'Technical Lead', email: 'david@ksos.local' },
];

const MOCK_AGENCY_BOOKINGS: AgencyAppointment[] = [
  {
    id: '1',
    reference: 'AGY-10928',
    serviceName: 'Onboarding & Business Setup',
    staffName: 'Kasim Shah',
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
    staffName: 'Sarah Jenkins',
    clientName: 'Prospect Beauty',
    clientEmail: 'contact@prospectbeauty.local',
    clientCompany: 'Prospect Beauty',
    startTime: '2026-07-24T14:00:00.000Z',
    endTime: '2026-07-24T14:30:00.000Z',
    status: 'CONFIRMED',
  },
];

export function AgencyBookingSystemPage() {
  const [bookings, setBookings] = useState<AgencyAppointment[]>(MOCK_AGENCY_BOOKINGS);
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState(0);
  const [selectedServiceId, setSelectedServiceId] = useState<string>('onboarding');
  const [selectedStaffId, setSelectedStaffId] = useState<string>('kasim');
  const [selectedDate, setSelectedDate] = useState<string>('2026-07-25');
  const [selectedSlot, setSelectedSlot] = useState<string>('11:00');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [notes, setNotes] = useState('');
  const [success, setSuccess] = useState<AgencyAppointment | null>(null);

  const selectedService = AGENCY_SERVICES.find(s => s.id === selectedServiceId) || AGENCY_SERVICES[0];
  const selectedStaff = AGENCY_STAFF.find(s => s.id === selectedStaffId) || AGENCY_STAFF[0];

  const handleCreateBooking = (e: React.FormEvent) => {
    e.preventDefault();
    const newBooking: AgencyAppointment = {
      id: String(Date.now()),
      reference: `AGY-${Math.floor(10000 + Math.random() * 90000)}`,
      serviceName: selectedService.name,
      staffName: selectedStaffId === 'any' ? 'Anyone available (Kasim Shah)' : selectedStaff.name,
      clientName,
      clientEmail,
      clientCompany: clientCompany || 'New Business',
      startTime: `${selectedDate}T${selectedSlot}:00.000Z`,
      endTime: `${selectedDate}T${selectedSlot}:00.000Z`,
      status: 'CONFIRMED',
      notes,
    };
    setBookings(prev => [newBooking, ...prev]);
    setSuccess(newBooking);
  };

  const resetForm = () => {
    setShowModal(false);
    setStep(0);
    setSuccess(null);
    setClientName('');
    setClientEmail('');
    setClientCompany('');
    setNotes('');
  };

  return (
    <div className="space-y-6">
      <Panel
        title="Agency Booking System"
        action={
          <button
            type="button"
            onClick={() => {
              resetForm();
              setShowModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-black text-white hover:bg-violet-700"
          >
            <Plus className="h-4 w-4" />
            Book client session
          </button>
        }
      >
        <p className="mb-4 text-xs text-slate-400">
          Agency-owned booking system to schedule client demos, onboarding calls, strategy sessions, and support audits.
        </p>

        <div className="grid gap-4 md:grid-cols-4 mb-6">
          {AGENCY_SERVICES.map(service => (
            <div
              key={service.id}
              className="rounded-xl border border-slate-800 bg-slate-950 p-4 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase text-violet-400">
                    {service.category}
                  </span>
                  <span className="text-xs font-bold text-slate-300">
                    {service.priceMinor === 0 ? 'Free' : `£${service.priceMinor / 100}`}
                  </span>
                </div>
                <h3 className="mt-2 text-sm font-bold text-white">{service.name}</h3>
                <p className="mt-1 text-xs text-slate-400">{service.description}</p>
              </div>
              <div className="mt-3 flex items-center gap-1 text-[11px] font-bold text-slate-500">
                <Clock className="h-3.5 w-3.5" />
                {service.duration} mins
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4">
            Scheduled Client Sessions ({bookings.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <tr>
                  <th className="p-3">Reference</th>
                  <th>Client</th>
                  <th>Session</th>
                  <th>Host</th>
                  <th>Date & Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map(b => (
                  <tr key={b.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-900/50">
                    <td className="p-3 font-mono text-xs font-bold text-violet-300">{b.reference}</td>
                    <td>
                      <strong className="text-white">{b.clientName}</strong>
                      <span className="block text-xs text-slate-500">{b.clientCompany} ({b.clientEmail})</span>
                    </td>
                    <td className="font-medium text-slate-200">{b.serviceName}</td>
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
        </div>
      </Panel>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl">
            {success ? (
              <div className="text-center py-6">
                <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
                <h3 className="mt-4 text-2xl font-black">Agency Session Scheduled</h3>
                <p className="mt-2 text-sm text-slate-400">
                  Confirmation and calendar link created for {success.clientName} ({success.clientCompany}).
                </p>
                <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-left text-xs space-y-2 max-w-md mx-auto">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Booking Reference</span>
                    <span className="font-mono font-bold text-violet-300">{success.reference}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Service</span>
                    <span className="font-bold text-white">{success.serviceName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Host</span>
                    <span className="font-bold text-white">{success.staffName}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={resetForm}
                  className="mt-6 rounded-xl bg-violet-600 px-6 py-2.5 text-xs font-black text-white"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateBooking} className="space-y-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-lg font-black">Book Agency Client Session</h3>
                  <button type="button" onClick={() => setShowModal(false)} className="text-xs text-slate-400 hover:text-white">
                    Cancel
                  </button>
                </div>

                {step === 0 && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-2">Select Agency Service</label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {AGENCY_SERVICES.map(s => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setSelectedServiceId(s.id)}
                            className={`rounded-xl border p-3 text-left transition ${
                              selectedServiceId === s.id
                                ? 'border-violet-500 bg-violet-950/40 text-white'
                                : 'border-slate-800 bg-slate-950 text-slate-400'
                            }`}
                          >
                            <p className="font-bold text-sm text-white">{s.name}</p>
                            <p className="text-xs text-slate-400 mt-1">{s.duration} mins · {s.priceMinor === 0 ? 'Free' : `£${s.priceMinor / 100}`}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-2">Select Agency Host</label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {AGENCY_STAFF.map(st => (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => setSelectedStaffId(st.id)}
                            className={`rounded-xl border p-3 text-left transition ${
                              selectedStaffId === st.id
                                ? 'border-violet-500 bg-violet-950/40 text-white'
                                : 'border-slate-800 bg-slate-950 text-slate-400'
                            }`}
                          >
                            <p className="font-bold text-sm text-white">{st.name}</p>
                            <p className="text-xs text-slate-400">{st.role}</p>
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setSelectedStaffId('any')}
                          className={`rounded-xl border p-3 text-left transition ${
                            selectedStaffId === 'any'
                              ? 'border-violet-500 bg-violet-950/40 text-white'
                              : 'border-slate-800 bg-slate-950 text-slate-400'
                          }`}
                        >
                          <p className="font-bold text-sm text-white">Anyone available</p>
                          <p className="text-xs text-slate-400">First available host slot</p>
                        </button>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-black text-white"
                      >
                        Choose date & time
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs text-slate-400">
                        Date
                        <input
                          type="date"
                          value={selectedDate}
                          onChange={e => setSelectedDate(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        Time slot
                        <select
                          value={selectedSlot}
                          onChange={e => setSelectedSlot(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white text-sm"
                        >
                          {['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'].map(t => (
                            <option key={t} value={t}>{t} GMT</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs text-slate-400">
                        Client contact name
                        <input
                          required
                          value={clientName}
                          onChange={e => setClientName(e.target.value)}
                          placeholder="e.g. Jane Doe"
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        Client contact email
                        <input
                          required
                          type="email"
                          value={clientEmail}
                          onChange={e => setClientEmail(e.target.value)}
                          placeholder="jane@clientbusiness.com"
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white text-sm"
                        />
                      </label>
                    </div>

                    <label className="block text-xs text-slate-400">
                      Client business / company name
                      <input
                        required
                        value={clientCompany}
                        onChange={e => setClientCompany(e.target.value)}
                        placeholder="e.g. Apex Salon"
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white text-sm"
                      />
                    </label>

                    <label className="block text-xs text-slate-400">
                      Session notes (optional)
                      <textarea
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        rows={2}
                        placeholder="Topics or special requests..."
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white text-sm"
                      />
                    </label>

                    <div className="flex justify-between">
                      <button
                        type="button"
                        onClick={() => setStep(0)}
                        className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300"
                      >
                        Back
                      </button>
                      <button
                        type="submit"
                        className="rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-black text-white hover:bg-emerald-500"
                      >
                        Confirm booking
                      </button>
                    </div>
                  </div>
                )}
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
