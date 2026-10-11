import { useEffect, useState } from 'react';
import type { NativeConversation, NativePerson } from '@ks-os/contracts';
import { chatApi } from './chat.api';
import { ChatDialog, ConfirmChatAction } from './ChatDialog';

export function PeoplePicker({ channelId, selected, select }: { channelId: string | null; selected: NativePerson[]; select: (people: NativePerson[]) => void }) {
  const [search,setSearch]=useState(''),[people,setPeople]=useState<NativePerson[]>([]),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');const timer=setTimeout(()=>{
    void chatApi.people(channelId,true,search,'',controller.signal).then(page=>{if(!controller.signal.aborted){setPeople(page.data);setCursor(page.nextCursor);}}).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  },200);return()=>{controller.abort();clearTimeout(timer);};},[channelId,search]);
  return <fieldset className="chat-people-picker"><legend>{channelId ? 'Add colleagues' : 'Initial members'}</legend><label>Find a colleague<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name" /></label>
    {selected.length>0 && <div className="chat-selected-people">{selected.map(person=><button key={person.userId} type="button" onClick={()=>select(selected.filter(p=>p.userId!==person.userId))} aria-label={`Remove ${person.name} from selection`}>{person.name} ×</button>)}</div>}
    {loading ? <p role="status">Finding colleagues…</p> : <div className="chat-person-options">{people.map(person=><label key={person.userId}><input type="checkbox" checked={selected.some(p=>p.userId===person.userId)} disabled={selected.length>=100 && !selected.some(p=>p.userId===person.userId)} onChange={e=>select(e.target.checked?[...selected,person]:selected.filter(p=>p.userId!==person.userId))}/>{person.name}</label>)}{!people.length && <p>No colleagues match.</p>}</div>}
    {cursor && <button type="button" disabled={loading} onClick={()=>{setLoading(true);void chatApi.people(channelId,true,search,cursor).then(page=>{setPeople(p=>[...p,...page.data]);setCursor(page.nextCursor);}).catch(cause=>setError(cause.message)).finally(()=>setLoading(false));}}>More colleagues</button>}
    {error && <p role="alert" className="chat-error">{error}</p>}
  </fieldset>;
}
export function CreateChannelDialog({ close, created }: { close: () => void; created: (channel: NativeConversation) => void }) {
  const [name,setName]=useState(''),[description,setDescription]=useState(''),[visibility,setVisibility]=useState<'CHANNEL'|'PRIVATE_CHANNEL'>('CHANNEL'),[people,setPeople]=useState<NativePerson[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <ChatDialog title="Create a channel" close={close}><form onSubmit={event=>{event.preventDefault();setBusy(true);setError('');void chatApi.create({name,description,type:visibility,memberUserIds:people.map(p=>p.userId)}).then(created).catch(cause=>setError(cause.message)).finally(()=>setBusy(false));}}>
    <p>Give your team a shared space for a topic, project, or everyday conversation.</p>
    <label>Channel name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Team updates" /></label>
    <label>Description<textarea maxLength={2000} rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="What belongs in this channel?" /></label>
    <label>Visibility<select value={visibility} onChange={e=>setVisibility(e.target.value as typeof visibility)}><option value="CHANNEL">Public — anyone in this workspace can join</option><option value="PRIVATE_CHANNEL">Private — invited members only</option></select></label>
    <PeoplePicker channelId={null} selected={people} select={setPeople} />
    {error && <p className="chat-error" role="alert">{error}</p>}
    <footer><button type="button" onClick={close}>Cancel</button><button className="chat-primary" disabled={busy || !name.trim()}>{busy?'Creating…':'Create channel'}</button></footer>
  </form></ChatDialog>;
}

export function ChannelDetails({ channel, userId, refresh, closed, close }: { channel: NativeConversation; userId: string; refresh: () => Promise<void>; closed: () => void; close: () => void }) {
  const [members,setMembers]=useState<NativePerson[]>([]),[cursor,setCursor]=useState<string|null>(null),[query,setQuery]=useState('');
  const [name,setName]=useState(channel.name),[description,setDescription]=useState(channel.description || ''),[people,setPeople]=useState<NativePerson[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [confirm,setConfirm]=useState<{title:string;description:string;work:()=>Promise<unknown>;leave?:boolean}|null>(null);
  const manage=['OWNER','ADMIN'].includes(channel.memberRole) && !channel.archivedAt;
  useEffect(()=>{let live=true;void chatApi.people(channel.id,false,query).then(page=>{if(live){setMembers(page.data);setCursor(page.nextCursor);}}).catch(cause=>{if(live)setError(cause.message);});return()=>{live=false;};},[channel.id,channel.updatedAt,channel.memberCount,query]);
  const run=async(work:()=>Promise<unknown>,leave=false)=>{setBusy(true);setError('');setNotice('');try{await work();if(leave){closed();return;}await refresh();const page=await chatApi.people(channel.id,false,query);setMembers(page.data);setCursor(page.nextCursor);setNotice('Channel updated');}catch(cause){setError(cause instanceof Error?cause.message:'Could not update channel');}finally{setBusy(false);}};
  return <section className="chat-details" aria-label="Channel details"><header className="chat-panel-header"><h2>Channel details</h2><button type="button" onClick={close} aria-label="Close channel details">×</button></header><div className="chat-details-scroll">
    <p className="chat-eyebrow">{channel.type==='PRIVATE_CHANNEL'?'Private channel':'Public within your workspace'}</p><h3>{channel.name}</h3><p>{channel.description || 'No description yet.'}</p><small>Created {new Date(channel.createdAt).toLocaleDateString()}{channel.archivedAt?' · Archived':''}</small>
    {manage && <form onSubmit={e=>{e.preventDefault();void run(()=>chatApi.update(channel.id,{name,description}));}}><label>Channel name<input required maxLength={255} value={name} onChange={e=>setName(e.target.value)}/></label><label>Description<textarea maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)} rows={3}/></label><button disabled={busy || !name.trim()} type="submit">Save channel details</button></form>}
    <h3>Members <span>({channel.memberCount ?? members.length})</span></h3><label>Find a member<input value={query} onChange={e=>setQuery(e.target.value)} /></label>
    <ul className="chat-member-list">{members.map(person=><li key={person.userId}><div><strong>{person.name}{person.userId===userId?' (you)':''}</strong><small>{person.role?.toLowerCase()}</small></div>{manage && person.userId!==userId && person.role!=='OWNER' && <div>
      {(person.role!=='ADMIN' || channel.memberRole==='OWNER') && <button disabled={busy} type="button" aria-label={`Remove ${person.name}`} onClick={()=>setConfirm({title:'Remove member',description:`Remove ${person.name} from this channel? Their messages remain.`,work:()=>chatApi.remove(channel.id,person.userId)})}>Remove</button>}
      {channel.memberRole==='OWNER' && <button disabled={busy} type="button" aria-label={`Make ${person.name} owner`} onClick={()=>setConfirm({title:'Transfer ownership',description:`Make ${person.name} the channel owner? You will become an administrator.`,work:()=>chatApi.action(channel.id,'owner',{userId:person.userId})})}>Make owner</button>}
    </div>}</li>)}</ul>
    {cursor && <button type="button" disabled={busy} onClick={()=>void run(async()=>{const page=await chatApi.people(channel.id,false,query,cursor);setMembers(m=>[...m,...page.data]);setCursor(page.nextCursor);})}>More members</button>}
    {manage && <><PeoplePicker channelId={channel.id} selected={people} select={setPeople}/><button type="button" disabled={busy || !people.length} onClick={()=>void run(async()=>{for(const person of people){await chatApi.add(channel.id,person.userId);setPeople(current=>current.filter(p=>p.userId!==person.userId));}})}>Add selected members</button></>}
    <div className="chat-channel-actions">{channel.memberRole!=='OWNER' ? <button type="button" disabled={busy} onClick={()=>setConfirm({title:'Leave channel',description:'You will lose access. Public channels can be rejoined; private channels require another invitation.',work:()=>chatApi.action(channel.id,'leave'),leave:true})}>Leave channel</button> : <p className="chat-muted">To leave, first transfer ownership to another member.</p>}
    {manage && <button type="button" disabled={busy} onClick={()=>setConfirm({title:'Archive channel',description:'Members can still read the history. New messages, reactions, and membership changes will be disabled.',work:()=>chatApi.action(channel.id,'archive')})}>Archive channel</button>}</div>
    {error && <p role="alert" className="chat-error">{error}</p>}{notice && <p role="status" className="chat-notice">{notice}</p>}
  </div>{confirm && <ConfirmChatAction title={confirm.title} description={confirm.description} close={()=>setConfirm(null)} action={()=>{setConfirm(null);void run(confirm.work,confirm.leave);}}/>}</section>;
}
