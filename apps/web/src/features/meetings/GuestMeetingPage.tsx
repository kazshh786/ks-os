import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, LockKeyhole, Video } from 'lucide-react';
import { defaultDevices, DevicePreview, DeviceSettings, useDevices } from '../calls/MeetingDevices';
import { callingError, type Meeting as MediaMeeting } from '../calls/calls.api';
import type { MeetingMediaApi } from '../calls/MeetingWindow';
import { MeetingBrandHeader, brandStyle } from './MeetingBrand';
import { guestMeetingsApi, type GuestCredential, type GuestSession, type PublicMeeting } from './meetings.api';
import { meetingDateTime } from './meeting-time';
import { noMeetingSubscription } from './meetings.live';
import '../calls/calls.css';
import './meetings.css';

const MeetingWindow = lazy(() => import('../calls/MeetingWindow'));
export const guestStorageKey = 'ksos-meeting-guest-session';
export function readGuestCredential(): GuestCredential | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(guestStorageKey) || 'null') as GuestCredential | null;
    return value && typeof value.sessionId === 'string' && /^[a-zA-Z0-9-]{16,100}$/.test(value.sessionId) && typeof value.csrfToken === 'string' && /^[a-zA-Z0-9_-]{16,512}$/.test(value.csrfToken) && typeof value.requestId === 'string' ? value : null;
  } catch { return null; }
}
function guestMediaMeeting(session: GuestSession): MediaMeeting {
  const meeting = session.meeting;
  return {
    id: session.sessionId, conversationId: '', conversationName: meeting?.title || 'Meeting closed', title: meeting?.title || 'Meeting closed', type: meeting?.type || 'VIDEO',
    status: !meeting || session.state !== 'APPROVED' || ['ENDED', 'CANCELLED', 'FAILED', 'EXPIRED'].includes(meeting.status) ? 'CANCELLED' : 'ACTIVE',
    createdBy: '', organizerName: meeting?.hostName || '', createdAt: meeting?.scheduledStartAt || '', startedAt: null, endedAt: null, endReason: null,
    expiresAt: session.expiresAt, canManage: false, participants: [],
  };
}
function GuestCall({ credential, session, close }: { credential: GuestCredential; session: GuestSession & { meeting: PublicMeeting }; close: () => void }) {
  const api = useMemo<MeetingMediaApi>(() => ({
    meeting: async () => guestMediaMeeting(await guestMeetingsApi.session(credential)),
    join: async (_id, requestId) => { const result = await guestMeetingsApi.join(credential, requestId); return { ...result, meeting: { ...result.meeting, canManage: false, conversationId: '' } }; },
    leave: () => guestMeetingsApi.leave(credential),
    end: async () => { throw new Error('Only the host can end this meeting.'); },
    remove: async () => { throw new Error('Only the host can remove participants.'); },
  }), [credential]);
  return <Suspense fallback={<p role="status">Opening your meeting…</p>}><MeetingWindow id={credential.sessionId} api={api} mode="guest" subscribe={noMeetingSubscription} revision={0} close={close} displayName={session.name || 'Guest'} participantLimit={session.meeting.participantLimit || 12} brandName={session.meeting.branding.name} brandHeader={<MeetingBrandHeader brand={session.meeting.branding}/>} allowScreenShare={session.meeting.guestScreenShare}/></Suspense>;
}
const stateText: Record<GuestSession['state'], { title: string; description: string }> = {
  WAITING: { title: 'You are in the waiting room', description: 'The host has been notified. Keep this page open; your camera and microphone are not shared with the meeting.' },
  APPROVED: { title: 'You have been admitted', description: 'You can join as soon as the host opens the meeting.' },
  DENIED: { title: 'Your request was not admitted', description: 'Please contact the organiser if you need another invitation.' },
  REMOVED: { title: 'You have left this meeting', description: 'The host has removed your access. Please contact the organiser if you need to return.' },
  EXPIRED: { title: 'This invitation has expired', description: 'Please contact the organiser for a new invitation.' },
  CANCELLED: { title: 'This meeting is closed', description: 'Please contact the organiser for the latest arrangements.' },
};
export default function GuestMeetingPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('invite') || '');
  const [credential, setCredential] = useState<GuestCredential | null>(() => token ? null : readGuestCredential());
  const [meeting, setMeeting] = useState<PublicMeeting | null>(null), [session, setSession] = useState<GuestSession | null>(null);
  const [name, setName] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [closed, setClosed] = useState(false), [retry, setRetry] = useState(0);
  const [microphone, setMicrophone] = useState(false), [camera, setCamera] = useState(false), [selected, setSelected] = useState(defaultDevices);
  const { devices, error: deviceError, refresh: refreshDevices } = useDevices();
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    // Retain the capability only in memory; never let later resource requests or navigation carry it.
    if (token) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    const existing = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
    const original = existing?.content; const meta = existing || document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer';
    if (!existing) document.head.append(meta);
    return () => { if (existing) meta.content = original || ''; else meta.remove(); };
  }, [token]);
  useEffect(() => {
    if (credential) return;
    let active = true;
    if (!token || token.length > 1024) { setError('Open the meeting link sent by your organiser. This page does not contain a valid invitation.'); return; }
    setError('');
    void guestMeetingsApi.resolve(token).then(value => { if (active) setMeeting(value); }).catch(cause => { if (active) setError(callingError(cause)); });
    return () => { active = false; };
  }, [credential, retry, token]);
  const refreshSession = useCallback(async () => {
    if (!credential) return;
    const value = await guestMeetingsApi.session(credential); setSession(value); setMeeting(value.meeting); setError('');
  }, [credential]);
  useEffect(() => {
    if (!credential || closed) return;
    let active = true, pending = false;
    const update = async () => {
      if (pending) return; pending = true;
      try { const value = await guestMeetingsApi.session(credential); if (active) { setSession(value); setMeeting(value.meeting); setError(''); } }
      catch (cause) { if (active) { setError(callingError(cause)); if (cause instanceof Error && 'status' in cause && [401, 403, 404, 410].includes(Number(cause.status))) { setMeeting(null); setSession(previous => previous ? { ...previous, state: 'EXPIRED', meeting: null } : null); } } } finally { pending = false; }
    };
    void update(); const timer = setInterval(() => void update(), 2500); const focused = () => void update(); window.addEventListener('focus', focused);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', focused); };
  }, [credential, closed, retry]);
  async function requestAdmission(event: React.FormEvent) {
    event.preventDefault(); if (busy || !name.trim()) return; setBusy(true); setError('');
    try {
      const value = await guestMeetingsApi.request(token, name.trim(), requestId.current);
      if (!value.csrfToken) throw new Error('The waiting room could not establish a secure session. Please retry.');
      const next = { sessionId: value.sessionId, csrfToken: value.csrfToken, requestId: requestId.current };
      try { sessionStorage.setItem(guestStorageKey, JSON.stringify(next)); } catch { setNotice('Keep this tab open. Your browser could not save this session for refresh recovery.'); }
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      setMicrophone(false); setCamera(false); setCredential(next); setSession({ ...value, name: value.name || name.trim() }); setMeeting(value.meeting);
    } catch (cause) { setError(callingError(cause)); } finally { setBusy(false); }
  }
  async function leaveWaiting() {
    if (!credential || busy) return; setBusy(true); setError('');
    try { await guestMeetingsApi.leave(credential); setClosed(true); } catch (cause) { setError(callingError(cause)); } finally { setBusy(false); }
  }
  const ready = session?.state === 'APPROVED' && session.meeting && ['RINGING', 'ACTIVE'].includes(session.meeting.status);
  const ended = meeting && ['ENDED', 'CANCELLED', 'FAILED', 'EXPIRED'].includes(meeting.status);
  const status = closed ? { title: 'You have left the meeting', description: 'Thank you for joining. You can close this page.' } : ended ? stateText.CANCELLED : session ? stateText[session.state] : null;
  return <main className="guest-meeting meetings" style={meeting ? brandStyle(meeting.branding) : undefined}>
    <div className="guest-meeting-shell">
      {meeting && <MeetingBrandHeader brand={meeting.branding}/>}
      <div className="guest-meeting-card">
        {!meeting ? <><LockKeyhole size={28} aria-hidden="true"/><h1>{status?.title || (error ? 'Meeting unavailable' : 'Opening your invitation…')}</h1>{status ? <p role="status">{status.description}</p> : !error && <p role="status">Checking your meeting invitation securely.</p>}</> : <>
          <p className="meetings-eyebrow">{meeting.type === 'VIDEO' ? 'Video meeting' : 'Audio meeting'}</p><h1>{meeting.title}</h1>
          <p className="meetings-muted">With {meeting.hostName} · <time dateTime={meeting.scheduledStartAt}>{meetingDateTime(meeting.scheduledStartAt, meeting.timezone)}</time> · {meeting.timezone}</p>
          {meeting.branding.welcomeMessage && <p>{meeting.branding.welcomeMessage}</p>}
          {status ? <section className="guest-waiting" aria-live="polite"><Clock3 size={34} aria-hidden="true"/><h2>{status.title}</h2><p>{status.description}</p>{session?.state === 'WAITING' && !closed && !ended && <button type="button" disabled={busy} onClick={() => void leaveWaiting()}>Leave waiting room</button>}{closed && session?.state === 'APPROVED' && !ended && <button type="button" className="meetings-primary" onClick={() => { setClosed(false); void refreshSession().catch(cause => setError(callingError(cause))); }}>Return to meeting</button>}</section> : !credential && !ended && <form onSubmit={event => void requestAdmission(event)} className="guest-entry">
            <div><DevicePreview microphone={microphone} camera={camera} selected={selected} changed={refreshDevices} initials={meeting.branding.name.slice(0, 2).toUpperCase()}/><div className="meetings-preview-toggles"><label className="meetings-check"><input type="checkbox" checked={microphone} onChange={event => setMicrophone(event.target.checked)}/>Test microphone</label><label className="meetings-check"><input type="checkbox" checked={camera} onChange={event => setCamera(event.target.checked)}/>Preview camera</label></div></div>
            <div><label>Your name<input autoComplete="name" required minLength={1} maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label><DeviceSettings devices={devices} selected={selected} change={(kind, value) => setSelected(current => ({ ...current, [kind]: value }))}/>{deviceError && <p role="alert" className="meetings-error">{deviceError}</p>}<button className="meetings-primary" disabled={busy}><Video size={18} aria-hidden="true"/>{busy ? 'Requesting admission…' : 'Request to join'}</button><p className="meetings-muted">The host will admit you from the waiting room. Your preview stays on this device.</p></div>
          </form>}
        </>}
        {error && <div role="alert" className="meetings-error"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}{notice && <p role="status">{notice}</p>}
      </div>
      <footer className="guest-meeting-footer"><LockKeyhole size={15} aria-hidden="true"/> Secure meeting provided through KSOS. Recording and transcription are off. Guest names are not verified identities.</footer>
    </div>
    {credential && session?.meeting && ready && !closed && !ended && <GuestCall credential={credential} session={{ ...session, meeting: session.meeting }} close={() => setClosed(true)}/>}
  </main>;
}
