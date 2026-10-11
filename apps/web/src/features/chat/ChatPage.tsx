import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, CheckCheck, Hash, Info, Lock, MessageSquare, Plus, Search, Users, X } from 'lucide-react';
import type { CommunicationsEvent, NativeConversation, NativeMessage } from '@ks-os/contracts';
import { useAuth } from '../../auth/useAuth';
import { chatApi, ChatError, type DiscoveredChannel } from './chat.api';
import { connectChat, type ConnectionState } from './chat.realtime';
import { ChannelDetails, CreateChannelDialog } from './ChannelDialogs';
import { MessageTimeline, type SubscribeChat } from './MessageTimeline';
import { MessageItem } from './MessageItem';
import type { Draft } from './MessageComposer';
import './chat.css';

function ThreadPanel({ channel, userId, rootId, subscribe, revision, drafts, close, inaccessible, read }: {
  channel: NativeConversation; userId: string; rootId: string; subscribe: SubscribeChat; revision: number; drafts: Map<string,Draft>;
  close: () => void; inaccessible: () => void; read: (id:string) => Promise<void>;
}) {
  const [root,setRoot]=useState<NativeMessage|null>(null),[error,setError]=useState('');
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{
    let active=true;
    const refresh=()=>void chatApi.message(channel.id,rootId).then(message=>{
      if(!active)return;
      if(message.parentMessageId){setError('Open a thread from its original message.');return;}
      setRoot(message);
    }).catch(cause=>{if(active)setError(cause.message);});
    refresh();
    const unsubscribe=subscribe(event=>{if(event.conversationId===channel.id && event.resourceId===rootId)refresh();});
    return()=>{active=false;unsubscribe();};
  },[channel.id,rootId,subscribe,revision]);
  return <section className="chat-thread" aria-label="Message thread"><header className="chat-panel-header"><h2 ref={heading} tabIndex={-1}>Thread</h2><button type="button" onClick={close} aria-label="Close thread"><X size={20} aria-hidden="true"/></button></header>
    {error ? <p role="alert" className="chat-error">{error}</p> : root ? <><div className="chat-thread-root"><MessageItem message={root} userId={userId} archived={Boolean(channel.archivedAt)} changed={setRoot}/></div><MessageTimeline key={rootId} channel={channel} userId={userId} parent={rootId} subscribe={subscribe} revision={revision} drafts={drafts} inaccessible={inaccessible} read={read} label="Thread replies"/></> : <p role="status" className="chat-muted">Loading thread…</p>}
  </section>;
}

export default function ChatPage() {
  const {businessReference}=useAuth();
  return <ChatWorkspace key={businessReference}/>;
}

export function ChatWorkspace() {
  const {conversationId}=useParams();
  const navigate=useNavigate(),[params,setParams]=useSearchParams();
  const threadId=params.get('thread'),details=params.get('details')==='1';
  const [channels,setChannels]=useState<NativeConversation[]>([]),[channel,setChannel]=useState<NativeConversation|null>(null),[discovered,setDiscovered]=useState<DiscoveredChannel[]>([]);
  const [search,setSearch]=useState(''),[cursor,setCursor]=useState<string|null>(null),[discoverCursor,setDiscoverCursor]=useState<string|null>(null),[discovering,setDiscovering]=useState(false);
  const [capabilities,setCapabilities]=useState<{userId:string;canCreateChannels:boolean}|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[create,setCreate]=useState(false),[busy,setBusy]=useState(false);
  const [connection,setConnection]=useState<ConnectionState>('connecting'),[revision,setRevision]=useState(0);
  const drafts=useRef(new Map<string,Draft>()),listeners=useRef(new Set<(event:CommunicationsEvent)=>void>()),heading=useRef<HTMLHeadingElement>(null),listHeading=useRef<HTMLHeadingElement>(null);
  const context=useRef({conversationId,search});context.current={conversationId,search};
  const subscribe:SubscribeChat=useCallback(listener=>{listeners.current.add(listener);return()=>{listeners.current.delete(listener);};},[]);
  const inaccessible=useCallback(()=>{setChannel(null);setNotice('This channel is no longer available to you.');navigate('/app/chat',{replace:true});},[navigate]);
  const refresh=useCallback(async()=>{
    if(!conversationId)return;
    const current=await chatApi.channel(conversationId);
    setChannel(current);
    setChannels(values=>current.archivedAt?values.filter(c=>c.id!==current.id):values.map(c=>c.id===current.id?current:c));
  },[conversationId]);
  const read=useCallback(async(messageId:string)=>{
    if(!conversationId)return;
    await chatApi.read(conversationId,messageId);await refresh();
  },[conversationId,refresh]);
  useEffect(()=>{
    let active=true;
    void chatApi.capabilities().then(result=>{if(active)setCapabilities(result);}).catch(cause=>{if(active){setError(cause.message);setLoading(false);}});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);
    const timer=setTimeout(()=>{void chatApi.channels(search,'',controller.signal).then(page=>{if(!controller.signal.aborted){setChannels(page.data);setCursor(page.nextCursor);setError('');}}).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},200);
    return()=>{controller.abort();clearTimeout(timer);};
  },[search]);
  useEffect(()=>{
    setChannel(null);
    if(!conversationId){listHeading.current?.focus();return;}
    let active=true;setError('');
    void chatApi.channel(conversationId).then(result=>{if(active){if(!['CHANNEL','PRIVATE_CHANNEL'].includes(result.type)){setError('Choose a team channel.');return;}setChannel(result);requestAnimationFrame(()=>heading.current?.focus());}}).catch(cause=>{if(active){if(cause instanceof ChatError && [401,403,404].includes(cause.status))inaccessible();else setError(cause.message);}});
    return()=>{active=false;};
  },[conversationId,inaccessible]);
  useEffect(()=>{
    if(!discovering)return;
    const controller=new AbortController();
    const timer=setTimeout(()=>void chatApi.discover(search,'',controller.signal).then(page=>{if(!controller.signal.aborted){setDiscovered(page.data);setDiscoverCursor(page.nextCursor);}}).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);}),200);
    return()=>{controller.abort();clearTimeout(timer);};
  },[discovering,search]);
  useEffect(()=>{
    if(!capabilities)return;
    let active=true,working=false;const pending=new Set<string>();let timer:ReturnType<typeof setTimeout>|undefined;
    const hydrate=async(id:string)=>{
      try{
        const value=await chatApi.channel(id);if(!active)return;
        if(!['CHANNEL','PRIVATE_CHANNEL'].includes(value.type))return;
        if(context.current.conversationId===id)setChannel(value);
        setChannels(current=>{
          if(value.archivedAt || !value.name.toLowerCase().includes(context.current.search.toLowerCase()))return current.filter(c=>c.id!==id);
          return [...current.filter(c=>c.id!==id),value].sort((a,b)=>a.name.localeCompare(b.name));
        });
      }catch(cause){
        if(!active)return;
        if(cause instanceof ChatError && [401,403,404].includes(cause.status)){
          setChannels(current=>current.filter(c=>c.id!==id));
          if(context.current.conversationId===id)inaccessible();
        }else setError(cause instanceof Error?cause.message:'Chat could not refresh');
      }
    };
    const flush=async()=>{working=true;while(active && pending.size){const ids=[...pending];pending.clear();await Promise.all(ids.map(hydrate));}working=false;};
    const stop=connectChat({
      state:value=>{if(active)setConnection(value);},
      ready:async()=>{
        const page=await chatApi.channels(context.current.search);if(!active)return;
        setChannels(page.data);setCursor(page.nextCursor);setRevision(value=>value+1);
        if(context.current.conversationId)await hydrate(context.current.conversationId);
      },
      event:event=>{
        if(!active)return;
        for(const listener of listeners.current)listener(event);
        pending.add(event.conversationId);if(!working){clearTimeout(timer);timer=setTimeout(()=>void flush(),150);}
      },
      revoked:()=>{if(active){setChannels([]);setChannel(null);drafts.current.clear();setError('Your session is no longer available. Sign in again to use Chat.');}},
    });
    return()=>{active=false;clearTimeout(timer);stop();};
  },[capabilities,inaccessible]);
  const closePanel=()=>{setParams({});requestAnimationFrame(()=>heading.current?.focus());};
  const choose=(id:string)=>{setNotice('');navigate('/app/chat/'+id);};
  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(cause){setError(cause instanceof Error?cause.message:'Chat could not complete this request');}finally{setBusy(false);}};
  const status={connecting:'Connecting…',connected:'Connected',reconnecting:'Reconnecting…',unavailable:'Sign-in required'}[connection];
  return <div className={'chat-workspace'+(conversationId?' chat-has-channel':'')+((threadId || details)?' chat-has-panel':'')}>
    <aside className="chat-channel-nav" aria-label="Channel navigation"><header className="chat-nav-header"><div><p className="chat-eyebrow">Your workspace</p><h1 ref={listHeading} tabIndex={-1}>Chat</h1></div>{capabilities?.canCreateChannels && <button type="button" aria-label="Create channel" title="Create channel" onClick={()=>setCreate(true)}><Plus size={20} aria-hidden="true"/></button>}</header>
      <label className="chat-search"><Search size={17} aria-hidden="true"/><span className="sr-only">Search channels</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Find a channel"/></label>
      <button type="button" className="chat-discover-toggle" aria-expanded={discovering} onClick={()=>setDiscovering(!discovering)}><Search size={15} aria-hidden="true"/>{discovering?'Hide channel discovery':'Discover public channels'}</button>
      <div className="chat-channels-scroll">
        {loading ? <div role="status" className="chat-loading"><span className="sr-only">Loading channels</span><div className="chat-skeleton"/><div className="chat-skeleton"/></div> : <>
          {(['CHANNEL','PRIVATE_CHANNEL'] as const).map(type=><details key={type} open className="chat-channel-group"><summary>{type==='CHANNEL'?'Public channels':'Private channels'} <span>{channels.filter(c=>c.type===type).length}</span></summary><ul>{channels.filter(c=>c.type===type).map(item=><li key={item.id}><Link to={'/app/chat/'+item.id} aria-current={conversationId===item.id?'page':undefined} className={item.unreadCount?'chat-unread':''}>{type==='CHANNEL'?<Hash size={17} aria-hidden="true"/>:<Lock size={16} aria-hidden="true"/>}<span>{item.name}</span>{Boolean(item.unreadCount) && <b aria-label={item.unreadCount+' unread messages'}>{item.unreadCount!>99?'99+':item.unreadCount}</b>}</Link></li>)}</ul></details>)}
          {!channels.length && <p className="chat-muted">No channels found. Discover a public channel{capabilities?.canCreateChannels?' or create one':''} to get started.</p>}
          {cursor && <button type="button" disabled={busy} onClick={()=>void run(async()=>{const page=await chatApi.channels(search,cursor);setChannels(current=>[...new Map([...current,...page.data].map(c=>[c.id,c])).values()]);setCursor(page.nextCursor);})}>More channels</button>}
        </>}
        {discovering && <section className="chat-discovery"><h2>Discover channels</h2><p className="chat-muted">Public to your workspace. Join to read and take part.</p>{discovered.map(item=><div key={item.id}><strong># {item.name}</strong><p>{item.description}</p><button type="button" disabled={busy} onClick={()=>void run(async()=>{await chatApi.action(item.id,'join');setDiscovered(values=>values.filter(v=>v.id!==item.id));choose(item.id);})}>Join {item.name}</button></div>)}{!discovered.length && <p className="chat-muted">No other public channels match.</p>}{discoverCursor && <button type="button" disabled={busy} onClick={()=>void run(async()=>{const page=await chatApi.discover(search,discoverCursor);setDiscovered(values=>[...values,...page.data]);setDiscoverCursor(page.nextCursor);})}>Discover more</button>}</section>}
      </div>
      <footer className="chat-connection" role="status"><span className={'chat-status-dot '+connection}/>{status}</footer>
    </aside>
    <div className="chat-main">
      {error && <p role="alert" className="chat-error">{error}</p>}{notice && <p role="status" className="chat-notice">{notice}</p>}
      {channel && capabilities ? <>
        <header className="chat-conversation-header"><button type="button" className="chat-mobile-back" aria-label="Back to channels" onClick={()=>navigate('/app/chat')}><ArrowLeft size={20} aria-hidden="true"/></button><div className="chat-channel-title"><div>{channel.type==='PRIVATE_CHANNEL'?<Lock size={21} aria-hidden="true"/>:<Hash size={23} aria-hidden="true"/>}<h2 ref={heading} tabIndex={-1}>{channel.name}</h2></div><p>{channel.archivedAt?'Archived · Read only':channel.description || 'A shared space for your team'}</p></div>
          <button type="button" className="chat-member-count" onClick={()=>setParams({details:'1'})} aria-label={'View '+channel.memberCount+' channel members'}><Users size={17} aria-hidden="true"/>{channel.memberCount}</button>
          <button type="button" aria-label="Channel details" title="Channel details" onClick={()=>setParams({details:'1'})}><Info size={20} aria-hidden="true"/></button>
          {Boolean(channel.unreadCount) && channel.latestMessageId && <button type="button" aria-label="Mark channel and threads as read" title="Mark channel and threads as read" onClick={()=>void run(()=>read(channel.latestMessageId!))}><CheckCheck size={20} aria-hidden="true"/></button>}
        </header>
        <MessageTimeline key={channel.id} channel={channel} userId={capabilities.userId} subscribe={subscribe} revision={revision} drafts={drafts.current} openThread={message=>setParams({thread:message.id})} inaccessible={inaccessible} read={read}/>
      </> : <div className="chat-welcome"><div><MessageSquare size={32} aria-hidden="true"/></div><p className="chat-eyebrow">Together, in the loop</p><h2>{conversationId?'Opening your channel…':'Room for every conversation'}</h2><p>Keep team updates, questions and ideas in one place.<br/>Choose a channel to join the conversation.</p>{capabilities?.canCreateChannels && !conversationId && <button type="button" className="chat-primary" onClick={()=>setCreate(true)}><Plus size={16} aria-hidden="true"/>Create a channel</button>}</div>}
    </div>
    {channel && capabilities && (threadId || details) && <aside className="chat-context-panel" onKeyDown={event=>{if(event.key==='Escape' && event.target===event.currentTarget)closePanel();}}>
      {threadId ? <ThreadPanel key={channel.id+threadId} channel={channel} userId={capabilities.userId} rootId={threadId} subscribe={subscribe} revision={revision} drafts={drafts.current} close={closePanel} inaccessible={inaccessible} read={read}/> : <ChannelDetails key={channel.id} channel={channel} userId={capabilities.userId} refresh={refresh} close={closePanel} closed={inaccessible}/>}
    </aside>}
    {create && <CreateChannelDialog close={()=>setCreate(false)} created={value=>{setCreate(false);setChannels(channels=>[...channels.filter(c=>c.id!==value.id),value]);choose(value.id);setNotice('Channel created');}}/>}
  </div>;
}
