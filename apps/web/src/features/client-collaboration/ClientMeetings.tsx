import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { collaborationApi, clientMeetingApi, type ClientMeeting } from './collaboration.api';
import { usePortalLive } from './ClientPortal';
import { meetingDateTime } from '../meetings/meeting-time';
import type { GuestCredential, GuestSession } from '../meetings/meetings.api';
import { callingError } from '../calls/calls.api';

const AdmittedCall = lazy(() => import('../meetings/GuestMeetingPage').then(value => ({ default: value.GuestCall })));
function MeetingAdmission({ meeting, close }: { meeting: ClientMeeting; close: () => void }) {
  const { relationship, displayName, subscribe } = usePortalLive();
  const [credential, setCredential] = useState<GuestCredential | null>(null);
  const [session, setSession] = useState<GuestSession | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const requestId = useRef(crypto.randomUUID()); const mounted = useRef(true);
  const gateway = useMemo(() => credential ? clientMeetingApi(relationship.id, meeting.id, credential) : null, [relationship.id, meeting.id, credential]);
  const latestGateway = useRef(gateway); latestGateway.current = gateway;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (latestGateway.current) void latestGateway.current.leave().catch(() => undefined); }; }, []);
  useEffect(() => subscribe(event => { if (event.meetingId === meeting.id || event.resourceId === meeting.id) setRevision(value => value + 1); }), [subscribe, meeting.id]);
  useEffect(() => {
    if (!gateway) return; let active = true, pending = false;
    const update = async () => { if (pending) return; pending = true; try { const value = await gateway.session(); if (active) { setSession(value); setError(''); } } catch { if (active) { setSession(null); setCredential(null); setError('Meeting access is no longer available. Please contact the business.'); } } finally { pending = false; } };
    void update(); const timer = setInterval(() => void update(), 2500); return () => { active = false; clearInterval(timer); };
  }, [gateway, revision]);
  async function request() {
    setBusy(true); setError('');
    try { const value = await collaborationApi.requestMeeting(relationship.id, meeting.id, meeting.conversationId, requestId.current); if (!value.csrfToken) throw new Error('The meeting could not establish a secure session.'); const next = { sessionId: value.sessionId, csrfToken: value.csrfToken, requestId: requestId.current }; if (!mounted.current) { void clientMeetingApi(relationship.id, meeting.id, next).leave().catch(() => undefined); return; } setCredential(next); setSession({ ...value, name: value.name || displayName }); }
    catch (cause) { if (mounted.current) setError(callingError(cause)); } finally { if (mounted.current) setBusy(false); }
  }
  const ready = session?.state === 'APPROVED' && session.meeting && ['RINGING', 'ACTIVE'].includes(session.meeting.status);
  const terminal = ['ENDED', 'CANCELLED', 'FAILED', 'EXPIRED'].includes(meeting.status) || session && (!session.meeting || ['DENIED', 'EXPIRED', 'CANCELLED', 'REMOVED'].includes(session.state) || ['ENDED', 'CANCELLED', 'FAILED', 'EXPIRED'].includes(session.meeting.status));
  const leave = async () => { if (busy) return; setBusy(true); try { if (gateway) await gateway.leave(); close(); } catch (cause) { setError(callingError(cause)); setBusy(false); } };
  return <section className="client-card client-admission" aria-label="Meeting admission"><h2>{terminal ? 'Meeting access closed' : meeting.title}</h2>{error && <p role="alert">{error}</p>}{terminal ? <p role="status">This meeting or your admission is no longer available.</p> : !credential ? <><p>The host will admit you. Your camera and microphone stay off until you choose to join.</p><button type="button" disabled={busy} onClick={() => void request()}>{busy ? 'Requesting admission…' : 'Request to join'}</button></> : !ready ? <p role="status">{session?.state === 'APPROVED' ? 'You have been admitted. Waiting for the host to open the meeting.' : 'You are in the waiting room. The host has been notified.'}</p> : null}<button type="button" disabled={busy} onClick={() => void leave()}>{credential ? 'Leave meeting' : 'Back to meetings'}</button>{credential && gateway && ready && session?.meeting && !terminal && <Suspense fallback={<p role="status">Opening call controls…</p>}><AdmittedCall credential={credential} session={{ ...session, meeting: session.meeting }} gateway={gateway} close={() => void leave()}/></Suspense>}</section>;
}
export function ClientMeetings() {
  const { relationship, subscribe, revision, watch } = usePortalLive(); const [params, setParams] = useSearchParams(); const conversationId = params.get('conversationId') || '', meetingId = params.get('meetingId') || '';
  const [rows, setRows] = useState<ClientMeeting[]>([]), [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [refresh, setRefresh] = useState(0), [joining, setJoining] = useState<ClientMeeting | null>(null);
  const openedTarget = useRef<string | null>(null);
  useEffect(() => { watch(null); return subscribe(event => { if (event.type.startsWith('meeting.') || event.type.startsWith('guest.') || event.type.startsWith('conversation.')) setRefresh(value => value + 1); }); }, [watch, subscribe]);
  useEffect(() => { openedTarget.current = null; setRows([]); setCursor(null); setJoining(null); }, [relationship.id, conversationId, meetingId]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    const query = new URLSearchParams({ ...(conversationId ? { conversationId } : {}), ...(meetingId ? { meetingId } : {}) }).toString();
    void collaborationApi.meetings(relationship.id, query, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      const visible = meetingId ? page.data.filter(value => value.id === meetingId) : page.data;
      setRows(visible); setCursor(meetingId ? null : page.nextCursor); setError('');
      if (meetingId && openedTarget.current !== meetingId) {
        // Selecting an authorized meeting only opens its information and explicit
        // Request to join action. It does not create admission or media credentials.
        openedTarget.current = meetingId;
        const target = visible[0]; setJoining(target && !['ENDED', 'CANCELLED', 'FAILED', 'EXPIRED'].includes(target.status) ? target : null);
      } else setJoining(current => current ? visible.find(item => item.id === current.id) ?? null : null);
    }).catch(() => { if (!controller.signal.aborted) { setRows([]); setJoining(null); setError('Meetings are unavailable or your access has changed.'); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [relationship.id, conversationId, meetingId, revision, refresh]);
  return <section className="client-card"><h1>Meetings</h1><p>Only meetings explicitly shared with your conversations appear here. The host admits each participant.</p>{(conversationId || meetingId) && <button type="button" onClick={() => setParams({})}>Show all my meetings</button>}{loading && <p role="status">Loading meetings…</p>}{error && <p role="alert">{error}</p>}{!loading && !rows.length && !error && <p>{meetingId ? 'This meeting is no longer available or has not been shared with you.' : 'No meetings have been shared with you.'}</p>}<ul className="client-meeting-list">{rows.map(value => <li key={value.id}><div><h2>{value.title}</h2><p>{meetingDateTime(value.scheduledStartAt, value.timezone)} · {value.timezone}</p><p>With {value.hostName} · {value.status === 'RINGING' ? 'Ready to join' : value.status.toLowerCase()}</p></div>{!['ENDED', 'CANCELLED', 'FAILED', 'EXPIRED'].includes(value.status) && <button type="button" onClick={() => setJoining(value)}>Open meeting</button>}</li>)}</ul>{cursor && <button type="button" disabled={loading} onClick={() => { setLoading(true); void collaborationApi.meetings(relationship.id, new URLSearchParams({ ...(conversationId ? { conversationId } : {}), after: cursor }).toString()).then(page => { setRows(values => [...values, ...page.data]); setCursor(page.nextCursor); }).catch(() => setError('More meetings could not be loaded.')).finally(() => setLoading(false)); }}>More meetings</button>}{joining && <MeetingAdmission key={joining.id} meeting={joining} close={() => setJoining(null)}/>}</section>;
}
