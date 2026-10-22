import { useCallback, useEffect, useRef, useState } from 'react';
import { History, Phone, Video } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { ChatDialog } from '../chat/ChatDialog';
import type { SubscribeChat } from '../chat/MessageTimeline';
import { callsApi, callingError, isJoinable, meetingDuration, meetingOutcome, type CallingConfig, type Meeting, type MeetingType } from './calls.api';
import './calls.css';

export function ConversationCalls({ conversationId, archived, subscribe, revision }: { conversationId: string; archived: boolean; subscribe: SubscribeChat; revision: number }) {
  const [, setParams] = useSearchParams();
  const [config, setConfig] = useState<CallingConfig | null>(null), [rows, setRows] = useState<Meeting[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef<{ type: MeetingType; id: string } | null>(null), working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const open = (id: string) => setParams(current => { const next = new URLSearchParams(current); next.set('call', id); return next; });
  const refresh = useCallback(async () => {
    const page = await callsApi.history(conversationId);
    if (!mounted.current) return;
    setRows(page.data); setCursor(page.nextCursor);
  }, [conversationId]);
  useEffect(() => {
    let active = true;
    setConfig(null); setRows([]); setCursor(null); setError(''); request.current = null;
    void callsApi.config().then(async value => {
      if (!active) return;
      setConfig(value);
      if (value.enabled) { const page = await callsApi.history(conversationId); if (active) { setRows(page.data); setCursor(page.nextCursor); } }
    }).catch(cause => { if (active) setError(callingError(cause)); });
    return () => { active = false; };
  }, [conversationId]);
  useEffect(() => {
    if (!config?.enabled) return;
    let active = true;
    const update = () => void callsApi.history(conversationId).then(page => { if (active) { setRows(page.data); setCursor(page.nextCursor); } }).catch(cause => { if (active) setError(callingError(cause)); });
    const stop = subscribe(event => { if (event.conversationId === conversationId && event.type.startsWith('call.')) update(); });
    const timer = setInterval(update, 15000);
    if (revision) update();
    return () => { active = false; stop(); clearInterval(timer); };
  }, [config?.enabled, conversationId, subscribe, revision]);
  const start = async (type: MeetingType) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    if (!request.current || request.current.type !== type) request.current = { type, id: crypto.randomUUID() };
    try { const meeting = await callsApi.create(conversationId, type, request.current.id); request.current = null; await refresh(); if (mounted.current) open(meeting.id); }
    catch (cause) { setError(callingError(cause)); }
    finally { working.current = false; setBusy(false); }
  };
  const active = rows.find(isJoinable);
  return <div className="call-conversation-actions">
    {config?.enabled && !archived && (active ? <button type="button" className="call-active-link" onClick={() => open(active.id)}><span className="call-live-dot"/>{active.status === 'ACTIVE' ? 'Join call' : 'Call in progress'}</button> : <>
      <button type="button" disabled={busy} aria-label="Start voice call" title="Start voice call" onClick={() => void start('AUDIO')}><Phone size={18} aria-hidden="true"/></button>
      <button type="button" disabled={busy} aria-label="Start video call" title="Start video call" onClick={() => void start('VIDEO')}><Video size={19} aria-hidden="true"/></button>
    </>)}
    <button type="button" aria-label="Call history" title="Call history" onClick={() => { setHistory(true); if (config?.enabled) void refresh().catch(cause => setError(callingError(cause))); }}><History size={18} aria-hidden="true"/></button>
    {error && <span className="call-inline-error" role="alert">{error}</span>}
    {history && <ChatDialog title="Call history" close={() => setHistory(false)}>
      {!config?.enabled && <p>Calling is not enabled for this workspace yet.</p>}
      {config?.enabled && !rows.length && <p>No calls yet. Start a voice or video call from this conversation.</p>}
      <ul className="call-history">{rows.map(meeting => <li key={meeting.id}>
        {meeting.type === 'VIDEO' ? <Video size={20} aria-hidden="true"/> : <Phone size={20} aria-hidden="true"/>}
        <div><strong>{meeting.type === 'VIDEO' ? 'Video call' : 'Voice call'} · {meetingOutcome(meeting)}</strong><p>{meeting.organizerName}</p><time dateTime={meeting.createdAt}>{new Date(meeting.createdAt).toLocaleString()}</time>{meetingDuration(meeting) && <span> · {meetingDuration(meeting)}</span>}</div>
        {isJoinable(meeting) && !archived && <button type="button" onClick={() => { setHistory(false); open(meeting.id); }}>Join</button>}
      </li>)}</ul>
      {cursor && <button type="button" disabled={busy} onClick={() => { setBusy(true); void callsApi.history(conversationId, cursor).then(page => { setRows(current => [...new Map([...current, ...page.data].map(row => [row.id, row])).values()]); setCursor(page.nextCursor); }).catch(cause => setError(callingError(cause))).finally(() => setBusy(false)); }}>Older calls</button>}
    </ChatDialog>}
  </div>;
}

