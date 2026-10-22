import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Video } from 'lucide-react';
import { useAuth } from '../../auth/useAuth';
import { meetingsApi, type ScheduledMeeting } from './meetings.api';
import { meetingDateTime } from './meeting-time';
import { meetingStatus } from './MeetingsList';

function CustomerMeetingList({ reference }: { reference: string }) {
  const [items, setItems] = useState<ScheduledMeeting[] | null>(null), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => { const abort = new AbortController(); void meetingsApi.list(new URLSearchParams({ customerReference: reference, limit: '5' }).toString(), abort.signal).then(page => { if (!abort.signal.aborted) { setItems(page.data); setError(false); } }).catch(() => { if (!abort.signal.aborted) setError(true); }); return () => abort.abort(); }, [reference, retry]);
  return <section className="c360-section" aria-labelledby="customer-meetings"><div className="c360-section-title"><h2 id="customer-meetings">Meetings</h2><Link className="c360-button" to={'/app/meetings?customerReference=' + encodeURIComponent(reference)}>View meetings</Link></div>{error ? <p role="status">Meetings could not be loaded. <button className="c360-button" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : items === null ? <p role="status">Loading meetings…</p> : items.length ? <ul className="c360-now">{items.map(meeting => <li key={meeting.id}><span className="c360-now-icon" aria-hidden="true"><Video size={20}/></span><div className="c360-now-copy"><p><Link to={'/app/meetings/' + meeting.id}>{meeting.title}</Link></p><span>{meetingDateTime(meeting.scheduledStartAt, meeting.timezone)} · {meetingStatus(meeting.status)}</span></div></li>)}</ul> : <p className="c360-muted">No meetings are linked to this customer yet.</p>}</section>;
}
export function CustomerMeetings({ reference }: { reference: string }) {
  const { role, permissions } = useAuth();
  return role === 'owner' || permissions.some(permission => permission === 'MEETINGS_VIEW_OWN' || permission === 'MEETINGS_VIEW_ALL') ? <CustomerMeetingList key={reference} reference={reference}/> : null;
}
