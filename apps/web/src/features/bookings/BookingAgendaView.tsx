import type { BookingOperationsItem } from '@ks-os/contracts';
import { BookingStatusBadge } from './BookingStatusBadge.js';

interface BookingAgendaViewProps {
  bookings: BookingOperationsItem[];
  onOpen: (booking: BookingOperationsItem) => void;
}
export function BookingAgendaView({ bookings, onOpen }: BookingAgendaViewProps) {
  return <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="w-full min-w-[880px] text-sm"><caption className="sr-only">Bookings in the selected date range</caption><thead><tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><th className="p-3">Date and time</th><th>Customer</th><th>Service</th><th>Staff</th><th>Location</th><th>Status</th><th>Payment</th><th>Intake</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{bookings.map(booking => <tr key={booking.id} className="border-b last:border-0 hover:bg-slate-50"><td className="p-3 font-mono text-xs font-bold">{new Intl.DateTimeFormat('en-GB', { timeZone: booking.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(booking.startTime))}</td><td className="font-bold">{booking.customer.name}</td><td>{booking.service.name}</td><td>{booking.staff.name}</td><td>{booking.location.name || '—'}</td><td><BookingStatusBadge status={booking.status} compact /></td><td>{booking.paymentStatus}</td><td>{booking.intakeStatus.replaceAll('_', ' ')}</td><td className="pr-3 text-right"><button onClick={() => onOpen(booking)} className="rounded-lg border px-3 py-1.5 text-xs font-bold hover:border-indigo-300">Open</button></td></tr>)}{bookings.length === 0 && <tr><td colSpan={9} className="p-10 text-center text-sm text-slate-500">No bookings match this view.</td></tr>}</tbody></table></div>;
}
