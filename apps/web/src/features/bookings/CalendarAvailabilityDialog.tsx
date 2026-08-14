import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarClock, Clock3, MapPin, Smartphone, Trash2, X } from 'lucide-react';
import type { BookingChannel, CustomerBookingPolicySettings } from '@ks-os/contracts';
import { fetchWithAuth } from '../../api/client.js';
import { getDataProvider } from '../../data/data-provider.js';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const customerBookingPolicyEndpoint = '/api/v1/settings/booking/customer-management';

async function requestCustomerBookingPolicy(init?: RequestInit) {
  const response = await fetchWithAuth(customerBookingPolicyEndpoint, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || body.error?.code || 'Availability setting could not be saved.');
  return body.data as CustomerBookingPolicySettings;
}
type ScheduleRow = { dayOfWeek: number; enabled: boolean; startTime: string; endTime: string };
type BookingOverride = {
  id?: string;
  date: string;
  channel: BookingChannel;
  enabled: boolean;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
};
type Member = {
  id: string;
  name: string;
  role: string;
  schedule: ScheduleRow[];
  bookingChannels: Array<ScheduleRow & { bookingChannel: BookingChannel }>;
  bookingOverrides: BookingOverride[];
};
type MemberSummary = { userId: string; name: string; role: string; accountStatus: string };
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const defaultSchedule = (): ScheduleRow[] => days.map((_, dayOfWeek) => ({
  dayOfWeek,
  enabled: dayOfWeek > 0 && dayOfWeek < 6,
  startTime: '09:00',
  endTime: '17:00',
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

export function CalendarAvailabilityDialog({ open, initialDate, onClose }: { open: boolean; initialDate: string; onClose: () => void }) {
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [memberId, setMemberId] = useState('');
  const [member, setMember] = useState<Member | null>(null);
  const [channel, setChannel] = useState<BookingChannel>('in_shop');
  const [tab, setTab] = useState<'weekly' | 'overrides'>('weekly');
  const [schedule, setSchedule] = useState<ScheduleRow[]>(defaultSchedule());
  const [enabledChannels, setEnabledChannels] = useState<BookingChannel[]>(['in_shop']);
  const [allowAppointmentsPastClosingTime, setAllowAppointmentsPastClosingTime] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [weeklyState, setWeeklyState] = useState<SaveState>('idle');
  const [overrideState, setOverrideState] = useState<SaveState>('idle');
  const [overrideDraft, setOverrideDraft] = useState({
    date: initialDate,
    enabled: true,
    startTime: '09:00',
    endTime: '17:00',
    note: '',
  });

  useEffect(() => {
    if (!open) return;
    setOverrideDraft(current => ({ ...current, date: initialDate }));
    setLoading(true);
    setError('');
    Promise.all([getDataProvider().listTeam(), getDataProvider().getBookingPageSettings(), requestCustomerBookingPolicy()])
      .then(([team, settings, bookingPolicy]) => {
        const activeMembers = (team.members as MemberSummary[]).filter(row => row.accountStatus === 'ACTIVE');
        setMembers(activeMembers);
        const owner = activeMembers.find(row => row.role === 'owner');
        setMemberId(current => current && activeMembers.some(row => row.userId === current) ? current : owner?.userId || activeMembers[0]?.userId || '');
        setEnabledChannels(settings.bookingRules.enabledBookingChannels?.length ? settings.bookingRules.enabledBookingChannels : ['in_shop']);
        setAllowAppointmentsPastClosingTime(bookingPolicy.allowAppointmentsPastClosingTime);
      })
      .catch(() => setError('Availability could not be loaded. Please try again.'))
      .finally(() => setLoading(false));
  }, [initialDate, open]);

  useEffect(() => {
    if (!open || !memberId) return;
    setLoading(true);
    setError('');
    getDataProvider().getTeamMember(memberId)
      .then((row: Member) => setMember(row))
      .catch(() => setError('This team member’s availability could not be loaded.'))
      .finally(() => setLoading(false));
  }, [memberId, open]);

  useEffect(() => {
    if (!member) return;
    setSchedule(normaliseSchedule(member, channel));
    setWeeklyState('idle');
    setOverrideState('idle');
  }, [channel, member]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  const channelOverrides = useMemo(() => (member?.bookingOverrides || [])
    .filter(item => item.channel === channel)
    .sort((a, b) => a.date.localeCompare(b.date)), [channel, member]);

  if (!open) return null;

  const updateSchedule = (index: number, patch: Partial<ScheduleRow>) => {
    setWeeklyState('idle');
    setSchedule(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const saveWeekly = async () => {
    if (!member || schedule.some(row => row.enabled && row.startTime >= row.endTime)) {
      setWeeklyState('error');
      return;
    }
    setWeeklyState('saving');
    try {
      if (channel === 'in_shop') await getDataProvider().updateTeamMemberSchedule(member.id, schedule);
      const updated = await getDataProvider().updateTeamMemberBookingChannels(member.id, { channel, schedule });
      const bookingPolicy = await requestCustomerBookingPolicy({
        method: 'PATCH',
        body: JSON.stringify({ allowAppointmentsPastClosingTime }),
      });
      setMember(updated);
      setAllowAppointmentsPastClosingTime(bookingPolicy.allowAppointmentsPastClosingTime);
      setWeeklyState('saved');
    } catch {
      setWeeklyState('error');
    }
  };

  const persistOverrides = async (overrides: BookingOverride[]) => {
    if (!member) return;
    const response = await fetchWithAuth(`/api/v1/team/${member.id}/booking-schedule-overrides`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides: overrides.map(item => ({
        date: item.date,
        channel: item.channel,
        enabled: item.enabled,
        startTime: item.enabled ? item.startTime?.slice(0, 5) : null,
        endTime: item.enabled ? item.endTime?.slice(0, 5) : null,
        note: item.note || null,
      })) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || body.error?.code || 'Override could not be saved.');
    setMember(body.data);
  };

  const saveOverride = async () => {
    if (!member || (overrideDraft.enabled && (!overrideDraft.startTime || !overrideDraft.endTime || overrideDraft.startTime >= overrideDraft.endTime))) {
      setOverrideState('error');
      return;
    }
    setOverrideState('saving');
    const nextOverride: BookingOverride = {
      date: overrideDraft.date,
      channel,
      enabled: overrideDraft.enabled,
      startTime: overrideDraft.enabled ? overrideDraft.startTime : null,
      endTime: overrideDraft.enabled ? overrideDraft.endTime : null,
      note: overrideDraft.note.trim() || null,
    };
    const existing = member.bookingOverrides || [];
    const next = [...existing.filter(item => !(item.date === nextOverride.date && item.channel === channel)), nextOverride];
    try {
      await persistOverrides(next);
      setOverrideState('saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Override could not be saved.');
      setOverrideState('error');
    }
  };

  const removeOverride = async (target: BookingOverride) => {
    if (!member) return;
    setOverrideState('saving');
    try {
      await persistOverrides((member.bookingOverrides || []).filter(item => !(item.date === target.date && item.channel === target.channel)));
      setOverrideState('saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Override could not be removed.');
      setOverrideState('error');
    }
  };

  const channelLabel = channel === 'mobile' ? 'Mobile bookings' : 'At the business';
  const channelEnabled = enabledChannels.includes(channel);

  return <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="availability-dialog-title" className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
        <div className="flex gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700"><CalendarClock className="h-5 w-5" /></span>
          <div><h2 id="availability-dialog-title" className="text-xl font-black text-slate-950">Availability and booking hours</h2><p className="mt-1 text-sm text-slate-500">Set the normal week, mobile hours and one-off changes without leaving the calendar.</p></div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close availability" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
      </header>

      <div className="overflow-y-auto p-5 sm:p-6">
        {error && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</div>}
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="text-xs font-black uppercase tracking-wide text-slate-500">Team member<select value={memberId} onChange={event => setMemberId(event.target.value)} className="mt-1 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-950">{members.map(row => <option key={row.userId} value={row.userId}>{row.name} · {row.role === 'owner' ? 'Owner' : 'Staff'}</option>)}</select></label>
          <div role="group" aria-label="Booking location type" className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
            <ChannelButton selected={channel === 'in_shop'} icon={<MapPin className="h-4 w-4" />} label="At business" onClick={() => setChannel('in_shop')} />
            <ChannelButton selected={channel === 'mobile'} icon={<Smartphone className="h-4 w-4" />} label="Mobile" onClick={() => setChannel('mobile')} />
          </div>
        </div>

        {!channelEnabled && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>{channelLabel} is currently hidden from customers.</strong> You can prepare the hours now, then enable this booking type in Booking Page settings.</div>}
        {channel === 'mobile' && <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900"><strong>Out-of-hours mobile visits are supported.</strong> These times are independent from the salon’s in-shop opening hours, so evening or occasional mobile appointments can be offered safely.</div>}

        <div className="mt-5 flex gap-2 border-b border-slate-200" role="tablist" aria-label="Availability settings">
          <button type="button" role="tab" aria-selected={tab === 'weekly'} onClick={() => setTab('weekly')} className={`border-b-2 px-3 py-2 text-sm font-black ${tab === 'weekly' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}`}>Normal weekly hours</button>
          <button type="button" role="tab" aria-selected={tab === 'overrides'} onClick={() => setTab('overrides')} className={`border-b-2 px-3 py-2 text-sm font-black ${tab === 'overrides' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}`}>Date overrides</button>
        </div>

        {loading && <p className="py-8 text-center text-sm text-slate-500">Loading availability…</p>}
        {!loading && member && tab === 'weekly' && <div className="mt-4">
          <label className="mb-4 flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4">
            <span><span className="block text-sm font-black text-slate-950">Allow appointments to finish after closing time</span><span className="mt-1 block max-w-2xl text-xs leading-5 text-slate-600">Appointments must still start before the closing time shown below, but their service duration and buffer may continue afterwards. This applies across the business.</span></span>
            <input aria-label="Allow appointments to finish after closing time" type="checkbox" checked={allowAppointmentsPastClosingTime} onChange={event => { setAllowAppointmentsPastClosingTime(event.target.checked); setWeeklyState('idle'); }} className="mt-0.5 h-5 w-5 shrink-0" />
          </label>
          <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 px-4">
            {schedule.map((row, index) => <div key={row.dayOfWeek} className="grid items-center gap-3 py-3 sm:grid-cols-[8rem_7rem_1fr_1fr]">
              <span className="text-sm font-black text-slate-900">{days[row.dayOfWeek]}</span>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={row.enabled} onChange={event => updateSchedule(index, { enabled: event.target.checked })} />{row.enabled ? 'Available' : 'Unavailable'}</label>
              <label className="text-xs font-bold text-slate-500">From<input aria-label={`${days[row.dayOfWeek]} ${channelLabel.toLowerCase()} starts`} type="time" disabled={!row.enabled} value={row.startTime} onChange={event => updateSchedule(index, { startTime: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-950 disabled:bg-slate-100" /></label>
              <label className="text-xs font-bold text-slate-500">Until<input aria-label={`${days[row.dayOfWeek]} ${channelLabel.toLowerCase()} ends`} type="time" disabled={!row.enabled} value={row.endTime} onChange={event => updateSchedule(index, { endTime: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-950 disabled:bg-slate-100" /></label>
            </div>)}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div aria-live="polite" className="text-sm">{weeklyState === 'saved' && <span className="font-bold text-emerald-700">Weekly {channelLabel.toLowerCase()} hours saved.</span>}{weeklyState === 'error' && <span role="alert" className="font-bold text-rose-700">Availability could not be saved. Check the times and try again.</span>}</div>
            <button type="button" onClick={() => void saveWeekly()} disabled={weeklyState === 'saving'} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50">{weeklyState === 'saving' ? 'Saving…' : 'Save weekly hours'}</button>
          </div>
        </div>}

        {!loading && member && tab === 'overrides' && <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="rounded-2xl border border-slate-200 p-4">
            <div className="flex gap-3"><Clock3 className="mt-0.5 h-5 w-5 text-indigo-600" /><div><h3 className="font-black text-slate-950">Override one date</h3><p className="mt-1 text-sm text-slate-500">This replaces the normal {channelLabel.toLowerCase()} rule for this date only.</p></div></div>
            <div className="mt-4 space-y-4">
              <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Date<input type="date" value={overrideDraft.date} onChange={event => setOverrideDraft(current => ({ ...current, date: event.target.value }))} className="mt-1 block min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-950" /></label>
              <div role="group" aria-label="Override type" className="grid grid-cols-2 gap-2">
                <button type="button" aria-pressed={overrideDraft.enabled} onClick={() => setOverrideDraft(current => ({ ...current, enabled: true }))} className={`rounded-xl border px-3 py-3 text-sm font-black ${overrideDraft.enabled ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}>Work this date</button>
                <button type="button" aria-pressed={!overrideDraft.enabled} onClick={() => setOverrideDraft(current => ({ ...current, enabled: false }))} className={`rounded-xl border px-3 py-3 text-sm font-black ${!overrideDraft.enabled ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-slate-200 text-slate-600'}`}>Take this date off</button>
              </div>
              {overrideDraft.enabled && <div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-500">From<input type="time" value={overrideDraft.startTime} onChange={event => setOverrideDraft(current => ({ ...current, startTime: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-300 p-2.5 text-sm text-slate-950" /></label><label className="text-xs font-bold text-slate-500">Until<input type="time" value={overrideDraft.endTime} onChange={event => setOverrideDraft(current => ({ ...current, endTime: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-300 p-2.5 text-sm text-slate-950" /></label></div>}
              <label className="block text-xs font-bold text-slate-500">Reason or note <span className="font-normal">(optional)</span><input value={overrideDraft.note} maxLength={160} onChange={event => setOverrideDraft(current => ({ ...current, note: event.target.value }))} placeholder="e.g. Working Monday instead of Thursday" className="mt-1 block min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-950" /></label>
              <button type="button" onClick={() => void saveOverride()} disabled={overrideState === 'saving'} className="w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">{overrideState === 'saving' ? 'Saving…' : 'Save date override'}</button>
              <div aria-live="polite" className="min-h-5 text-sm">{overrideState === 'saved' && <span className="font-bold text-emerald-700">Date overrides updated.</span>}{overrideState === 'error' && <span role="alert" className="font-bold text-rose-700">Check the date and times, then try again.</span>}</div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 p-4">
            <h3 className="font-black text-slate-950">Scheduled exceptions</h3><p className="mt-1 text-sm text-slate-500">Overrides take priority over the normal weekly hours.</p>
            <div className="mt-4 space-y-2">
              {channelOverrides.map(item => <article key={`${item.channel}-${item.date}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                <div><p className="text-sm font-black text-slate-950">{new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${item.date}T12:00:00Z`))}</p><p className={`mt-1 text-xs font-bold ${item.enabled ? 'text-emerald-700' : 'text-rose-700'}`}>{item.enabled ? `${item.startTime?.slice(0, 5)}–${item.endTime?.slice(0, 5)} · Available` : 'Unavailable all day'}</p>{item.note && <p className="mt-1 text-xs text-slate-500">{item.note}</p>}</div>
                <button type="button" onClick={() => void removeOverride(item)} aria-label={`Remove override for ${item.date}`} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
              </article>)}
              {!channelOverrides.length && <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No one-off changes for {channelLabel.toLowerCase()} yet.</div>}
            </div>
          </section>
        </div>}
      </div>
    </section>
  </div>;
}

function ChannelButton({ selected, icon, label, onClick }: { selected: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-black ${selected ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-950'}`}>{icon}{label}</button>;
}
