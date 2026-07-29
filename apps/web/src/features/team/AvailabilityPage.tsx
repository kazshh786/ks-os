import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Clock3, MapPin, Smartphone, UserRound } from 'lucide-react';
import type { BookingChannel, BookingPageResponse } from '@ks-os/contracts';
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

const normaliseSchedule = (member: Member, channel: BookingChannel): ScheduleRow[] => {
  const channelRows = member.bookingChannels.filter(row => row.bookingChannel === channel);
  const persisted = channelRows.length ? channelRows : channel === 'in_shop' ? member.schedule : [];
  return defaultSchedule().map(fallback => {
    const row = persisted.find(item => item.dayOfWeek === fallback.dayOfWeek);
    return row
      ? { dayOfWeek: row.dayOfWeek, enabled: true, startTime: row.startTime.slice(0, 5), endTime: row.endTime.slice(0, 5) }
      : { ...fallback, enabled: false };
  });
};

function WeekEditor({ member, channel, businessHours }: { member: Member; channel: BookingChannel; businessHours?: boolean }) {
  const [schedule, setSchedule] = useState(() => normaliseSchedule(member, channel));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setSchedule(normaliseSchedule(member, channel));
    setState('idle');
  }, [channel, member]);

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
      if (channel === 'in_shop') await provider.updateTeamMemberSchedule(member.id, schedule);
      await provider.updateTeamMemberBookingChannels(member.id, { channel, schedule });
      setState('saved');
    } catch {
      setState('error');
    }
  };

  const channelLabel = channel === 'mobile' ? 'Mobile appointments' : businessHours ? 'Business hours' : 'At the business';
  return <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
      <div className="flex gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">{channel === 'mobile' ? <Smartphone className="h-5 w-5" /> : businessHours ? <Clock3 className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}</span>
        <div>
          <h2 className="font-black text-slate-950">{businessHours ? channelLabel : member.name}</h2>
          <p className="mt-1 text-xs text-slate-500">{businessHours ? `${member.name} · Owner schedule` : `${member.role === 'owner' ? 'Owner' : 'Staff member'} · ${channelLabel}`}</p>
        </div>
      </div>
      <button type="button" onClick={() => void save()} disabled={state === 'saving'} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50">{state === 'saving' ? 'Saving…' : 'Save hours'}</button>
    </div>
    <div className="divide-y divide-slate-100 px-5">
      {schedule.map((row, index) => <div key={row.dayOfWeek} className="grid items-center gap-3 py-3 sm:grid-cols-[8rem_7rem_1fr_1fr]">
        <span className="text-sm font-bold">{days[row.dayOfWeek]}</span>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={row.enabled} onChange={event => update(index, { enabled: event.target.checked })} />{row.enabled ? 'Open' : 'Closed'}</label>
        <label className="text-xs font-bold text-slate-500">Opens<input aria-label={`${days[row.dayOfWeek]} ${channelLabel.toLowerCase()} opens`} type="time" disabled={!row.enabled} value={row.startTime} onChange={event => update(index, { startTime: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-950 disabled:bg-slate-100" /></label>
        <label className="text-xs font-bold text-slate-500">Closes<input aria-label={`${days[row.dayOfWeek]} ${channelLabel.toLowerCase()} closes`} type="time" disabled={!row.enabled} value={row.endTime} onChange={event => update(index, { endTime: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-950 disabled:bg-slate-100" /></label>
      </div>)}
    </div>
    <div className="min-h-10 px-5 pb-4 pt-2 text-sm" aria-live="polite">
      {state === 'saved' && <p className="font-bold text-emerald-700">{channelLabel} availability saved. These times now drive the customer calendar.</p>}
      {state === 'error' && <p role="alert" className="font-bold text-rose-700">Could not save these hours. Check that each closing time is after its opening time and try again.</p>}
    </div>
  </section>;
}

export default function AvailabilityPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [bookingPage, setBookingPage] = useState<BookingPageResponse>();
  const [channel, setChannel] = useState<BookingChannel>('in_shop');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      getDataProvider().listTeam().then(async data => Promise.all(data.members.filter((member: any) => member.accountStatus === 'ACTIVE').map((member: any) => getDataProvider().getTeamMember(member.userId)))),
      getDataProvider().getBookingPageSettings(),
    ])
      .then(([rows, settings]) => {
        if (!active) return;
        setMembers(rows);
        setBookingPage(settings);
        const enabled: BookingChannel[] = settings.bookingRules.enabledBookingChannels?.length
          ? settings.bookingRules.enabledBookingChannels
          : ['in_shop'];
        setChannel(enabled.includes('in_shop') ? 'in_shop' : enabled[0] || 'in_shop');
      })
      .catch(() => { if (active) setError('Availability could not be loaded. Please refresh and try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const owner = members.find(member => member.role === 'owner');
  const staff = members.filter(member => member.role !== 'owner');
  const enabledChannels = bookingPage?.bookingRules.enabledBookingChannels || ['in_shop'];
  const channelEnabled = enabledChannels.includes(channel);

  return <div className="mx-auto max-w-5xl space-y-6">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><h1 className="text-3xl font-black tracking-tight">Manage availability</h1><p className="mt-2 max-w-2xl text-sm text-slate-600">Set separate customer-bookable hours for appointments at the business and mobile visits.</p></div>
      <Link to="/app/settings/booking-page" className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-800">Manage appointment types</Link>
    </header>

    <nav aria-label="Appointment type availability" className="grid gap-3 rounded-2xl border bg-white p-3 sm:grid-cols-2">
      <ChannelButton icon={<MapPin className="h-5 w-5" />} title="At the business" description={enabledChannels.includes('in_shop') ? 'Shown to customers' : 'Turned off'} selected={channel === 'in_shop'} onClick={() => setChannel('in_shop')} />
      <ChannelButton icon={<Smartphone className="h-5 w-5" />} title="Mobile appointments" description={enabledChannels.includes('mobile') ? 'Shown to customers' : 'Turned off'} selected={channel === 'mobile'} onClick={() => setChannel('mobile')} />
    </nav>

    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 font-bold text-rose-800">{error}</div>}
    {loading && <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500">Loading availability…</div>}
    {!loading && !channelEnabled && <section className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-6"><h2 className="font-black text-amber-950">{channel === 'mobile' ? 'Mobile appointments are hidden' : 'Appointments at the business are hidden'}</h2><p className="mt-2 text-sm text-amber-800">These hours are retained, but customers will not see this appointment type until you enable it in Booking page settings.</p><Link to="/app/settings/booking-page" className="mt-4 inline-flex rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-black text-white">Open booking page settings</Link></section>}
    {!loading && channelEnabled && owner && <WeekEditor key={`${owner.id}-${channel}`} member={owner} channel={channel} businessHours />}
    {!loading && channelEnabled && <div className="space-y-4">
      <div><h2 className="text-xl font-black">Team member availability</h2><p className="mt-1 text-sm text-slate-500">Set each team member’s {channel === 'mobile' ? 'mobile-appointment' : 'in-business'} working week.</p></div>
      {staff.map(member => <WeekEditor key={`${member.id}-${channel}`} member={member} channel={channel} />)}
      {!staff.length && <div className="rounded-2xl border border-dashed bg-white p-6 text-sm text-slate-500">No additional staff members yet. The owner remains available above.</div>}
    </div>}
  </div>;
}

function ChannelButton({ icon, title, description, selected, onClick }: { icon: ReactNode; title: string; description: string; selected: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={selected} className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${selected ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100' : 'border-transparent hover:bg-slate-50'}`}><span className={selected ? 'text-indigo-700' : 'text-slate-500'}>{icon}</span><span><span className="block text-sm font-black text-slate-950">{title}</span><span className="mt-0.5 block text-xs text-slate-500">{description}</span></span></button>;
}
