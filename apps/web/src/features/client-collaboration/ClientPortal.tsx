import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router';
import type { ChatEphemeral, ChatSignal, CommunicationsEvent } from '@ks-os/contracts';
import { supabase } from '../../lib/supabase';
import { clearClientMeetingCredentials, signOutCustomer } from './customer-session';
import { ChatServicesContext } from '../chat/ChatServices';
import { ChatLiveContext } from '../chat/ChatLive';
import { ChatNotifications } from '../chat/ChatNotifications';
import { connectChat, type ConnectionState } from '../chat/chat.realtime';
import type { SubscribeChat } from '../chat/MessageTimeline';
import { MeetingBrandHeader, brandStyle } from '../meetings/MeetingBrand';
import { collaborationApi, createCustomerChatServices, portalPath, relationshipBrand, relationshipPath, type ClientRelationship, type CollaborationSession } from './collaboration.api';
import { ClientMessages, ClientFiles } from './ClientMessages';
import { ClientMeetings } from './ClientMeetings';
import './collaboration.css';
import '../chat/chat.css';

type PortalLive = { subscribe: SubscribeChat; revision: number; relationship: ClientRelationship; displayName: string; watch: (id: string | null) => void; reloadSession: () => void };
const PortalLiveContext = createContext<PortalLive | null>(null);
export const usePortalLive = () => { const value = useContext(PortalLiveContext); if (!value) throw new Error('Client workspace is required'); return value; };

function BusinessChoices({ session }: { session: CollaborationSession }) {
  return <main className="client-businesses"><p className="client-eyebrow">Your client portal</p><h1>Choose a business</h1><p>Each business has its own conversations and shared files.</p>{session.relationships.length ? <ul>{session.relationships.map(value => <li key={value.id}><Link to={portalPath(value.id) + '/messages'}><MeetingBrandHeader brand={relationshipBrand(value)}/><span>{value.clientName}</span></Link></li>)}</ul> : <p role="status">You do not have active collaboration access. Ask the business to send an invitation.</p>}<Link to="/customer/profile">Your customer account</Link></main>;
}
function ClientAccount({ session, signOut }: { session: CollaborationSession; signOut: () => void }) {
  const { relationship } = usePortalLive();
  return <section className="client-card"><h1>Your account</h1><dl><dt>Name</dt><dd>{session.displayName}</dd><dt>Current business</dt><dd>{relationship.businessName}</dd><dt>Customer relationship</dt><dd>{relationship.clientName}</dd></dl><p>Your access is limited to conversations the business has explicitly shared with you.</p><Link to="/customer/profile">Manage your contact details</Link><button type="button" onClick={signOut}>Sign out on this device</button></section>;
}
function Workspace({ relationship, session, reloadSession, signOut }: { relationship: ClientRelationship; session: CollaborationSession; reloadSession: () => void; signOut: () => void }) {
  const navigate = useNavigate();
  const [scope] = useState(() => ({ current: new AbortController() }));
  const services = useMemo(() => createCustomerChatServices(relationship, () => scope.current.signal), [relationship.id, relationship.businessName, scope]);
  const [revision, setRevision] = useState(0), [snapshot, setSnapshot] = useState<ChatEphemeral | null>(null), [connection, setConnection] = useState<ConnectionState>('connecting'), [revoked, setRevoked] = useState(false), [activeConversationId, setActiveConversationId] = useState<string | undefined>();
  const listeners = useRef(new Set<(event: CommunicationsEvent) => void>()), control = useRef<ReturnType<typeof connectChat> | null>(null), watched = useRef<string | null>(null);
  const subscribe: SubscribeChat = useCallback(listener => { listeners.current.add(listener); return () => { listeners.current.delete(listener); }; }, []);
  const signal = useCallback((value: ChatSignal) => control.current?.signal(value), []);
  const watch = useCallback((id: string | null) => { watched.current = id; setActiveConversationId(id || undefined); setSnapshot(null); signal({ type: 'watch', conversationId: id, userIds: [] }); }, [signal]);
  useEffect(() => {
    let active = true;
    const stop = connectChat({
      ready: async () => { if (active) { setRevision(value => value + 1); reloadSession(); } },
      state: value => { if (active) { setConnection(value); if (value !== 'connected') setSnapshot(null); } },
      ephemeral: value => { if (active) setSnapshot(value); },
      event: event => { if (!active) return; for (const listener of listeners.current) listener(event); if (event.type.includes('member_') || event.type.startsWith('relationship.')) reloadSession(); },
      revoked: () => { if (active) { setRevoked(true); setSnapshot(null); reloadSession(); } },
    }, { ticket: services.api.ticket, eventsPath: relationshipPath(relationship.id) + '/chat/events' });
    control.current = stop;
    stop.signal({ type: 'watch', conversationId: watched.current, userIds: [] });
    return () => { active = false; stop(); scope.current.abort(); scope.current = new AbortController(); control.current = null; };
  }, [services, relationship.id, reloadSession, scope]);
  const brand = relationshipBrand(relationship), root = portalPath(relationship.id);
  return <ChatServicesContext.Provider value={services}><ChatLiveContext.Provider value={{ snapshot, signal, activeConversationId }}><PortalLiveContext.Provider value={{ subscribe, revision, relationship, displayName: session.displayName, watch, reloadSession }}>
    <div className="client-portal" style={brandStyle(brand)}>
      <aside className="client-nav"><MeetingBrandHeader brand={brand}/><p className="client-welcome">Welcome, {session.displayName}</p><label>Business<select value={relationship.id} onChange={event => navigate(portalPath(event.target.value) + '/messages')}>{session.relationships.map(value => <option value={value.id} key={value.id}>{value.businessName} · {value.clientName}</option>)}</select></label><nav aria-label="Client portal navigation">{['Messages', 'Files', 'Meetings', 'Account'].map(label => <NavLink key={label} to={root + '/' + label.toLowerCase()}>{label}</NavLink>)}</nav><button type="button" onClick={signOut}>Sign out</button><p className="client-connection" role="status">{{ connecting: 'Connecting…', connected: 'Connected', reconnecting: 'Reconnecting…', unavailable: 'Sign in required' }[connection]}</p></aside>
      <main className="client-main">{revoked ? <section className="client-card" role="alert"><h1>Access is no longer available</h1><p>Choose an authorised business or sign in again.</p><Link to="/customer/collaboration">Choose a business</Link></section> : <><div className="client-alerts"><ChatNotifications subscribe={subscribe} revision={revision} conversationId={activeConversationId}/></div><Routes><Route index element={<ClientMessages/>}/><Route path="messages" element={<ClientMessages/>}/><Route path="messages/:conversationId" element={<ClientMessages/>}/><Route path="files" element={<ClientFiles/>}/><Route path="meetings" element={<ClientMeetings/>}/><Route path="account" element={<ClientAccount session={session} signOut={signOut}/>}/><Route path="*" element={<p>Page unavailable. <Link to={root + '/messages'}>Open messages</Link></p>}/></Routes></>}</main>
    </div>
  </PortalLiveContext.Provider></ChatLiveContext.Provider></ChatServicesContext.Provider>;
}
function WorkspaceRoute({ session, reloadSession, signOut }: { session: CollaborationSession; reloadSession: () => void; signOut: () => void }) {
  const { relationshipId } = useParams(); const relationship = session.relationships.find(item => item.id === relationshipId);
  return relationship ? <Workspace key={session.actorId + ':' + relationship.id} relationship={relationship} session={session} reloadSession={reloadSession} signOut={signOut}/> : <BusinessChoices session={session}/>;
}
export default function ClientPortal() {
  const navigate = useNavigate(); const [session, setSession] = useState<CollaborationSession | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0), [loading, setLoading] = useState(true);
  const closed = useRef(false);
  const reloadSession = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (closed.current) return;
    const controller = new AbortController();
    void collaborationApi.session(controller.signal).then(value => { if (!controller.signal.aborted && !closed.current) { setSession(value); setError(''); } }).catch(() => { if (!controller.signal.aborted && !closed.current) { setSession(null); setError('Your client portal session is unavailable. Please sign in again.'); } }).finally(() => { if (!controller.signal.aborted && !closed.current) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const timer = setInterval(reloadSession, 20000); window.addEventListener('focus', reloadSession);
    const { data } = supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') { closed.current = true; clearClientMeetingCredentials(); setSession(null); setLoading(false); setError('You have signed out.'); } else if (!closed.current && ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) queueMicrotask(reloadSession); });
    return () => { clearInterval(timer); window.removeEventListener('focus', reloadSession); data.subscription.unsubscribe(); };
  }, [reloadSession]);
  const signOut = () => { closed.current = true; setSession(null); setLoading(true); void signOutCustomer().catch(() => undefined).finally(() => navigate('/customer/login', { replace: true })); };
  if (!session) return <main className="client-entry"><h1>Client portal</h1>{loading ? <p role="status">Opening your authorised businesses…</p> : <><p role="alert">{error}</p><Link to="/customer/login?collaboration=1">Sign in securely</Link></>}</main>;
  return <Routes><Route index element={<BusinessChoices session={session}/>}/><Route path=":relationshipId/*" element={<WorkspaceRoute session={session} reloadSession={reloadSession} signOut={signOut}/>}/></Routes>;
}
