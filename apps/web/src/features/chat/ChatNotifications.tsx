import { useCallback,useEffect,useRef,useState } from 'react';
import { useNavigate } from 'react-router';
import type { ChatPreferences } from '@ks-os/contracts';
import { ChatError } from './chat.api';
import { Bell,Settings } from 'lucide-react';
import { ChatDialog } from './ChatDialog';
import type { SubscribeChat } from './MessageTimeline';
import { phase4Api,messageLink,type ChatNotice } from './chat.phase4.api';
export const shouldAlert=(p:ChatPreferences,notice:ChatNotice,conversationId?:string,focused=false)=>!p.dnd&&!(notice.conversationType==='DIRECT'&&!p.directMessages)&&!notice.readAt&&!(focused&&notice.conversationId===conversationId);
export async function browserPermission(){
 if(typeof Notification==='undefined')return 'unsupported';
 if(Notification.permission==='denied')return 'denied';
 return Notification.permission==='granted'?'granted':Notification.requestPermission();
}
export function ChatNotifications({subscribe,revision,conversationId}:{subscribe:SubscribeChat;revision:number;conversationId?:string}){
 const navigate=useNavigate(),[open,setOpen]=useState(false),[settings,setSettings]=useState(false),[preferences,setPreferences]=useState<ChatPreferences|null>(null);
 const [rows,setRows]=useState<ChatNotice[]>([]),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const preferenceRevision=useRef(0),saving=useRef(false);
 const seen=useRef(new Set<string>()),initialized=useRef(false),context=useRef(conversationId),mounted=useRef(true);context.current=conversationId;
 const refresh=useCallback(async(deliver=false)=>{
  try {
   const started=preferenceRevision.current;
   const [page,p]=await Promise.all([phase4Api.notifications(),phase4Api.preferences()]);if(!mounted.current)return;
   setRows(page.data);setCursor(page.nextCursor);if(started===preferenceRevision.current&&!saving.current)setPreferences(p);
   for(const row of page.data){
    const fresh=initialized.current&&!seen.current.has(row.id);seen.current.add(row.id);
    if(!deliver||!fresh||!shouldAlert(p,row,context.current,document.visibilityState==='visible'&&document.hasFocus()))continue;
    const mode=await phase4Api.conversationPreference(row.conversationId);
    if(!mounted.current)return;
    if(mode.mode==='NONE'||mode.mode==='MENTIONS'&&row.type!=='CHAT_MENTION')continue;
    if(p.inApp)setNotice('New Chat activity. Open notifications to view it.');
    if(p.browser&&typeof Notification!=='undefined'&&Notification.permission==='granted'){
     try{const notification=new Notification('New KSOS Chat activity',{body:'Open Chat to view your update.',tag:'ksos-chat-'+row.id,silent:!p.sound});
      notification.onclick=()=>{window.focus();navigate(messageLink(row));notification.close();};
      setTimeout(()=>notification.close(),15000);
     }catch{/* Some mobile browsers require background push, which is outside this phase. */}
    }
   }
   initialized.current=true;
   if(seen.current.size>1000)seen.current=new Set(page.data.map(n=>n.id));
  }catch(e){if(mounted.current){if(e instanceof ChatError&&[401,403].includes(e.status)){setRows([]);setCursor(null);}setError(e instanceof Error?e.message:'Notifications unavailable');}}
 },[navigate]);
 useEffect(()=>{mounted.current=true;void refresh();const timer=setInterval(()=>void refresh(true),30000);
  const stop=subscribe(event=>{if(event.type.startsWith('notification.')||event.type==='conversation.member_left'||event.type==='message.deleted')void refresh(true);});
  return()=>{mounted.current=false;clearInterval(timer);stop();};
 },[refresh,subscribe]);
 useEffect(()=>{if(revision)void refresh(true);},[revision,refresh]);
 const save=async(next:ChatPreferences)=>{const previous=preferences;preferenceRevision.current++;saving.current=true;setPreferences(next);setBusy(true);setError('');try{setPreferences(await phase4Api.savePreferences(next));}catch(e){setPreferences(previous);setError(e instanceof Error?e.message:'Settings could not be saved');}finally{saving.current=false;setBusy(false);}};
 return <div className="chat-notifications">
 <div className="chat-toolbar"><button type="button" onClick={()=>{setOpen(true);setNotice('');void refresh();}}><Bell size={16} aria-hidden="true"/>Notifications{rows.some(n=>!n.readAt)&&<span aria-label="Unread notifications"> •</span>}</button><button type="button" aria-label="Chat notification settings" onClick={()=>setSettings(true)}><Settings size={16} aria-hidden="true"/></button></div>
 {notice&&<p role="status" className="chat-notice">{notice}</p>}
 {open&&<ChatDialog title="Chat notifications" close={()=>setOpen(false)}>
 {error&&<p role="alert">{error}</p>}{!preferences&&<p role="status">Loading notifications…</p>}{preferences&&!rows.length&&<p>You are all caught up.</p>}
 <ul className="chat-notice-list">{rows.map(row=><li key={row.id} className={row.readAt?'':'chat-unread'}>
 <button type="button" onClick={()=>{void phase4Api.readNotice(row.id).then(()=>refresh()).catch(e=>setError(e.message));navigate(messageLink(row));setOpen(false);}}><strong>{row.type==='CHAT_MENTION'?'Mention':row.type==='CHAT_INVITATION'?'Invitation':row.type==='CHAT_THREAD'?'Thread reply':'Message'} · {row.conversationName}</strong><p>{row.senderName} {row.preview}</p><time>{new Date(row.createdAt).toLocaleString()}</time></button>
 {!row.readAt&&<button type="button" onClick={()=>void phase4Api.readNotice(row.id).then(()=>refresh()).catch(e=>setError(e.message))}>Mark read</button>}</li>)}</ul>
 {cursor&&<button disabled={busy} onClick={()=>{setBusy(true);void phase4Api.notifications(cursor).then(page=>{setRows(values=>[...values,...page.data]);setCursor(page.nextCursor);}).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Older notifications</button>}
 </ChatDialog>}
 {settings&&<ChatDialog title="Chat notification settings" close={()=>setSettings(false)}>
 <p>Browser alerts work while your KSOS workspace is open. Some mobile browsers do not support them. Closing the browser stops these alerts.</p>
 {preferences?(<div className="chat-preferences">{(['inApp','sound','dnd','directMessages'] as const).map(key=><label className="chat-check" key={key}><input type="checkbox" disabled={busy} checked={preferences[key]} onChange={e=>void save({...preferences,[key]:e.target.checked})}/>{{inApp:'In-app alerts',sound:'Browser notification sound (when supported)',dnd:'Do Not Disturb',directMessages:'Direct message notifications'}[key]}</label>)}
 <label className="chat-check"><input type="checkbox" disabled={busy} checked={preferences.browser} onChange={async e=>{if(!e.target.checked){void save({...preferences,browser:false});return;}const permission=await browserPermission();if(permission!=='granted'){setError(permission==='denied'?'Browser permission is denied. Change it in your browser site settings.':'Browser notifications are not supported here.');return;}void save({...preferences,browser:true});}}/>Browser notifications</label>
 <p>Do Not Disturb silences alerts; your notification history stays available.</p></div>):<p role="status">Loading settings…</p>}
 {error&&<p role="alert">{error}</p>}
 </ChatDialog>}
 </div>;
}
export function ConversationNotifications({conversationId}:{conversationId:string}){
 const [mode,setMode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;void phase4Api.conversationPreference(conversationId).then(p=>{if(active)setMode(p.mode);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[conversationId]);
 return <label className="chat-conversation-preference">Conversation alerts<select aria-label="Conversation alerts" disabled={!mode||busy} value={mode} onChange={e=>{const next=e.target.value;setBusy(true);void phase4Api.saveConversationPreference(conversationId,next).then(p=>setMode(p.mode)).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}><option value="" disabled>Loading…</option><option value="ALL">All messages</option><option value="MENTIONS">Mentions only</option><option value="NONE">Mute conversation</option></select>{error&&<span role="alert">{error}</span>}</label>;
}
