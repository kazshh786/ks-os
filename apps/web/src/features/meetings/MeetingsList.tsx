import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowUpRight, CalendarDays, Plus, Search, Video } from 'lucide-react';
import { callingError } from '../calls/calls.api';
import { meetingsApi, type MeetingsConfig, type ScheduledMeeting } from './meetings.api';
import { localMeetingTime, meetingDateTime, meetingTimeChoices } from './meeting-time';
import { onMeetingsInvalidated } from './meetings.live';

export const meetingStatus = (status: ScheduledMeeting['status']) => ({ SCHEDULED: 'Scheduled', CREATED: 'Preparing', RINGING: 'Ready to join', ACTIVE: 'In progress', ENDED: 'Completed', CANCELLED: 'Cancelled', FAILED: 'Failed', EXPIRED: 'Expired' })[status];
export function MeetingRows({ meetings }: { meetings: ScheduledMeeting[] }) {
  return <ul className="meetings-list">{meetings.map(meeting => <li key={meeting.id}><span className="meetings-row-icon" aria-hidden="true"><Video size={20}/></span><div className="meetings-row-title"><Link to={'/app/meetings/' + meeting.id}>{meeting.title}</Link><span>{meeting.audience === 'EXTERNAL_CLIENT' ? 'Client meeting' : 'Internal meeting'} · {meeting.organizerName}</span>{meeting.customerName && <span>{meeting.customerReference ? <Link to={'/app/clients/' + encodeURIComponent(meeting.customerReference)}>{meeting.customerName}</Link> : meeting.customerName}</span>}</div><div className="meetings-row-time"><time dateTime={meeting.scheduledStartAt}>{meetingDateTime(meeting.scheduledStartAt, meeting.timezone)}</time><span>{meeting.timezone} · {Math.round((Date.parse(meeting.scheduledEndAt) - Date.parse(meeting.scheduledStartAt)) / 60000)} min</span></div><span className={'meetings-status meetings-status-' + meeting.status.toLowerCase()}>{meetingStatus(meeting.status)}</span><Link className="meetings-open" to={'/app/meetings/' + meeting.id} aria-label={'Open ' + meeting.title}><ArrowUpRight size={19}/></Link></li>)}</ul>;
}
export function MeetingsList({ config }: { config: MeetingsConfig }) {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<ScheduledMeeting[]>([]), [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => onMeetingsInvalidated(refresh), [refresh]);
  const query = new URLSearchParams(params); query.delete('cursor'); query.delete('fromDate'); query.delete('toDate'); query.set('limit', '30');
  const fromDate = params.get('fromDate'), toDate = params.get('toDate');
  if (fromDate) { const from = meetingTimeChoices(fromDate + 'T00:00', config.timezone)[0]; if (from) query.set('from', from.value); }
  if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate) && Number.isFinite(Date.parse(toDate + 'T00:00:00Z'))) { const next = new Date(Date.parse(toDate + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10); const to = meetingTimeChoices(next + 'T00:00', config.timezone)[0]; if (to) query.set('to', to.value); }
  const queryString = query.toString();
  useEffect(() => {
    const controller = new AbortController(); const current = ++sequence.current; setLoading(true); setError(''); setLoadingMore(false);
    const timer = setTimeout(() => void meetingsApi.list(queryString, controller.signal).then(page => { if (!controller.signal.aborted && current === sequence.current) { setItems(page.data); setCursor(page.nextCursor); } }).catch(cause => { if (!controller.signal.aborted) setError(callingError(cause)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }), 200);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [queryString, revision]);
  async function loadMore() {
    if (!cursor || loadingMore) return; const current = sequence.current; setLoadingMore(true); setError('');
    try { const next = new URLSearchParams(queryString); next.set('cursor', cursor); const page = await meetingsApi.list(next.toString()); if (current === sequence.current) { setItems(values => [...new Map([...values, ...page.data].map(value => [value.id, value])).values()]); setCursor(page.nextCursor); } }
    catch (cause) { if (current === sequence.current) setError(callingError(cause)); } finally { if (current === sequence.current) setLoadingMore(false); }
  }
  const filter = (name: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(name, value); else next.delete(name); setParams(next, { replace: true }); };
  function shortcut(status: string, today = false) {
    const next = new URLSearchParams(params); next.delete('from'); next.delete('to'); next.delete('fromDate'); next.delete('toDate');
    if (status) next.set('status', status); else next.delete('status');
    if (today) { const date = localMeetingTime(new Date().toISOString(), config.timezone).slice(0, 10); next.set('fromDate', date); next.set('toDate', date); }
    setParams(next);
  }
  return <>
    <header className="meetings-heading"><div><p className="meetings-eyebrow">{config.branding.name}</p><h1>Meetings</h1><p>Bring your team and customers together.</p></div>{config.canCreate && config.enabled && <Link className="meetings-button meetings-primary" to="/app/meetings/new"><Plus size={18} aria-hidden="true"/>Create meeting</Link>}</header>
    {!config.enabled && <p role="status" className="meetings-notice">Meeting calling is not enabled for this business. Your meeting history remains available.</p>}
    <nav className="meetings-shortcuts" aria-label="Meeting views"><button type="button" onClick={() => shortcut('')}>All meetings</button><button type="button" onClick={() => shortcut('SCHEDULED')}>Upcoming</button><button type="button" onClick={() => shortcut('', true)}>Today</button><button type="button" onClick={() => shortcut('ACTIVE')}>Active</button><button type="button" onClick={() => shortcut('ENDED')}>Completed</button><button type="button" onClick={() => shortcut('CANCELLED')}>Cancelled</button></nav>
    <section className="meetings-filters" aria-label="Filter meetings"><label className="meetings-search"><Search size={17} aria-hidden="true"/><span className="sr-only">Search meetings</span><input type="search" value={params.get('search') || ''} onChange={event => filter('search', event.target.value)} placeholder="Search meeting titles" /></label><label>Host<select value={params.get('hostId') || ''} onChange={event => filter('hostId', event.target.value)}><option value="">All hosts</option>{config.hosts.map(host => <option key={host.id} value={host.id}>{host.name}</option>)}</select></label><label>Customer<select value={params.get('customerId') || ''} onChange={event => { const next = new URLSearchParams(params); next.delete('customerReference'); if (event.target.value) next.set('customerId', event.target.value); else next.delete('customerId'); setParams(next); }}><option value="">All customers</option>{config.customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label>Status<select value={params.get('status') || ''} onChange={event => filter('status', event.target.value)}><option value="">All statuses</option>{(['SCHEDULED', 'RINGING', 'ACTIVE', 'ENDED', 'CANCELLED', 'EXPIRED', 'FAILED'] as const).map(status => <option key={status} value={status}>{meetingStatus(status)}</option>)}</select></label><label>From ({config.timezone})<input type="date" value={fromDate || ''} onChange={event => filter('fromDate', event.target.value)} /></label><label>To<input type="date" value={toDate || ''} onChange={event => filter('toDate', event.target.value)} /></label></section>
    {error && <p role="alert" className="meetings-error">{error} <button type="button" onClick={refresh}>Retry</button></p>}
    <section className="meetings-card" aria-label="Meeting results" aria-busy={loading}>{loading && <p role="status">Loading meetings…</p>}{!loading && !items.length && <div className="meetings-empty"><CalendarDays size={36} aria-hidden="true"/><h2>No meetings to show</h2><p>Try another view or create a meeting for your next conversation.</p></div>}{items.length > 0 && <MeetingRows meetings={items}/>} {cursor && <button type="button" disabled={loading || loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading…' : 'Load more meetings'}</button>}</section>
  </>;
}
