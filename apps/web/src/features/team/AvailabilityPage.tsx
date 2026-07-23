import { useEffect, useState } from 'react';
import { Clock3, UserRound } from 'lucide-react';
import { getDataProvider } from '../../data/data-provider.js';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
type ScheduleRow = { dayOfWeek: number; enabled: boolean; startTime: string; endTime: string };
type Member = { id: string; name: string; role: string; bookingEnabled: boolean; schedule: ScheduleRow[]; bookingChannels: Array<ScheduleRow & { bookingChannel: string }> };

const defaultSchedule = (): ScheduleRow[] => days.map((_, dayOfWeek) => ({
  dayOfWeek,
  enabled: dayOfWeek > 0 && dayOfWeek < 6,
  startTime: '09:00',
  endTime: '18:00',
}));

const normaliseSchedule = (member: Member): ScheduleRow[] => {
  const source = member.bookingChannels.filter(row => row.bookingChannel === 'in_shop');
  const persisted = source.length ? source : member.schedule;
  return defaultSchedule().map(fallback => {
    const row = persisted.find(item => item.dayOfWeek === fallback.dayOfWeek);
    return row ? { dayOfWeek: row.dayOfWeek, enabled: true, startTime: row.startTime.slice(0, 5), endTime: row.endTime.slice(0, 5) } : { ...fallback, enabled: false };
  });
};

function WeekEditor({ member, businessHours }: { member: Member; businessHours?: boolean }) {
  const [schedule, setSchedule] = useState(() => normaliseSchedule(member));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const update = (index: number, patch: Partial<ScheduleRow>) => {
    setState('idle');
    setSchedule(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const save = async () => {
    if (schedule.some(row => row.enabled && row.startTime >= row.endTime)) {
      setState('error');
      return;
    }
    setState('saving');
    try {
      const provider = getDataProvider();
      await provider.updateTeamMemberSchedule(member.id, schedule);
      await Promise.all([
        provider.updateTeamMemberBookingChannels(member.id, { channel: 'in_shop', schedule }),
        provider.updateTeamMemberBookingChannels(member.id, { channel: 'mobile', schedule }),
      ]);
      setState('saved');
    } catch {
      setState('error');
    }
  };

  return <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
      <div className="flex gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">{businessHours ? <Clock3 className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}</span>
        <div>
          <h2 className="font-black text-slate-950">{businessHours ? 'Business hours' : member.name}</h2>
          <p className="mt-1 text-xs text-slate-500">{businessHours ? `${member.name} · Owner schedule` : `${member.role === 'owner' ? 'Owner' : 'Staff member'} · ${member.bookingEnabled ? 'Accepting bookings' : 'Bookings disabled'}`}</p>
        </div>
      </div>
      <button type="button" onClick={() => void save()} disabled={state === 'saving'} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50">{state === 'saving' ? 'Saving…' : 'Save hours'}</button>
    </div>
    <div className="divide-y divide-slate-100 px-5">
      {schedule.map((row, index) => <div key={row.dayOfWeek} className="grid items-center gap-3 py-3 sm:grid-cols-[8rem_7rem_1fr_1fr]">
        <span className="text-sm font-bold">{days[row.dayOfWeek]}</span>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={row.enabled} onChange={event => update(index, { enabled: event.target.checked })} />{row.enabled ? 'Open' : 'Closed'}</label>
        <label className="text-xs font-bold text-slate-500">Opens<input aria-label={`${days[row.dayOfWeek]} opens`} type="time" disabled={!row.enabled} value={row.startTime} onChange={event => update(index, { startTime: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-950 disabled:bg-slate-100" /></label>
        <label className="text-xs font-bold text-slate-500">Closes<input aria-label={`${days[row.dayOfWeek]} closes`} type="time" disabled={!row.enabled} value={row.endTime} onChange={event => update(index, { endTime: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-950 disabled:bg-slate-100" /></label>
      </div>)}
    </div>
    <div className="min-h-10 px-5 pb-4 pt-2 text-sm" aria-live="polite">
      {state === 'saved' && <p className="font-bold text-emerald-700">Availability saved. These times are now available to the booking calendar.</p>}
      {state === 'error' && <p role="alert" className="font-bold text-rose-700">Could not save these hours. Check that each closing time is after its opening time and try again.</p>}
    </div>
  </section>;
}

export default function AvailabilityPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getDataProvider().listTeam()
      .then(async data => Promise.all(data.members.filter((member: any) => member.accountStatus === 'ACTIVE').map((member: any) => getDataProvider().getTeamMember(member.userId))))
      .then(rows => { if (active) setMembers(rows); })
      .catch(() => { if (active) setError('Availability could not be loaded. Please refresh and try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const owner = members.find(member => member.role === 'owner');
  const staff = members.filter(member => member.role !== 'owner');

  return <div className="mx-auto max-w-5xl space-y-6">
    <header>
      <h1 className="text-3xl font-black tracking-tight">Manage availability</h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-600">Set the business’s normal opening times and the working hours customers can book for every team member.</p>
    </header>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 font-bold text-rose-800">{error}</div>}
    {loading && <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500">Loading availability…</div>}
    {!loading && owner && <WeekEditor member={owner} businessHours />}
    {!loading && <div className="space-y-4">
      <div><h2 className="text-xl font-black">Team member availability</h2><p className="mt-1 text-sm text-slate-500">Set each staff member’s customer-bookable working week.</p></div>
      {staff.map(member => <WeekEditor key={member.id} member={member} />)}
      {!staff.length && <div className="rounded-2xl border border-dashed bg-white p-6 text-sm text-slate-500">No additional staff members yet. The owner remains available above.</div>}
    </div>}
  </div>;
}
