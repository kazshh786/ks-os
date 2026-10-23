import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, CalendarDays, Pencil, Play, Video } from 'lucide-react';
import { callingError } from '../calls/calls.api';
import type { MeetingMediaApi } from '../calls/MeetingWindow';
import { MeetingBrandHeader } from './MeetingBrand';
import { meetingsApi, mediaMeeting, type MeetingsConfig, type ScheduledMeeting } from './meetings.api';
import { meetingDateTime, localMeetingTime } from './meeting-time';
import { meetingStatus } from './MeetingsList';
import { onMeetingsInvalidated, subscribeMeetings } from './meetings.live';
import { MeetingWaitingRoom } from './MeetingWaitingRoom';
import { MeetingInvitations } from './MeetingInvitations';
import '../calls/calls.css';

const MeetingWindow = lazy(() => import('../calls/MeetingWindow'));
const scheduledMediaApi: MeetingMediaApi = {
  meeting: async id => mediaMeeting(await meetingsApi.meeting(id)),
  join: async (id, requestId) => { const result = await meetingsApi.join(id, requestId); return { ...result, meeting: mediaMeeting(result.meeting) }; },
  leave: meetingsApi.leave, end: async id => mediaMeeting(await meetingsApi.end(id)), remove: meetingsApi.remove,
};
export function useScheduledMeeting(id: string) {
  const [meeting, setMeeting] = useState<ScheduledMeeting | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => onMeetingsInvalidated(refresh), [refresh]);
  useEffect(() => {
    let active = true, pending = false;
    const update = async () => {
      if (pending) return; pending = true;
      try { const value = await meetingsApi.meeting(id); if (active) { setMeeting(value); setError(''); } }
      catch (cause) { if (active) { setError(callingError(cause)); if (cause instanceof Error && 'status' in cause && [401, 403, 404].includes(Number(cause.status))) setMeeting(null); } }
      finally { pending = false; }
    };
    void update(); const timer = setInterval(() => void update(), 15000);
    return () => { active = false; clearInterval(timer); };
  }, [id, revision]);
  return { meeting: meeting?.id === id ? meeting : null, error, refresh, revision };
}
export function MeetingDetail({ id, config }: { id: string; config: MeetingsConfig }) {
  const { meeting, error, refresh, revision } = useScheduledMeeting(id);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [actionError, setActionError] = useState(''), [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'cancel' | 'end' | 'remove'; id?: string; name?: string } | null>(null);
  async function start() {
    if (busy) return; setBusy(true); setActionError('');
    try { const next = await meetingsApi.start(id); refresh(); if (next.canJoin) setOpen(true); else setNotice('Meeting opened. Invited participants can now join.'); }
    catch (cause) { setActionError(callingError(cause)); } finally { setBusy(false); }
  }
  async function apply() {
    if (!confirm || busy) return; setBusy(true); setActionError('');
    try {
      if (confirm.kind === 'remove' && confirm.id) await meetingsApi.remove(id, confirm.id);
      else if (confirm.kind === 'cancel') { await meetingsApi.cancel(id); setOpen(false); }
      else { await meetingsApi.end(id); setOpen(false); }
      setNotice(confirm.kind === 'remove' ? `${confirm.name} was removed.` : confirm.kind === 'cancel' ? 'Meeting cancelled. Invitations and guest access are closed.' : 'Meeting ended for everyone.'); setConfirm(null); refresh();
    } catch (cause) { setActionError(callingError(cause)); } finally { setBusy(false); }
  }
  if (!meeting) return <><Link className="meetings-back" to="/app/meetings"><ArrowLeft size={16}/>Meetings</Link>{error ? <div role="alert" className="meetings-error"><h1>Meeting unavailable</h1><p>{error}</p><button type="button" onClick={refresh}>Retry</button></div> : <p role="status">Loading meeting…</p>}</>;
  const terminal = ['ENDED', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(meeting.status);
  return <>
    <Link className="meetings-back" to="/app/meetings"><ArrowLeft size={16} aria-hidden="true"/>Meetings</Link>
    <header className="meetings-heading"><div><p className="meetings-eyebrow">{meeting.audience === 'EXTERNAL_CLIENT' ? 'Client meeting' : 'Internal meeting'} · {meeting.type === 'VIDEO' ? 'Video' : 'Audio'}</p><h1>{meeting.title}</h1><span className={'meetings-status meetings-status-' + meeting.status.toLowerCase()}>{meetingStatus(meeting.status)}</span></div><div className="meetings-actions">{meeting.canManage && meeting.status === 'SCHEDULED' && <><Link className="meetings-button" to={'/app/meetings/' + id + '/edit'}><Pencil size={17} aria-hidden="true"/>Edit or reschedule</Link><button type="button" className="meetings-primary" disabled={busy || !config.enabled} onClick={() => void start()}><Play size={17} aria-hidden="true"/>Start meeting</button></>}{meeting.canJoin && ['RINGING', 'ACTIVE'].includes(meeting.status) && <button type="button" className="meetings-primary" disabled={!config.enabled} onClick={() => setOpen(true)}><Video size={17} aria-hidden="true"/>Join meeting</button>}</div></header>
    {(error || actionError) && <p role="alert" className="meetings-error">{actionError || error}</p>}{notice && <p role="status" className="meetings-notice">{notice}</p>}
    <div className="meetings-detail-grid"><section className="meetings-card" aria-labelledby="meeting-details"><h2 id="meeting-details"><CalendarDays size={19} aria-hidden="true"/>Meeting details</h2><dl className="meetings-details"><div><dt>When</dt><dd><time dateTime={meeting.scheduledStartAt}>{meetingDateTime(meeting.scheduledStartAt, meeting.timezone)}</time><br/>{meeting.timezone} · {Math.round((Date.parse(meeting.scheduledEndAt) - Date.parse(meeting.scheduledStartAt)) / 60000)} minutes</dd></div><div><dt>Host</dt><dd>{meeting.organizerName}</dd></div>{meeting.customerName && <div><dt>Customer</dt><dd>{meeting.customerReference ? <Link to={'/app/clients/' + encodeURIComponent(meeting.customerReference)}>{meeting.customerName}</Link> : meeting.customerName}</dd></div>}{meeting.appointmentId && <div><dt>Linked appointment</dt><dd><Link to={'/app/bookings?date=' + localMeetingTime(meeting.scheduledStartAt, meeting.timezone).slice(0, 10) + '&search=' + encodeURIComponent(meeting.customerName || '')}>View appointments on this date</Link></dd></div>}<div><dt>Capacity</dt><dd>Up to {config.limits.participants} participants · {config.limits.externalGuests} guests</dd></div><div><dt>Guest screen sharing</dt><dd>{meeting.guestScreenShare ? 'Allowed after admission' : 'Host and team only'}</dd></div></dl>{meeting.description && <p className="meetings-description">{meeting.description}</p>}{meeting.endedAt && <p className="meetings-muted">Ended {meetingDateTime(meeting.endedAt, meeting.timezone)}{meeting.endReason ? ' · ' + meeting.endReason.toLowerCase().replaceAll('_', ' ') : ''}</p>}</section>
      <section className="meetings-card" aria-labelledby="meeting-people"><h2 id="meeting-people">Participants</h2><ul className="meetings-roster">{meeting.participants.map(person => <li key={person.id}><div><strong>{person.name}</strong><span>{person.role.toLowerCase().replaceAll('_', ' ')} · {person.sessionCount > 0 ? 'Connected' : person.invitationState === 'REMOVED' ? 'Removed' : person.leftAt ? 'Left' : 'Invited'}</span></div>{meeting.canManage && !terminal && person.userId !== meeting.hostUserId && person.userId !== config.currentUserId && person.invitationState !== 'REMOVED' && <button type="button" disabled={busy} onClick={() => setConfirm({ kind: 'remove', id: person.id, name: person.name })}>Remove</button>}</li>)}</ul>{!meeting.participants.length && <p className="meetings-muted">Participants will appear here when invited or admitted.</p>}</section></div>
    {meeting.canManage && meeting.audience === 'EXTERNAL_CLIENT' && !terminal && !open && <MeetingWaitingRoom id={id} changed={refresh}/>}
    {meeting.canInvite && meeting.audience === 'EXTERNAL_CLIENT' && !terminal && (config.guestEnabled === false ? <p role="status" className="meetings-notice">Guest invitations are not enabled for this business yet.</p> : <MeetingInvitations meeting={meeting} changed={refresh}/>)}
    {meeting.canManage && !terminal && <div className="meetings-actions meetings-footer-actions"><button type="button" className="meetings-danger" disabled={busy} onClick={() => setConfirm({ kind: meeting.status === 'ACTIVE' ? 'end' : 'cancel' })}>{meeting.status === 'ACTIVE' ? 'End for everyone' : 'Cancel meeting'}</button></div>}
    {confirm && <section className="meetings-confirm" aria-labelledby="meeting-confirm"><h2 id="meeting-confirm">{confirm.kind === 'remove' ? 'Remove ' + confirm.name + '?' : confirm.kind === 'cancel' ? 'Cancel this meeting?' : 'End this meeting for everyone?'}</h2><p>{confirm.kind === 'remove' ? 'Their active connections will end and they will not be able to rejoin using this access.' : 'Invitations and guest admission will close. Connected participants will be disconnected.'}</p><div className="meetings-actions"><button type="button" className="meetings-danger" disabled={busy} onClick={() => void apply()}>{busy ? 'Saving…' : 'Confirm'}</button><button type="button" disabled={busy} onClick={() => setConfirm(null)}>Keep meeting unchanged</button></div></section>}
    {open && !terminal && <Suspense fallback={<p role="status">Opening call controls…</p>}><MeetingWindow id={id} api={scheduledMediaApi} mode="scheduled" subscribe={subscribeMeetings} revision={revision} close={() => { setOpen(false); refresh(); }} displayName={config.hosts.find(person => person.id === config.currentUserId)?.name || 'Team member'} participantLimit={config.limits.participants} brandName={meeting.branding.name} brandHeader={<MeetingBrandHeader brand={meeting.branding}/>} hostPanel={meeting.canManage && meeting.audience === 'EXTERNAL_CLIENT' ? <MeetingWaitingRoom id={id} changed={refresh}/> : undefined}/></Suspense>}
  </>;
}
