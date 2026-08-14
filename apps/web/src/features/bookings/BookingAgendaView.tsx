import type { BookingOperationsItem } from '@ks-os/contracts';
import { BookingStatusBadge } from './BookingStatusBadge.js';

interface BookingAgendaViewProps {
  bookings: BookingOperationsItem[];
  onOpen: (booking: BookingOperationsItem) => void;
}
export function BookingAgendaView({ bookings, onOpen }: BookingAgendaViewProps) {
  return <>
    <div className="space-y-3 md:hidden">
      {bookings.map(booking => <button key={booking.id} type="button" onClick={() => onOpen(booking)} className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-xs font-black text-indigo-700">{new Intl.DateTimeFormat('en-GB', { timeZone: booking.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(booking.startTime))}</p><h3 className="mt-1 break-words text-base font-black text-slate-950">{booking.customer.name}</h3></div><BookingStatusBadge status={booking.status} compact /></div>
        <dl className="mt-3 grid gap-2 text-sm text-slate-600">
          <div><dt className="text-[10px] font-black uppercase tracking-wide text-slate-400">Service</dt><dd className="break-words font-semibold text-slate-800">{booking.service.name}</dd></div>
          <div className="grid grid-cols-2 gap-3"><div><dt className="text-[10px] font-black uppercase tracking-wide text-slate-400">Team member</dt><dd className="break-words">{booking.staff.name}</dd></div><div><dt className="text-[10px] font-black uppercase tracking-wide text-slate-400">Location</dt><dd className="break-words">{booking.location.name || '—'}</dd></div></div>
          <div className="grid grid-cols-2 gap-3"><div><dt className="text-[10px] font-black uppercase tracking-wide text-slate-400">Payment</dt><dd className="break-words">{booking.paymentStatus.replaceAll('_', ' ')}</dd></div><div><dt className="text-[10px] font-black uppercase tracking-wide text-slate-400">Intake</dt><dd className="break-words">{booking.intakeStatus.replaceAll('_', ' ')}</dd></div></div>
        </dl>
        <span className="mt-3 inline-flex min-h-11 items-center font-black text-indigo-700">Open booking</span>
      </button>)}
      {bookings.length === 0 && <div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">No bookings match this view.</div>}
    </div>
    <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block"><table className="w-full min-w-[880px] text-sm"><caption className="sr-only">Bookings in the selected date range</caption><thead><tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><th className="p-3">Date and time</th><th>Customer</th><th>Service</th><th>Staff</th><th>Location</th><th>Status</th><th>Payment</th><th>Intake</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{bookings.map(booking => <tr key={booking.id} className="border-b last:border-0 hover:bg-slate-50"><td className="p-3 font-mono text-xs font-bold">{new Intl.DateTimeFormat('en-GB', { timeZone: booking.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(booking.startTime))}</td><td className="font-bold">{booking.customer.name}</td><td>{booking.service.name}</td><td>{booking.staff.name}</td><td>{booking.location.name || '—'}</td><td><BookingStatusBadge status={booking.status} compact /></td><td>{booking.paymentStatus}</td><td>{booking.intakeStatus.replaceAll('_', ' ')}</td><td className="pr-3 text-right"><button onClick={() => onOpen(booking)} className="min-h-11 rounded-lg border px-3 py-1.5 text-xs font-bold hover:border-indigo-300">Open</button></td></tr>)}{bookings.length === 0 && <tr><td colSpan={9} className="p-10 text-center text-sm text-slate-500">No bookings match this view.</td></tr>}</tbody></table></div>
  </>;
}
