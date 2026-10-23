import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { NativeConversation } from '@ks-os/contracts';
import { useChatServices } from '../chat/ChatServices';
import { MessageTimeline } from '../chat/MessageTimeline';
import { ThreadPanel } from '../chat/ThreadPanel';
import { SharedFiles } from '../chat/ChatAttachments';
import { ChatSearch } from '../chat/ChatSearch';
import { ConversationNotifications } from '../chat/ChatNotifications';
import type { Draft } from '../chat/MessageComposer';
import { usePortalLive } from './ClientPortal';
import { isClientChannel, portalPath, type ClientConversation } from './collaboration.api';

export function useClientChannels() {
  const { api } = useChatServices(); const { subscribe, revision } = usePortalLive();
  const [rows, setRows] = useState<NativeConversation[]>([]), [cursor, setCursor] = useState<string | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [search, setSearch] = useState(''), [refresh, setRefresh] = useState(0);
  useEffect(() => { let timer: ReturnType<typeof setTimeout>; const stop = subscribe(event => { if (event.conversationId) { clearTimeout(timer); timer = setTimeout(() => setRefresh(value => value + 1), 180); } }); return () => { clearTimeout(timer); stop(); }; }, [subscribe]);
  useEffect(() => { const controller = new AbortController(); setLoading(true); const timer = setTimeout(() => void api.channels(search, '', controller.signal).then(page => { if (!controller.signal.aborted) { setRows(page.data.filter(isClientChannel)); setCursor(page.nextCursor); setError(''); } }).catch(() => { if (!controller.signal.aborted) { setRows([]); setCursor(null); setError('Conversations are unavailable. Your access may have changed.'); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); }), 150); return () => { controller.abort(); clearTimeout(timer); }; }, [api, search, revision, refresh]);
  const more = async () => { if (!cursor || loading) return; setLoading(true); try { const page = await api.channels(search, cursor); setRows(values => [...new Map([...values, ...page.data.filter(isClientChannel)].map(value => [value.id, value])).values()]); setCursor(page.nextCursor); } catch { setError('More conversations could not be loaded.'); } finally { setLoading(false); } };
  return { rows, cursor, error, loading, search, setSearch, more };
}
export function ClientMessages() {
  const { api } = useChatServices(); const { relationship, subscribe, revision, watch } = usePortalLive();
  const { conversationId } = useParams(); const [params, setParams] = useSearchParams(); const navigate = useNavigate();
  const channels = useClientChannels(); const [channel, setChannel] = useState<ClientConversation | null>(null), [error, setError] = useState(''), [searchOpen, setSearchOpen] = useState(false);
  const drafts = useRef(new Map<string, Draft>()), heading = useRef<HTMLHeadingElement>(null);
  const root = portalPath(relationship.id);
  const inaccessible = useCallback(() => { setChannel(null); drafts.current.clear(); setError('That conversation is no longer available to you.'); navigate(root + '/messages', { replace: true }); }, [navigate, root]);
  const refresh = useCallback(async () => { if (!conversationId) return; const value = await api.channel(conversationId); if (!isClientChannel(value)) throw new Error('Client conversation unavailable'); return value; }, [api, conversationId]);
  useEffect(() => {
    let active = true; setChannel(null); setError('');
    const update = () => void refresh().then(value => { if (active && value) { setChannel(value); requestAnimationFrame(() => heading.current?.focus()); } }).catch(() => { if (active) inaccessible(); });
    if (conversationId) update();
    const stop = subscribe(event => { if (event.conversationId === conversationId && event.type.startsWith('conversation.')) update(); });
    return () => { active = false; stop(); };
  }, [conversationId, refresh, subscribe, revision, inaccessible]);
  useEffect(() => { watch(channel?.id || null); return () => watch(null); }, [channel?.id, watch]);
  useEffect(() => () => { drafts.current.clear(); }, []);
  const read = useCallback(async (messageId: string) => { if (!conversationId) return; await api.read(conversationId, messageId); const next = await refresh(); if (next) setChannel(next); }, [api, conversationId, refresh]);
  const current = channel?.id === conversationId ? channel : null;
  return <div className={'client-messages' + (conversationId ? ' client-conversation-open' : '')}>
    <aside className="client-conversations" aria-label="Your client conversations"><h1>Messages</h1><label>Find a conversation<input value={channels.search} onChange={event => channels.setSearch(event.target.value)} type="search"/></label><button type="button" onClick={() => setSearchOpen(true)}>Search messages</button>{channels.loading && <p role="status">Loading conversations…</p>}{(channels.error || error) && <p role="alert">{channels.error || error}</p>}<ul>{channels.rows.map(value => <li key={value.id}><Link aria-current={conversationId === value.id ? 'page' : undefined} to={root + '/messages/' + value.id}><strong>{value.name}</strong><small>{value.archivedAt ? 'Archived · Read only' : value.preview || 'Start the conversation'}</small>{Boolean(value.unreadCount) && <span className="client-unread">{value.unreadCount} unread</span>}</Link></li>)}</ul>{!channels.loading && !channels.rows.length && !channels.error && <p>No conversations have been shared with you.</p>}{channels.cursor && <button type="button" disabled={channels.loading} onClick={() => void channels.more()}>More conversations</button>}</aside>
    <section className="client-conversation" aria-label="Selected conversation">{current ? <><header className="client-conversation-header"><Link className="client-back" to={root + '/messages'}>All conversations</Link><h2 ref={heading} tabIndex={-1}>{current.name}</h2>{current.description && <p>{current.description}</p>}<nav aria-label="Conversation views"><button type="button" onClick={() => setParams({})}>Messages</button><button type="button" onClick={() => setParams({ files: '1' })}>Files</button><Link to={root + '/meetings?conversationId=' + current.id}>Meetings</Link></nav><ConversationNotifications conversationId={current.id}/></header>{params.get('files') === '1' ? <SharedFiles key={current.id + revision} conversationId={current.id}/> : <><MessageTimeline key={current.id} channel={current} userId={relationship.id} targetId={params.get('message')} subscribe={subscribe} revision={revision} drafts={drafts.current} inaccessible={inaccessible} read={read} openThread={message => setParams({ thread: message.id })}/>{params.get('thread') && <ThreadPanel key={current.id + params.get('thread')} channel={current} userId={relationship.id} rootId={params.get('thread')!} targetId={params.get('message')} subscribe={subscribe} revision={revision} drafts={drafts.current} close={() => setParams({})} inaccessible={inaccessible} read={read}/>}</>}</> : <div className="client-empty"><h2>{conversationId ? 'Opening conversation…' : 'Your conversations with this business'}</h2><p>Choose a conversation to view messages, files and meeting invitations.</p></div>}</section>
    {searchOpen && <ChatSearch channels={channels.rows} userId={relationship.id} close={() => setSearchOpen(false)}/>}
  </div>;
}
export function ClientFiles() {
  const channels = useClientChannels(); const [selected, setSelected] = useState(''); const { revision, watch } = usePortalLive();
  const allowed = channels.rows.some(value => value.id === selected);
  useEffect(() => { watch(null); }, [watch]);
  return <section className="client-card"><h1>Shared files</h1><p>Files are grouped by the conversations where they were shared.</p><label>Conversation<select value={allowed ? selected : ''} onChange={event => setSelected(event.target.value)}><option value="">Choose a conversation</option>{channels.rows.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>{channels.error && <p role="alert">{channels.error}</p>}{channels.cursor && <button type="button" onClick={() => void channels.more()} disabled={channels.loading}>More conversations</button>}{allowed ? <SharedFiles key={selected + revision} conversationId={selected}/> : <p>Select a conversation to view its authorised files.</p>}</section>;
}
