import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { NativeConversation, NativeMessage } from '@ks-os/contracts';
import { MessageTimeline, type SubscribeChat } from './MessageTimeline';
import { MessageItem } from './MessageItem';
import type { Draft } from './MessageComposer';
import { useChatServices } from './ChatServices';
export function ThreadPanel({ channel, userId, rootId, subscribe, revision, drafts, close, inaccessible, read, targetId }: {
  channel: NativeConversation; userId: string; rootId: string; subscribe: SubscribeChat; revision: number; drafts: Map<string,Draft>;
  close: () => void; inaccessible: () => void; read: (id:string) => Promise<void>;targetId?:string|null;
}) {
  const { api: chatApi } = useChatServices();
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
    {channel.type==='CLIENT' && channel.externalClientChannel && <p className="client-external-warning">Customer-visible thread · Replies are shared with this channel’s invited contacts.</p>}
    {error ? <p role="alert" className="chat-error">{error}</p> : root ? <><div className="chat-thread-root"><MessageItem message={root} userId={userId} archived={Boolean(channel.archivedAt) || channel.canPost === false} changed={setRoot}/></div><MessageTimeline key={rootId} channel={channel} userId={userId} parent={rootId} subscribe={subscribe} revision={revision} drafts={drafts} inaccessible={inaccessible} read={read} targetId={targetId} label="Thread replies"/></> : <p role="status" className="chat-muted">Loading thread…</p>}
  </section>;
}

