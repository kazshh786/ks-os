import { isClientChannel } from '../client-collaboration/collaboration.api';
import { CreateClientChannel } from '../client-collaboration/CreateClientChannel';
import { ClientChannelAccess } from '../client-collaboration/ClientChannelAccess';
import { ClientChannelMeetings } from '../client-collaboration/ClientChannelMeetings';
import '../client-collaboration/collaboration.css';
import { CallWorkspace } from '../calls/CallWorkspace';
import { invalidateMeetings, publishMeetingEvent } from '../meetings/meetings.live';
import { ConversationCalls } from '../calls/ConversationCalls';
import { ChatSearch } from './ChatSearch';
import { SharedFiles } from './ChatAttachments';
import { ChatNotifications,ConversationNotifications } from './ChatNotifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, CheckCheck, Hash, Info, Lock, MessageSquare, Plus, Search, Users, X } from 'lucide-react';
import type { ChatEphemeral, ChatSignal, CommunicationsEvent, NativeConversation } from '@ks-os/contracts';
import { useAuth } from '../../auth/useAuth';
import { chatApi, ChatError, type DiscoveredChannel } from './chat.api';
import { connectChat, type ConnectionState } from './chat.realtime';
import { ChatLiveContext, PresenceLabel } from './ChatLive';
import { ChannelDetails, CreateChannelDialog, NewMessageDialog } from './ChannelDialogs';
import { MessageTimeline, type SubscribeChat } from './MessageTimeline';
import { ThreadPanel } from './ThreadPanel';
import type { Draft } from './MessageComposer';
import './chat.css';

export default function ChatPage() {
  const {businessReference}=useAuth();
  return <ChatWorkspace key={businessReference}/>;
}

export function ChatWorkspace() {
  const {conversationId}=useParams();
  const navigate=useNavigate(),[params,setParams]=useSearchParams();
  const threadId=params.get('thread'),details=params.get('details')==='1',files=params.get('files')==='1',meetings=params.get('meetings')==='1';
  const [channels,setChannels]=useState<NativeConversation[]>([]),[channel,setChannel]=useState<NativeConversation|null>(null),[discovered,setDiscovered]=useState<DiscoveredChannel[]>([]);
  const [search,setSearch]=useState(''),[cursor,setCursor]=useState<string|null>(null),[discoverCursor,setDiscoverCursor]=useState<string|null>(null),[discovering,setDiscovering]=useState(false);
  const [capabilities,setCapabilities]=useState<{userId:string;canCreateChannels:boolean;canCreateClientChannels?:boolean}|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[create,setCreate]=useState(false),[busy,setBusy]=useState(false);
  const [messageSearch,setMessageSearch]=useState(false),[createClient,setCreateClient]=useState(false);
  const [newMessage,setNewMessage]=useState(false),[snapshot,setSnapshot]=useState<ChatEphemeral|null>(null);
  const liveControl=useRef<ReturnType<typeof connectChat>|null>(null);
  const signal=useCallback((value:ChatSignal)=>liveControl.current?.signal(value),[]);
  const [connection,setConnection]=useState<ConnectionState>('connecting'),[revision,setRevision]=useState(0);
  const drafts=useRef(new Map<string,Draft>()),listeners=useRef(new Set<(event:CommunicationsEvent)=>void>()),heading=useRef<HTMLHeadingElement>(null),listHeading=useRef<HTMLHeadingElement>(null);
  const context=useRef({conversationId,search});context.current={conversationId,search};
  const subscribe:SubscribeChat=useCallback(listener=>{listeners.current.add(listener);return()=>{listeners.current.delete(listener);};},[]);
  const inaccessible=useCallback(()=>{setChannel(null);setNotice('This conversation is no longer available to you.');navigate('/app/chat',{replace:true});},[navigate]);
  const refresh=useCallback(async()=>{
    if(!conversationId)return;
    const current=await chatApi.channel(conversationId);
    if(context.current.conversationId!==conversationId)return;
    if(!['CHANNEL','PRIVATE_CHANNEL','DIRECT','GROUP_DIRECT'].includes(current.type) && !isClientChannel(current))throw new Error('This conversation is not supported.');
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
    void chatApi.channel(conversationId).then(result=>{if(active){if(!['CHANNEL','PRIVATE_CHANNEL','DIRECT','GROUP_DIRECT'].includes(result.type) && !isClientChannel(result)){setError('This conversation is not supported.');return;}setChannel(result);requestAnimationFrame(()=>heading.current?.focus());}}).catch(cause=>{if(active){if(cause instanceof ChatError && [401,403,404].includes(cause.status))inaccessible();else setError(cause.message);}});
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
        if(!['CHANNEL','PRIVATE_CHANNEL','DIRECT','GROUP_DIRECT'].includes(value.type) && !isClientChannel(value))return;
        if(context.current.conversationId===id)setChannel(value);
        setChannels(current=>{
          if(value.archivedAt || !value.name.toLowerCase().includes(context.current.search.toLowerCase()))return current.filter(c=>c.id!==id);
          return [...current.filter(c=>c.id!==id),value].sort((a,b)=>(b.lastActivityAt || b.createdAt).localeCompare(a.lastActivityAt || a.createdAt) || b.id.localeCompare(a.id));
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
      state:value=>{if(active){setConnection(value);if(value!=='connected')setSnapshot(null);}},
      ephemeral:value=>{if(active)setSnapshot(value);},
      ready:async()=>{
        const page=await chatApi.channels(context.current.search);if(!active)return;
        setChannels(page.data);setCursor(page.nextCursor);setRevision(value=>value+1);invalidateMeetings();
        if(context.current.conversationId)await hydrate(context.current.conversationId);
      },
      event:event=>{
        if(!active)return;
        publishMeetingEvent(event);
        for(const listener of listeners.current)listener(event);
        if(event.conversationId)pending.add(event.conversationId);if(!working){clearTimeout(timer);timer=setTimeout(()=>void flush(),150);}
      },
      revoked:()=>{if(active){setChannels([]);setChannel(null);setCapabilities(null);drafts.current.clear();setError('Your session is no longer available. Sign in again to use Chat.');}},
    });
    liveControl.current=stop;
    return()=>{active=false;liveControl.current=null;clearTimeout(timer);stop();};
  },[capabilities,inaccessible]);
  const peerIds=channels.flatMap(c=>c.peerUserId?[c.peerUserId]:[]).sort().slice(0,100).join(',');
  useEffect(()=>{
    setSnapshot(null);
    signal({type:'watch',conversationId:channel && ['DIRECT','GROUP_DIRECT','CLIENT'].includes(channel.type)?channel.id:null,userIds:peerIds?peerIds.split(','):[]});
  },[channel?.id,channel?.type,peerIds,signal,capabilities]);
  const closePanel=()=>{setParams(current=>{const next=new URLSearchParams();if(current.get('call'))next.set('call',current.get('call')!);return next;});requestAnimationFrame(()=>heading.current?.focus());};
  const callQuery=params.get('call')?'?call='+encodeURIComponent(params.get('call')!):'';
  const choose=(id:string)=>{setNotice('');navigate('/app/chat/'+id+callQuery);};
  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(cause){setError(cause instanceof Error?cause.message:'Chat could not complete this request');}finally{setBusy(false);}};
  const status={connecting:'Connecting…',connected:'Connected',reconnecting:'Reconnecting…',unavailable:'Sign-in required'}[connection];
  return <ChatLiveContext.Provider value={{snapshot,signal,activeConversationId:channel && ['DIRECT','GROUP_DIRECT','CLIENT'].includes(channel.type)?channel.id:undefined}}><div className={'chat-workspace'+(conversationId?' chat-has-channel':'')+((threadId || details || files || meetings)?' chat-has-panel':'')}>
    {capabilities && <CallWorkspace subscribe={subscribe} revision={revision} userId={capabilities.userId}/>}
    <aside className="chat-channel-nav" aria-label="Conversation navigation"><header className="chat-nav-header"><div><p className="chat-eyebrow">Your workspace</p><h1 ref={listHeading} tabIndex={-1}>Chat</h1><small>{channels.filter(c=>Boolean(c.unreadCount)).length} unread conversations</small></div>{capabilities?.canCreateChannels && <button type="button" aria-label="Create channel" title="Create channel" onClick={()=>setCreate(true)}><Plus size={20} aria-hidden="true"/></button>}</header>
      {!conversationId && <>{error && <p role="alert" className="chat-error">{error}</p>}{notice && <p role="status" className="chat-notice">{notice}</p>}</>}
      <button type="button" className="chat-discover-toggle" onClick={()=>setNewMessage(true)}><MessageSquare size={16} aria-hidden="true"/>New message</button>
      <button type="button" className="chat-discover-toggle" onClick={()=>setMessageSearch(true)}><Search size={16} aria-hidden="true"/>Search messages</button>
      {capabilities?.canCreateClientChannels && <button type="button" className="chat-discover-toggle" onClick={()=>setCreateClient(true)}>Create client channel</button>}<ChatNotifications subscribe={subscribe} revision={revision} conversationId={conversationId}/>
      <label className="chat-search"><Search size={17} aria-hidden="true"/><span className="sr-only">Search conversations</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Find a conversation"/></label>
      <button type="button" className="chat-discover-toggle" aria-expanded={discovering} onClick={()=>setDiscovering(!discovering)}><Search size={15} aria-hidden="true"/>{discovering?'Hide channel discovery':'Discover public channels'}</button>
      <div className="chat-channels-scroll">
        {loading ? <div role="status" className="chat-loading"><span className="sr-only">Loading channels</span><div className="chat-skeleton"/><div className="chat-skeleton"/></div> : <>
          {(['CHANNEL','PRIVATE_CHANNEL','DIRECT','GROUP_DIRECT','CLIENT'] as const).map(type=><details key={type} open className="chat-channel-group"><summary>{{CHANNEL:'Public channels',PRIVATE_CHANNEL:'Private channels',DIRECT:'Direct messages',GROUP_DIRECT:'Group chats',CLIENT:'Client channels'}[type]} <span>{channels.filter(c=>c.type===type && (type!=='CLIENT'||isClientChannel(c))).length}</span></summary><ul>{channels.filter(c=>c.type===type && (type!=='CLIENT'||isClientChannel(c))).map(item=><li key={item.id}><Link to={'/app/chat/'+item.id+callQuery} aria-current={conversationId===item.id?'page':undefined} className={item.unreadCount?'chat-unread':''}>
            {type==='CHANNEL'?<Hash size={17} aria-hidden="true"/>:type==='PRIVATE_CHANNEL'?<Lock size={16} aria-hidden="true"/>:type==='DIRECT'?<span className="chat-list-avatar" aria-hidden="true">{item.name.slice(0,2).toUpperCase()}</span>:<Users size={17} aria-hidden="true"/>}
            <span className="chat-conversation-preview"><strong>{item.name}</strong>{type==='CLIENT' && <small className="client-external-label">Customer-visible · {item.clientName}</small>}<small>{item.preview || 'No messages yet'}</small>{item.lastActivityAt && <time dateTime={item.lastActivityAt}>{new Date(item.lastActivityAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time>}{type==='DIRECT' && <PresenceLabel state={snapshot?.presence.find(p=>p.userId===item.peerUserId)?.state}/>}</span>
            {Boolean(item.unreadCount) && <b aria-label={item.unreadCount+' unread messages'}>{item.unreadCount!>99?'99+':item.unreadCount}</b>}</Link></li>)}</ul></details>)}
          {!channels.length && <p className="chat-muted">No conversations found. Start a new message or discover a public channel{capabilities?.canCreateChannels?' or create one':''} to get started.</p>}
          {cursor && <button type="button" disabled={busy} onClick={()=>void run(async()=>{const page=await chatApi.channels(search,cursor);setChannels(current=>[...new Map([...current,...page.data].map(c=>[c.id,c])).values()]);setCursor(page.nextCursor);})}>More conversations</button>}
        </>}
        {discovering && <section className="chat-discovery"><h2>Discover channels</h2><p className="chat-muted">Public to your workspace. Join to read and take part.</p>{discovered.map(item=><div key={item.id}><strong># {item.name}</strong><p>{item.description}</p><button type="button" disabled={busy} onClick={()=>void run(async()=>{await chatApi.action(item.id,'join');setDiscovered(values=>values.filter(v=>v.id!==item.id));choose(item.id);})}>Join {item.name}</button></div>)}{!discovered.length && <p className="chat-muted">No other public channels match.</p>}{discoverCursor && <button type="button" disabled={busy} onClick={()=>void run(async()=>{const page=await chatApi.discover(search,discoverCursor);setDiscovered(values=>[...values,...page.data]);setDiscoverCursor(page.nextCursor);})}>Discover more</button>}</section>}
      </div>
      <footer className="chat-connection" role="status"><span className={'chat-status-dot '+connection}/>{status}</footer>
    </aside>
    <div className="chat-main">
      {conversationId && <>{error && <p role="alert" className="chat-error">{error}</p>}{notice && <p role="status" className="chat-notice">{notice}</p>}</>}
      {channel && capabilities ? <>
        <header className="chat-conversation-header"><button type="button" className="chat-mobile-back" aria-label="Back to channels" onClick={()=>navigate('/app/chat'+callQuery)}><ArrowLeft size={20} aria-hidden="true"/></button><div className="chat-channel-title"><div>{['DIRECT','GROUP_DIRECT'].includes(channel.type)?<MessageSquare size={21} aria-hidden="true"/>:channel.type==='PRIVATE_CHANNEL'?<Lock size={21} aria-hidden="true"/>:<Hash size={23} aria-hidden="true"/>}<h2 ref={heading} tabIndex={-1}>{channel.name}</h2></div><p>{channel.archivedAt?'Archived · Read only':channel.type==='DIRECT'?'Private direct message':channel.type==='GROUP_DIRECT'?'Private group conversation':channel.description || 'A shared space for your team'}</p>{connection!=='connected' && <small role="status">{status}</small>}</div>
          <>{isClientChannel(channel) ? <button type="button" onClick={()=>setParams({meetings:'1'})}>Meetings</button> : <ConversationCalls key={channel.id} conversationId={channel.id} archived={Boolean(channel.archivedAt)} subscribe={subscribe} revision={revision}/>}</>
          <button type="button" onClick={()=>setParams(current=>{const next=new URLSearchParams({files:'1'});if(current.get('call'))next.set('call',current.get('call')!);return next;})}>Files</button>
          <button type="button" className="chat-member-count" onClick={()=>setParams(current=>{const next=new URLSearchParams({details:'1'});if(current.get('call'))next.set('call',current.get('call')!);return next;})} aria-label={'View '+channel.memberCount+' participants'}><Users size={17} aria-hidden="true"/>{channel.memberCount}</button>
          <button type="button" aria-label={['DIRECT','GROUP_DIRECT'].includes(channel.type)?'Conversation details':'Channel details'} title="Conversation details" onClick={()=>setParams(current=>{const next=new URLSearchParams({details:'1'});if(current.get('call'))next.set('call',current.get('call')!);return next;})}><Info size={20} aria-hidden="true"/></button>
          {Boolean(channel.unreadCount) && channel.latestMessageId && <button type="button" aria-label="Mark channel and threads as read" title="Mark channel and threads as read" onClick={()=>void run(()=>read(channel.latestMessageId!))}><CheckCheck size={20} aria-hidden="true"/></button>}
        </header>
        {isClientChannel(channel) && <p className="client-external-warning" role="note">Customer-visible channel · {channel.clientName}. Messages and files are shared with invited contacts.</p>}<MessageTimeline key={channel.id} channel={channel} targetId={params.get('message')} userId={capabilities.userId} subscribe={subscribe} revision={revision} drafts={drafts.current} openThread={message=>setParams(current=>{const next=new URLSearchParams({thread:message.id});if(current.get('call'))next.set('call',current.get('call')!);return next;})} inaccessible={inaccessible} read={read}/>
      </> : <div className="chat-welcome"><div><MessageSquare size={32} aria-hidden="true"/></div><p className="chat-eyebrow">Together, in the loop</p><h2>{conversationId?(error?'Conversation unavailable':'Opening your conversation…'):'Room for every conversation'}</h2><p>Keep team updates, questions and ideas in one place.<br/>Choose a conversation or start a new message.</p>{conversationId && error && <><button type="button" disabled={busy} onClick={()=>void run(refresh)}>Try again</button><Link to="/app/chat">Back to channels</Link></>}{capabilities?.canCreateChannels && !conversationId && <button type="button" className="chat-primary" onClick={()=>setCreate(true)}><Plus size={16} aria-hidden="true"/>Create a channel</button>}</div>}
    </div>
    {channel && capabilities && (threadId || details || files || meetings) && <aside className="chat-context-panel" onKeyDown={event=>{if(event.key==='Escape' && !event.defaultPrevented && !(event.target instanceof Element && event.target.closest('[role="dialog"]'))){event.preventDefault();closePanel();}}}>
      {threadId ? <ThreadPanel key={channel.id+threadId} channel={channel} userId={capabilities.userId} rootId={threadId} targetId={params.get('message')} subscribe={subscribe} revision={revision} drafts={drafts.current} close={closePanel} inaccessible={inaccessible} read={read}/> : meetings && isClientChannel(channel) ? <section className="chat-thread"><header className="chat-panel-header"><h2>Meetings</h2><button type="button" aria-label="Close meetings" onClick={closePanel}><X size={20}/></button></header><ClientChannelMeetings key={channel.id} channel={channel}/></section> : files ? <section className="chat-thread"><header className="chat-panel-header"><h2>Files</h2><button type="button" aria-label="Close files" onClick={closePanel}><X size={20}/></button></header><SharedFiles key={channel.id+channel.updatedAt+revision} conversationId={channel.id}/></section> : <><ConversationNotifications conversationId={channel.id}/>{isClientChannel(channel) ? <><header className="chat-panel-header"><h2>Participants</h2><button type="button" aria-label="Close participants" onClick={closePanel}><X size={20}/></button></header><ClientChannelAccess key={channel.id} channel={channel} userId={capabilities.userId} refresh={refresh} closed={inaccessible}/></> : <ChannelDetails key={channel.id} channel={channel} userId={capabilities.userId} refresh={refresh} close={closePanel} closed={inaccessible}/>}</>}
    </aside>}
    {messageSearch&&<ChatSearch userId={capabilities?.userId} channels={channels} close={()=>setMessageSearch(false)}/>}
    {newMessage && <NewMessageDialog close={()=>setNewMessage(false)} created={value=>{setNewMessage(false);setChannels(current=>[value,...current.filter(c=>c.id!==value.id)]);choose(value.id);}}/>}
    {createClient && <CreateClientChannel close={()=>setCreateClient(false)} created={id=>{setCreateClient(false);choose(id);}}/>}{create && <CreateChannelDialog close={()=>setCreate(false)} created={value=>{setCreate(false);setChannels(channels=>[...channels.filter(c=>c.id!==value.id),value]);choose(value.id);setNotice('Channel created');}}/>}
  </div></ChatLiveContext.Provider>;
}

