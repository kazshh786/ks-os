import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../auth/useAuth';
import { ChatError } from '../chat/chat.api';
import type { SubscribeChat } from '../chat/MessageTimeline';
import { phase4Api } from '../chat/chat.phase4.api';
import { callsApi, callingError, isJoinable, type CallingConfig, type Meeting } from './calls.api';
import './calls.css';

const MeetingWindow = lazy(() => import('./MeetingWindow'));
function incomingTone() {
  // A short local tone only when browser autoplay policy already permits sound.
  // This never requests capture access or resumes a blocked audio context.
  if (typeof AudioContext === 'undefined' || !document.hasFocus() || document.visibilityState !== 'visible') return;
  try {
    const context = new AudioContext();
    if (context.state !== 'running') { void context.close(); return; }
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.frequency.value = 660; oscillator.connect(gain); gain.connect(context.destination);
    const now = context.currentTime; gain.gain.setValueAtTime(0, now);
    for (const offset of [0, 0.3]) { gain.gain.linearRampToValueAtTime(0.07, now + offset + 0.02); gain.gain.setValueAtTime(0.07, now + offset + 0.12); gain.gain.linearRampToValueAtTime(0, now + offset + 0.16); }
    oscillator.start(now); oscillator.stop(now + 0.5); oscillator.onended = () => { void context.close(); };
  } catch { /* The visible invitation remains available when audio is blocked. */ }
}
export function CallWorkspace({ subscribe, revision, userId }: { subscribe: SubscribeChat; revision: number; userId?: string }) {
  const auth = useAuth(), [params, setParams] = useSearchParams();
  const selected = params.get('call'), [config, setConfig] = useState<CallingConfig | null>(null);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const [incoming, setIncoming] = useState<Meeting[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState<string | null>(null);
  const seen = useRef(new Set<string>()), alive = useRef(true), refreshing = useRef(false), broadcast = useRef<BroadcastChannel | null>(null);
  const browserAlerts = useRef(new Map<string, Notification>());
  const open = useCallback((id: string) => setParams(current => { const next = new URLSearchParams(current); next.set('call', id); return next; }), [setParams]);
  const close = useCallback(() => setParams(current => { const next = new URLSearchParams(current); next.delete('call'); return next; }), [setParams]);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const settings = await callsApi.config();
      if (!alive.current) return;
      setConfig(settings);
      if (!settings.enabled) { setIncoming([]); for (const alert of browserAlerts.current.values()) alert.close(); browserAlerts.current.clear(); return; }
      const [meetings, preferences] = await Promise.all([callsApi.incoming(), phase4Api.preferences()]);
      if (!alive.current) return;
      const eligible = preferences.dnd || preferences.incomingCalls === false ? [] : meetings.filter(m => isJoinable(m) && Date.parse(m.expiresAt) > Date.now());
      setIncoming(preferences.inApp ? eligible : []);
      const activeIds = new Set(eligible.map(meeting => meeting.id));
      for (const [id, alert] of browserAlerts.current) if (!activeIds.has(id) || !preferences.browser) { alert.close(); browserAlerts.current.delete(id); }
      for (const meeting of eligible) {
        if (seen.current.has(meeting.id) || meeting.id === selectedRef.current) continue;
        seen.current.add(meeting.id);
        // The server has already filtered recipient eligibility and conversation preferences.
        if (preferences.browser && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            const notification = new Notification('Incoming KSOS call', { body: 'Open KSOS to review the invitation.', tag: 'ksos-call-' + meeting.id, silent: !preferences.sound });
            browserAlerts.current.set(meeting.id, notification);
            notification.onclick = () => { window.focus(); open(meeting.id); notification.close(); browserAlerts.current.delete(meeting.id); };
            setTimeout(() => { notification.close(); browserAlerts.current.delete(meeting.id); }, Math.max(0, Math.min(30000, Date.parse(meeting.expiresAt) - Date.now())));
          } catch { /* Browsers that require native push still have the in-app invitation. */ }
        } else if (preferences.inApp && preferences.sound) incomingTone();
      }
      if (seen.current.size > 500) seen.current = new Set(eligible.map(m => m.id));
      setError('');
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof ChatError && [401, 403].includes(cause.status)) { setIncoming([]); for (const alert of browserAlerts.current.values()) alert.close(); browserAlerts.current.clear(); }
      setError(callingError(cause));
    } finally { refreshing.current = false; }
  }, [open]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const stop = subscribe(event => { if (event.type.startsWith('call.') || event.type.startsWith('notification.') || event.type === 'conversation.member_left') void refresh(); });
    const timer = setInterval(() => void refresh(), 15000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    if (typeof BroadcastChannel !== 'undefined') {
      broadcast.current = new BroadcastChannel('ksos-call-invitations');
      broadcast.current.onmessage = () => void refresh();
    }
    return () => { alive.current = false; clearInterval(timer); stop(); window.removeEventListener('focus', focus); broadcast.current?.close(); broadcast.current = null; for (const alert of browserAlerts.current.values()) alert.close(); browserAlerts.current.clear(); };
  }, [refresh, subscribe]);
  useEffect(() => { if (revision) void refresh(); }, [revision, refresh]);
  const respond = async (meeting: Meeting, accept: boolean) => {
    if (busy) return;
    setBusy(meeting.id); setError('');
    try {
      await callsApi.invitation(meeting.id, accept);
      setIncoming(rows => rows.filter(row => row.id !== meeting.id));
      broadcast.current?.postMessage({ changed: true });
      if (accept) open(meeting.id);
    } catch (cause) { setError(callingError(cause)); }
    finally { setBusy(null); void refresh(); }
  };
  return <>
    {incoming.filter(meeting => meeting.id !== selected).slice(0, 1).map(meeting => <section className="call-incoming" key={meeting.id} role="region" aria-live="polite" aria-atomic="true" aria-label={'Incoming ' + (meeting.type === 'VIDEO' ? 'video' : 'voice') + ' call'}>
      <div className="call-avatar" aria-hidden="true">{meeting.organizerName.slice(0, 2).toUpperCase()}</div>
      <div><p className="chat-eyebrow">Incoming {meeting.type === 'VIDEO' ? 'video' : 'voice'} call</p><h2>{meeting.organizerName}</h2><p>{meeting.conversationName}</p>{incoming.length > 1 && <p>{incoming.length - 1} more invitation{incoming.length > 2 ? 's' : ''} waiting</p>}</div>
      <div className="call-actions"><button type="button" disabled={busy !== null} className="call-danger" onClick={() => void respond(meeting, false)}><PhoneOff size={17} aria-hidden="true"/>Decline</button><button type="button" className="call-primary" disabled={busy !== null} onClick={() => void respond(meeting, true)}>{meeting.type === 'VIDEO' ? <Video size={17} aria-hidden="true"/> : <Phone size={17} aria-hidden="true"/>}Accept</button></div>
    </section>)}
    {error && incoming.length > 0 && <p className="call-incoming-error" role="alert">{error}</p>}
    {selected && config?.enabled && <Suspense fallback={<div className="call-loading" role="status">Opening call…</div>}><MeetingWindow key={selected} id={selected} subscribe={subscribe} revision={revision} close={close} displayName={auth.email?.split('@')[0] || 'You'} userId={userId} participantLimit={config.participantLimit}/></Suspense>}
    {selected && config && !config.enabled && <div className="call-incoming" role="status"><p>Calling is not enabled for this workspace yet.</p><button type="button" onClick={close}>Dismiss</button></div>}
  </>;
}

