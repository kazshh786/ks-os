import { ReadReceipt, TypingStatus } from './ChatLive';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CommunicationsEvent, NativeConversation, NativeMessage } from '@ks-os/contracts';
import { chatApi, ChatError } from './chat.api';
import { mergeMessages } from './chat.realtime';
import { MessageItem } from './MessageItem';
import { MessageComposer, type Draft } from './MessageComposer';

export type SubscribeChat = (listener: (event: CommunicationsEvent) => void) => () => void;
export function MessageTimeline({ channel, userId, parent, subscribe, revision, drafts, openThread, inaccessible, read, targetId, label = 'Channel messages' }: {
  channel: NativeConversation; userId: string; parent?: string; subscribe: SubscribeChat; revision: number; drafts: Map<string,Draft>;
  openThread?: (message: NativeMessage) => void; inaccessible: () => void; read: (id: string) => Promise<void>; targetId?:string|null; label?: string;
}) {
  const [messages,setMessages]=useState<NativeMessage[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[more,setMore]=useState(false),[error,setError]=useState(''),[newer,setNewer]=useState(false);
  const scroll=useRef<HTMLDivElement>(null),bottom=useRef(true),live=useRef(true),frozen=useRef(false),reading=useRef(false),seenRead=useRef(channel.lastReadPosition),preserve=useRef<{id:string;offset:number}|null>(null),jump=useRef(true);
  const anchored=useRef<string|null>(null);
  const current=useRef<NativeMessage[]>([]),generation=useRef(0),updates=useRef(new Map<string,{generation:number;message:NativeMessage}>());
  const put=useCallback((rows:NativeMessage[])=>{current.current=rows;setMessages(rows);},[]);
  const reconcile=useCallback((rows:NativeMessage[],started:number)=>{
    const newer=[...updates.current.values()].filter(update=>update.generation>started).map(update=>update.message);
    return mergeMessages(rows,newer).filter(message=>message.parentMessageId===(parent ?? null));
  },[parent]);
  const draftKey=`${channel.id}:${parent || 'root'}`;
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const fail=useCallback((cause:unknown)=>{if(!live.current)return;if(cause instanceof ChatError && [401,403,404].includes(cause.status)){setMessages([]);inaccessible();}else setError(cause instanceof Error?cause.message:'Could not load messages');},[inaccessible]);
  const latest=useCallback(async()=>{
    setLoading(true);setError('');
    try{const started=generation.current;const page=await chatApi.messages(channel.id,parent);if(!live.current)return;jump.current=true;frozen.current=false;bottom.current=true;setNewer(false);put(reconcile(page.data,started).slice(-200));setCursor(page.nextCursor);}
    catch(cause){fail(cause);}finally{if(live.current)setLoading(false);}
  },[channel.id,parent,fail,put,reconcile]);
  useEffect(()=>{void latest();},[latest]);
  useEffect(()=>{
    if(!targetId){anchored.current=null;return;}if(loading||anchored.current===targetId)return;anchored.current=targetId;let active=true;
    void chatApi.message(channel.id,targetId).then(async target=>{
      if(target.parentMessageId!==(parent??null))return;
      const page=await chatApi.messages(channel.id,parent,(BigInt(target.position)+1n).toString());
      if(!active)return;frozen.current=true;bottom.current=false;jump.current=false;put(mergeMessages(page.data,[target]));setCursor(page.nextCursor);setNewer(true);
      requestAnimationFrame(()=>{const el=scroll.current?.querySelector<HTMLElement>('[data-message-id="'+targetId+'"]');el?.scrollIntoView({block:'center'});el?.focus();});
    }).catch(fail);return()=>{active=false;};
  },[targetId,channel.id,parent,put,fail,loading]);
  // Reconcile a bounded window after reconnect, including edits and tombstones in older loaded pages.
  useEffect(()=>{
    if(!revision || !current.current.length)return;
    let active=true;
    const refresh=async()=>{
      try{
        const started=generation.current;
        const rows=await chatApi.resolve(channel.id,current.current.map(message=>message.id));
        if(active)put(reconcile(mergeMessages(current.current,rows),started));
        if(!frozen.current){const began=generation.current;const page=await chatApi.messages(channel.id,parent);if(active){const merged=reconcile(mergeMessages(current.current,page.data),began);put(merged.slice(-200));if(merged.length>200)setCursor(merged.at(-200)!.position);}}
      }catch(cause){if(active)fail(cause);}
    };void refresh();return()=>{active=false;};
  },[revision,channel.id,parent,fail,put,reconcile]);
  const changed=useCallback((message:NativeMessage)=>{
    if(!live.current || message.parentMessageId!==(parent ?? null))return;
    updates.current.set(message.id,{generation:++generation.current,message});
    // Only retain enough concurrent invalidations to reconcile the bounded history window.
    if(updates.current.size>400)updates.current.delete(updates.current.keys().next().value!);
    const previous=current.current,existing=previous.some(m=>m.id===message.id);
    if(frozen.current && !existing){setNewer(true);return;}
    if(!existing && !bottom.current)setNewer(true);
    jump.current=bottom.current;
    const merged=mergeMessages(previous,[message]);
    if(merged.length>200 && !bottom.current){frozen.current=true;setNewer(true);return;}
    if(merged.length>200)setCursor(merged.at(-200)!.position);
    put(merged.slice(-200));
  },[parent,put]);
  useEffect(()=>{
    let active=true,working=false;const pending=new Set<string>();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const flush=async()=>{
      working=true;
      while(active && pending.size){const ids=[...pending].slice(0,200);ids.forEach(id=>pending.delete(id));try{
        const started=generation.current;const rows=await chatApi.resolve(channel.id,ids);
        if(!active)break;
        const roots=new Set<string>();
        for(const row of rows){const update=updates.current.get(row.id);const message=update && update.generation>started?update.message:row;changed(message);if(!parent && message.parentMessageId)roots.add(message.parentMessageId);}
        if(roots.size){const rootRows=await chatApi.resolve(channel.id,[...roots]);if(active)rootRows.forEach(changed);}
      }catch(cause){if(active)fail(cause);}}
      working=false;
    };
    const unsubscribe=subscribe(event=>{if(event.conversationId!==channel.id || !event.type.startsWith('message.'))return;pending.add(event.resourceId);if(!working){clearTimeout(timer);timer=setTimeout(()=>void flush(),100);}});
    return()=>{active=false;clearTimeout(timer);unsubscribe();};
  },[channel.id,parent,subscribe,changed,fail]);
  useLayoutEffect(()=>{
    const element=scroll.current;if(!element)return;
    if(preserve.current){const anchor=Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(row=>row.dataset.messageId===preserve.current!.id);if(anchor)element.scrollTop+=anchor.getBoundingClientRect().top-element.getBoundingClientRect().top-preserve.current.offset;preserve.current=null;}
    else if(jump.current){element.scrollTop=element.scrollHeight;jump.current=false;}
  },[messages]);
  const markVisible=useCallback(()=>{
    const last=current.current.at(-1),element=scroll.current;
    if(reading.current || parent || frozen.current || !bottom.current || !last || channel.latestMessageId!==last.id || !element?.clientHeight || document.visibilityState!=='visible' || !document.hasFocus() || BigInt(last.position)<=BigInt(seenRead.current))return;
    reading.current=true;
    void read(last.id).then(()=>{seenRead.current=last.position;}).catch(fail).finally(()=>{reading.current=false;});
  },[channel.latestMessageId,parent,read,fail]);
  useEffect(()=>{const timer=setTimeout(markVisible,1200);window.addEventListener('focus',markVisible);document.addEventListener('visibilitychange',markVisible);return()=>{clearTimeout(timer);window.removeEventListener('focus',markVisible);document.removeEventListener('visibilitychange',markVisible);};},[messages,markVisible]);
  const older=async()=>{
    if(!cursor || more)return;setMore(true);setError('');
    try{const started=generation.current;const page=await chatApi.messages(channel.id,parent,cursor);if(!live.current)return;const element=scroll.current;
      if(element){const top=element.getBoundingClientRect().top;const anchor=Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(row=>row.getBoundingClientRect().bottom>top);if(anchor)preserve.current={id:anchor.dataset.messageId!,offset:anchor.getBoundingClientRect().top-top};}
      bottom.current=false;jump.current=false;const merged=reconcile(mergeMessages(current.current,page.data),started);if(merged.length>200){frozen.current=true;setNewer(true);}put(merged.slice(0,200));setCursor(page.nextCursor);}
    catch(cause){fail(cause);}finally{if(live.current)setMore(false);}
  };
  return <div className="chat-timeline-shell">
    <div ref={scroll} className="chat-timeline" role="region" aria-label={label} tabIndex={0} onScroll={()=>{const el=scroll.current!;bottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<50;}} onPointerUp={markVisible} onKeyUp={markVisible}>
      {loading && <div role="status" className="chat-loading"><span className="sr-only">Loading messages</span>{[1,2,3].map(i=><div key={i} className="chat-skeleton"/>)}</div>}
      {error && <div className="chat-error" role="alert">{error}<button type="button" onClick={()=>void latest()}>Try again</button></div>}
      {!loading && cursor && <button type="button" className="chat-load-older" disabled={more} onClick={()=>void older()}>{more?'Loading…':'Load older messages'}</button>}
      {!loading && !messages.length && !error && <div className="chat-empty"><h3>{parent?'Start this thread':'The conversation starts here'}</h3><p>{parent?'Reply to keep this discussion together.':'Share an update, ask a question, or say hello to your team.'}</p></div>}
      {messages.map((message,index)=>{
        const previous=messages[index-1],day=new Date(message.createdAt).toLocaleDateString();
        const sameDay=previous && new Date(previous.createdAt).toLocaleDateString()===day;
        const grouped=Boolean(sameDay && !message.editedAt && previous.senderId===message.senderId && new Date(message.createdAt).getTime()-new Date(previous.createdAt).getTime()<300000);
        return <div key={message.id} data-message-id={message.id} tabIndex={targetId===message.id?-1:undefined} className={targetId===message.id?'chat-search-target':undefined}>{!sameDay && <div className="chat-date"><span>{new Date(message.createdAt).toLocaleDateString([], {weekday:'short',day:'numeric',month:'long'})}</span></div>}<MessageItem message={message} grouped={grouped} userId={userId} archived={Boolean(channel.archivedAt)} thread={openThread} changed={changed}/><ReadReceipt message={message} userId={userId}/></div>;
      })}
    </div>
    {newer && <button type="button" className="chat-new-messages" onClick={()=>void latest()}>Back to latest messages ↓</button>}
    <TypingStatus conversationId={channel.id}/>
    <MessageComposer key={draftKey} channelId={channel.id} label={parent?'Reply to thread':`Message ${channel.name}`} initial={drafts.get(draftKey)} saveDraft={(draft,expected)=>{const saved=drafts.get(draftKey);if(expected && (saved?.clientMessageId!==expected.clientMessageId || saved?.body!==expected.body))return;if(draft.body)drafts.set(draftKey,draft);else drafts.delete(draftKey);}} disabled={Boolean(channel.archivedAt)} send={async draft=>{const message=await chatApi.send(channel.id,{...draft,parentMessageId:parent});if(!live.current)return;bottom.current=true;changed(message);if(frozen.current)await latest();}}/>
  </div>;
}
