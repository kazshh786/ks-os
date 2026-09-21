import { useState } from 'react';
import { Link } from 'react-router';
import { salesAppointmentSuggestion, type SalesAppointment } from '@ks-os/contracts';

export function AppointmentPreview({ appointment }: { appointment?: SalesAppointment | null }) {
  if (!appointment) return null;
  return <p className="mt-3 truncate text-xs text-slate-600" title={appointment.title}>{appointment.title} · {new Date(appointment.startTime).toLocaleString('en-GB', { timeZone: appointment.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })} · {appointment.status.toLowerCase().replaceAll('_', ' ')}</p>;
}

export function SalesAppointments({ appointments, hasMore, bookingAction, bookingLabel, open, hasQuote, canCreateQuote, onCreateQuote }: {
  appointments: SalesAppointment[]; hasMore: boolean; bookingAction: { route: string } | null;
  bookingLabel: string; open: boolean; hasQuote: boolean; canCreateQuote: boolean; onCreateQuote: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const suggestion = salesAppointmentSuggestion(appointments, open, hasQuote);
  if (!appointments.length && !bookingAction) return null;
  return <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="sales-appointments-title">
    <h2 id="sales-appointments-title" className="font-semibold text-slate-950">Appointments</h2>
    <p className="mt-1 text-sm text-slate-500">Visits and meetings for this sale.</p>
    {bookingAction && <Link className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white" to={bookingAction.route}>{bookingLabel}</Link>}
    <ul className="mt-3 divide-y divide-slate-100">{appointments.slice(0, expanded ? 5 : 2).map(a => <li key={a.reference} className="min-w-0 py-3">
      <p className="break-words font-medium text-slate-900">{a.title}</p>
      <p className="mt-1 text-sm text-slate-600"><time dateTime={a.startTime}>{new Date(a.startTime).toLocaleString('en-GB', { timeZone: a.timezone, dateStyle: 'medium', timeStyle: 'short' })}</time>{a.staffName ? ` · ${a.staffName}` : ''}</p>
      <p className="mt-1 text-xs text-slate-500">{a.status.toLowerCase().replaceAll('_', ' ')}</p>
      <Link to={a.route} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-indigo-700">{a.canReschedule ? 'View or reschedule' : 'View appointment'}</Link>
    </li>)}</ul>
    {!expanded && appointments.length > 2 && <button className="min-h-11 text-sm font-semibold text-indigo-700" onClick={() => setExpanded(true)}>Show more appointments</button>}
    {expanded && hasMore && <p className="text-sm text-slate-500">Showing the five most relevant appointments. Older appointments remain in the customer calendar.</p>}
    {suggestion && <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">{suggestion.label}</p><p className="mt-1">{suggestion.reason}</p>{suggestion.code === 'SALES_BOOKING_COMPLETED' && canCreateQuote && <button onClick={onCreateQuote} className="mt-2 min-h-11 rounded-xl border border-amber-300 px-3 font-semibold">Create quote</button>}</div>}
  </section>;
}
