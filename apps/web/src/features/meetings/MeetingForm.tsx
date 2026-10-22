import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { meetingTimeChoices, meetingTimeZones, localMeetingTime, offsetMeetingTime } from './meeting-time';
import { meetingsApi, type MeetingInput, type MeetingsConfig, type ScheduledMeeting } from './meetings.api';
import { callingError } from '../calls/calls.api';

export function MeetingForm({ config, meeting, customerId, saved }: { config: MeetingsConfig; meeting?: ScheduledMeeting; customerId?: string; saved: (value: ScheduledMeeting) => void }) {
  const initialZone = meeting?.timezone || config.timezone || 'Europe/London';
  const [title, setTitle] = useState(meeting?.title || ''), [description, setDescription] = useState(meeting?.description || '');
  const [audience, setAudience] = useState<MeetingInput['audience']>(meeting?.audience || (config.guestEnabled === false ? 'INTERNAL' : 'EXTERNAL_CLIENT')), [type, setType] = useState<MeetingInput['type']>(meeting?.type || 'VIDEO');
  const [zone, setZone] = useState(initialZone), [localStart, setLocalStart] = useState(localMeetingTime(meeting?.scheduledStartAt || new Date(Date.now() + 3600000).toISOString(), initialZone));
  const [duration, setDuration] = useState(meeting ? Math.round((Date.parse(meeting.scheduledEndAt) - Date.parse(meeting.scheduledStartAt)) / 60000) : 30);
  const [occurrence, setOccurrence] = useState(meeting?.scheduledStartAt ? new Date(meeting.scheduledStartAt).toISOString() : '');
  const [hostId, setHostId] = useState(meeting?.hostUserId || config.currentUserId);
  const [customer, setCustomer] = useState(meeting?.customerId || customerId || ''), [appointment, setAppointment] = useState(meeting?.appointmentId || '');
  const [attendees, setAttendees] = useState(meeting?.attendeeIds || []), [cohosts, setCohosts] = useState(meeting?.cohostIds || []);
  const [guestSharing, setGuestSharing] = useState(meeting?.guestScreenShare || false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const choices = useMemo(() => meetingTimeChoices(localStart, zone), [localStart, zone]);
  const chosen = choices.length === 1 ? choices[0].value : choices.some(item => item.value === occurrence) ? occurrence : '';
  const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(value => value !== id) : [...values, id];
  const selectAppointment = (id: string) => {
    setAppointment(id);
    const selected = config.appointments.find(value => value.id === id);
    if (selected) { setCustomer(selected.customerId); setLocalStart(localMeetingTime(selected.startAt, zone)); setOccurrence(new Date(selected.startAt).toISOString()); setDuration(Math.round((Date.parse(selected.endAt) - Date.parse(selected.startAt)) / 60000)); }
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    if (!chosen) { setError(choices.length > 1 ? 'Choose which occurrence of this time you mean.' : 'This local time does not exist in that time zone. Choose another time.'); return; }
    setBusy(true); setError('');
    const input: MeetingInput = { title: title.trim(), description: description.trim(), audience, type, localStart: offsetMeetingTime(localStart, chosen), timezone: zone, durationMinutes: duration, hostUserId: hostId, customerId: customer || null, appointmentId: appointment || null, attendeeIds: [...new Set([...attendees, ...cohosts])].filter(id => id !== hostId), cohostIds: cohosts.filter(id => id !== hostId), guestScreenShare: audience === 'EXTERNAL_CLIENT' && guestSharing };
    try { saved(meeting ? await meetingsApi.edit(meeting.id, input, meeting.version) : await meetingsApi.create(input, requestId.current)); }
    catch (cause) { setError(callingError(cause)); } finally { setBusy(false); }
  }
  return <form className="meetings-form" onSubmit={event => void submit(event)}>
    {error && <p role="alert" className="meetings-error">{error}</p>}
    <fieldset disabled={busy}><legend>Meeting details</legend>
      <label className="meetings-full">Title<input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="Quarterly planning consultation" /></label>
      <label className="meetings-full">Description<textarea rows={3} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} placeholder="What will you cover?" /></label>
      <label>Audience<select value={audience} onChange={event => setAudience(event.target.value as MeetingInput['audience'])}><option value="EXTERNAL_CLIENT" disabled={config.guestEnabled === false}>Client meeting</option><option value="INTERNAL">Internal meeting</option></select></label>
      <label>Call format<select value={type} onChange={event => setType(event.target.value as MeetingInput['type'])}><option value="VIDEO">Video</option><option value="AUDIO">Audio</option></select></label>
      {config.guestEnabled === false && <p role="status" className="meetings-full meetings-muted">Guest invitations are not enabled for this business yet. Internal meetings are available.</p>}
      <label>Host<select value={hostId} required onChange={event => setHostId(event.target.value)}><option value="">Choose a host</option>{config.hosts.map(host => <option value={host.id} key={host.id}>{host.name}</option>)}</select></label>
      <label>Time zone<input list="meeting-timezones" required value={zone} onChange={event => { setZone(event.target.value); setOccurrence(''); }} /><datalist id="meeting-timezones">{[...new Set([initialZone, ...meetingTimeZones])].map(item => <option key={item} value={item} />)}</datalist></label>
      <label>Start date and time<input type="datetime-local" required value={localStart} onChange={event => { setLocalStart(event.target.value); setOccurrence(''); }} /></label>
      <label>Duration (minutes)<input type="number" required min={5} max={480} step={5} value={duration} onChange={event => setDuration(Number(event.target.value))} /></label>
      {choices.length > 1 && <label className="meetings-full">This time occurs twice when the clocks change<select required value={chosen} onChange={event => setOccurrence(event.target.value)}><option value="">Choose a time</option>{choices.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
      {localStart && !choices.length && <p role="status" className="meetings-full">Choose a valid local time and IANA time zone. Times skipped when clocks go forward cannot be scheduled.</p>}
    </fieldset>
    <fieldset disabled={busy}><legend>Keep the relationship connected</legend>
      <label>Customer (optional)<select value={customer} onChange={event => { setCustomer(event.target.value); setAppointment(''); }}><option value="">No linked customer</option>{config.customers.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
      <label>Appointment (optional)<select value={appointment} onChange={event => selectAppointment(event.target.value)}><option value="">No linked appointment</option>{config.appointments.filter(value => !customer || value.customerId === customer).map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      {appointment && <p className="meetings-muted meetings-full">The appointment supplies the meeting time. Review both records when rescheduling; this form does not change the appointment.</p>}
    </fieldset>
    <fieldset disabled={busy} className="meetings-people"><legend>Invite your team</legend><p className="meetings-muted meetings-full">Co-hosts can admit guests and manage this meeting. Workspace access alone does not grant attendance.</p>
      {config.hosts.filter(person => person.id !== hostId).map(person => <div key={person.id} className="meetings-person"><strong>{person.name}</strong><label className="meetings-check"><input type="checkbox" checked={attendees.includes(person.id) || cohosts.includes(person.id)} onChange={() => { setAttendees(values => toggle(values, person.id)); if (cohosts.includes(person.id)) setCohosts(values => values.filter(id => id !== person.id)); }} />Attendee</label><label className="meetings-check"><input type="checkbox" checked={cohosts.includes(person.id)} onChange={() => setCohosts(values => toggle(values, person.id))} />Co-host</label></div>)}
    </fieldset>
    {audience === 'EXTERNAL_CLIENT' && <fieldset disabled={busy}><legend>Guest access</legend><p className="meetings-full">Every guest waits for a host to admit them. Each invitation is for one guest and can be revoked.</p><label className="meetings-check meetings-full"><input type="checkbox" checked={guestSharing} onChange={event => setGuestSharing(event.target.checked)} />Allow admitted guests to share their screens</label></fieldset>}
    <div className="meetings-actions"><button className="meetings-primary" disabled={busy || !config.enabled || !chosen}>{busy ? 'Saving…' : meeting ? 'Save changes' : 'Create meeting'}</button><Link className="meetings-button" to={meeting ? '/app/meetings/' + meeting.id : '/app/meetings'}>Cancel</Link></div>
  </form>;
}
