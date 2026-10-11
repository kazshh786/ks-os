import { useEffect,useState } from 'react';
import { useNavigate } from 'react-router';
import type { NativeConversation,NativePerson } from '@ks-os/contracts';
import { ChatDialog } from './ChatDialog';
import { chatApi } from './chat.api';
import { phase4Api,messageLink,type SearchHit } from './chat.phase4.api';
export function SearchHighlight({text,query}:{text:string;query:string}){
 const words=query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[];
 if(!words.length)return <>{text}</>;
 return <>{text.split(/(\s+)/).map((part,i)=>words.some(word=>part.toLowerCase().includes(word))?<mark key={i}>{part}</mark>:part)}</>;
}
export function ChatSearch({channels,close}:{channels:NativeConversation[];close:()=>void}){
 const navigate=useNavigate(),[q,setQ]=useState(''),[conversationId,setConversation]=useState(''),[senderId,setSender]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[attachments,setAttachments]=useState(false);
 const [people,setPeople]=useState<NativePerson[]>([]),[peopleQuery,setPeopleQuery]=useState(''),[rows,setRows]=useState<SearchHit[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[searched,setSearched]=useState(false);
 useEffect(()=>{const controller=new AbortController();const timer=setTimeout(()=>void chatApi.people(null,false,peopleQuery,'',controller.signal).then(p=>setPeople(p.data)).catch(()=>{}),200);return()=>{controller.abort();clearTimeout(timer);};},[peopleQuery]);
 const run=async(before='')=>{setLoading(true);setError('');setSearched(true);try{
  const params=new URLSearchParams({q,...conversationId?{conversationId}:{},...senderId?{senderId}:{},...from?{from:new Date(from+'T00:00:00').toISOString()}:{},...to?{to:new Date(to+'T23:59:59.999').toISOString()}:{},...attachments?{attachments:'true'}:{},...before?{before}:{}});
  const page=await phase4Api.search(params);setRows(values=>before?[...values,...page.data]:page.data);setCursor(page.nextCursor);
 }catch(e){setError(e instanceof Error?e.message:'Search unavailable');}finally{setLoading(false);}};
 return <ChatDialog title="Search messages" close={close}><form className="chat-search-form" onSubmit={e=>{e.preventDefault();void run();}}>
 <label>Search text<input autoFocus value={q} maxLength={200} onChange={e=>setQ(e.target.value)} placeholder="Words or a quoted phrase"/></label>
 <label>Conversation<select value={conversationId} onChange={e=>setConversation(e.target.value)}><option value="">All my conversations</option>{channels.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <label>Find sender<input value={peopleQuery} onChange={e=>setPeopleQuery(e.target.value)}/></label><label>Sender<select value={senderId} onChange={e=>setSender(e.target.value)}><option value="">Anyone</option>{people.map(p=><option key={p.userId} value={p.userId}>{p.name}</option>)}</select></label>
 <div className="chat-date-filters"><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
 <label className="chat-check"><input type="checkbox" checked={attachments} onChange={e=>setAttachments(e.target.checked)}/>Has attachments</label>
 <button className="chat-primary" disabled={loading}>Search</button></form>
 {loading&&<p role="status">Searching…</p>}{error&&<p role="alert">{error}</p>}{searched&&!loading&&!rows.length&&!error&&<p>No messages match. Try different words or filters.</p>}
 <ul className="chat-search-results">{rows.map(row=><li key={row.id}><button type="button" onClick={()=>{navigate(messageLink({...row,messageId:row.id}));close();}}><strong>{row.senderName} · {row.conversationName}</strong><time>{new Date(row.createdAt).toLocaleString()}</time><p><SearchHighlight text={row.excerpt||'Shared a file'} query={q}/></p>{row.parentMessageId&&<small>Thread reply</small>}</button></li>)}</ul>
 {cursor&&<button disabled={loading} onClick={()=>void run(cursor)}>More results</button>}
 </ChatDialog>;
}
