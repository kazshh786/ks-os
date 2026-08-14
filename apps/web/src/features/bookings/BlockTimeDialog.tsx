import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { fromZonedTime } from 'date-fns-tz';
import type { Staff } from '../../data/types.js';
import { getDataProvider } from '../../data/data-provider.js';
import { useModalDialog } from '../../components/overlays/useModalDialog.js';

export function BlockTimeDialog({ open, timezone, staff, initialDate, onClose, onCreated }: {
  open: boolean; timezone: string; staff: Staff[]; initialDate: string; onClose: () => void; onCreated: () => void;
}) {
  const dialogRef = useModalDialog<HTMLElement>(open, onClose);
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setDate(initialDate);
    setStaffId(current => current || staff[0]?.id || '');
    setError('');
  }, [initialDate, open, staff]);
  if (!open) return null;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await getDataProvider().createBlockedTime({ staffId, startTime: fromZonedTime(`${date}T${time}:00`, timezone).toISOString(), durationMinutes, reason });
      onCreated(); onClose(); setReason('');
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'SLOT_UNAVAILABLE' ? 'That time overlaps another booking or blocked period.' : cause instanceof Error ? cause.message : 'Could not block this time.');
    } finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-6" data-calendar-dialog-layer="true" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="block-time-title" tabIndex={-1} className="flex max-h-dvh w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[90dvh] sm:rounded-3xl">
      <header className="flex shrink-0 justify-between gap-4 border-b p-4 sm:p-6"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Calendar availability</p><h2 id="block-time-title" className="mt-1 text-xl font-black sm:text-2xl">Block out time</h2><p className="mt-1 text-sm text-slate-500">Customers and staff cannot book over this period.</p></div><button data-dialog-initial-focus type="button" onClick={onClose} aria-label="Close block time" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border"><X className="h-5 w-5" /></button></header>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2 sm:p-6">
        <label className="text-sm font-semibold sm:col-span-2">Team member<select required value={staffId} onChange={event => setStaffId(event.target.value)} className="mt-1 w-full rounded-xl border bg-white p-3">{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label className="text-sm font-semibold">Date<input required type="date" value={date} onChange={event => setDate(event.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label>
        <label className="text-sm font-semibold">Start time<input required type="time" value={time} onChange={event => setTime(event.target.value)} className="mt-1 w-full rounded-xl border p-3" /></label>
        <label className="text-sm font-semibold">Duration<select value={durationMinutes} onChange={event => setDurationMinutes(Number(event.target.value))} className="mt-1 w-full rounded-xl border bg-white p-3"><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>1 hour</option><option value={90}>1.5 hours</option><option value={120}>2 hours</option><option value={240}>4 hours</option><option value={480}>All day (8 hours)</option></select></label>
        <label className="text-sm font-semibold">Reason<input required value={reason} onChange={event => setReason(event.target.value)} placeholder="Lunch, meeting, unavailable…" className="mt-1 w-full rounded-xl border p-3" /></label>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800 sm:col-span-2">{error}</p>}
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-3 border-t bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex sm:justify-end sm:px-6"><button type="button" onClick={onClose} className="min-h-11 rounded-xl border px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={saving || !staff.length} className="min-h-11 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Blocking time…' : 'Block time'}</button></div>
      </form>
    </section>
  </div>;
}
