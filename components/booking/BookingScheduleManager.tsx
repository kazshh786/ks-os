'use client';
import React,{useEffect,useState} from 'react';
import {supabase} from '@/utils/supabase/client';

type Channel='in_shop'|'mobile';
type Day={dayOfWeek:number;enabled:boolean;startTime:string;endTime:string};
const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const emptyHours=():Day[]=>DAYS.map((_,dayOfWeek)=>({dayOfWeek,enabled:false,startTime:'09:00',endTime:'17:00'}));

export default function BookingScheduleManager({tenantId,staff}:{tenantId:string;staff:{id:string;name:string}[]}){
  const [staffId,setStaffId]=useState('');const [channel,setChannel]=useState<Channel>('in_shop');const [hours,setHours]=useState<Day[]>(emptyHours);
  const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{if(!staffId&&staff.length)setStaffId(staff[0].id);},[staff,staffId]);
  useEffect(()=>{if(!staffId)return;let active=true;setLoading(true);setMessage('');supabase.from('booking_channel_schedules').select('day_of_week,start_time,end_time').eq('tenant_id',tenantId).eq('user_id',staffId).eq('booking_channel',channel).then(({data,error})=>{if(!active)return;const next=emptyHours();(data||[]).forEach((row:any)=>{next[row.day_of_week]={dayOfWeek:row.day_of_week,enabled:true,startTime:String(row.start_time).slice(0,5),endTime:String(row.end_time).slice(0,5)};});setHours(next);if(error)setMessage('Schedule could not be loaded.');setLoading(false);});return()=>{active=false;};},[tenantId,staffId,channel]);
  function update(day:number,patch:Partial<Day>){setHours(current=>current.map(item=>item.dayOfWeek===day?{...item,...patch}:item));}
  async function save(){setSaving(true);setMessage('');const {error}=await supabase.rpc('replace_staff_booking_channel_schedule',{p_tenant_id:tenantId,p_staff_id:staffId,p_booking_channel:channel,p_hours:hours});setSaving(false);setMessage(error?error.message:'Booking hours saved.');}
  return <section style={{padding:24,border:'1px solid #e2e8f0',borderRadius:16,background:'white'}} aria-labelledby="booking-hours-title">
    <h4 id="booking-hours-title" style={{marginTop:0}}>Shop and mobile booking hours</h4>
    <p>Set separate availability for appointments at the shop and appointments where you travel to the customer.</p>
    <div style={{display:'grid',gridTemplateColumns:'minmax(180px,1fr) minmax(180px,1fr)',gap:12,marginBottom:18}}>
      <label>Team member<select value={staffId} onChange={event=>setStaffId(event.target.value)} style={{display:'block',width:'100%',padding:10,marginTop:6}}>{staff.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Booking type<select value={channel} onChange={event=>setChannel(event.target.value as Channel)} style={{display:'block',width:'100%',padding:10,marginTop:6}}><option value="in_shop">Visit the shop</option><option value="mobile">Mobile appointment</option></select></label>
    </div>
    {loading?<p>Loading hours…</p>:<div style={{display:'grid',gap:8}}>{hours.map(day=><div key={day.dayOfWeek} style={{display:'grid',gridTemplateColumns:'130px 80px 1fr 1fr',gap:10,alignItems:'center'}}><strong>{DAYS[day.dayOfWeek]}</strong><label><input type="checkbox" checked={day.enabled} onChange={event=>update(day.dayOfWeek,{enabled:event.target.checked})}/> Open</label><input aria-label={`${DAYS[day.dayOfWeek]} start time`} type="time" disabled={!day.enabled} value={day.startTime} onChange={event=>update(day.dayOfWeek,{startTime:event.target.value})}/><input aria-label={`${DAYS[day.dayOfWeek]} end time`} type="time" disabled={!day.enabled} value={day.endTime} onChange={event=>update(day.dayOfWeek,{endTime:event.target.value})}/></div>)}</div>}
    <button type="button" disabled={saving||!staffId} onClick={save} style={{marginTop:18,padding:'11px 18px',border:0,borderRadius:8,background:'#0f172a',color:'white',fontWeight:700}}>{saving?'Saving…':'Save booking hours'}</button>
    {message&&<p role="status">{message}</p>}
  </section>;
}
