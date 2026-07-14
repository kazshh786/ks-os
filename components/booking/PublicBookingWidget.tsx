'use client';
import React,{useEffect,useMemo,useRef,useState} from 'react';

declare global{interface Window{Stripe?:any}}
type Catalog={tenant:{name:string;currency:string};paymentMode:string;services:any[];staff:any[]};

function loadStripe(key:string){
  return new Promise<any>((resolve,reject)=>{
    if(window.Stripe)return resolve(window.Stripe(key));
    const script=document.createElement('script');script.src='https://js.stripe.com/v3/';
    script.onload=()=>resolve(window.Stripe!(key));script.onerror=()=>reject(new Error('Secure payment form failed to load'));
    document.head.appendChild(script);
  });
}

function PaymentPanel({result,onConfirmed,onError,checkStatus}:{result:any;onConfirmed:(booking:any)=>void;onError:(message:string)=>void;checkStatus:(reference:string)=>Promise<any>}){
  const mount=useRef<HTMLDivElement>(null),stripeRef=useRef<any>(),cardRef=useRef<any>();const [busy,setBusy]=useState(false),[ready,setReady]=useState(false);
  useEffect(()=>{let active=true;loadStripe(result.payment.publishableKey).then(stripe=>{if(!active||!mount.current)return;stripeRef.current=stripe;const card=stripe.elements().create('card');card.mount(mount.current);cardRef.current=card;setReady(true);}).catch(error=>onError(error.message));return()=>{active=false;cardRef.current?.destroy();};},[result,onError]);
  async function pay(){setBusy(true);onError('');try{const outcome=await stripeRef.current.confirmCardPayment(result.payment.clientSecret,{payment_method:{card:cardRef.current}});if(outcome.error)throw new Error(outcome.error.message);for(let i=0;i<8;i++){await new Promise(resolve=>setTimeout(resolve,750));const check=await checkStatus(result.booking.reference);if(check.booking.status==='CONFIRMED')return onConfirmed(check.booking);}throw new Error(`Payment received. Confirmation is processing. Reference: ${result.booking.reference}`);}catch(error:any){onError(error.message);}finally{setBusy(false);}}
  return <section style={{display:'grid',gap:16}}><h2>Secure payment</h2><p>Amount due: {result.payment.currency} {(result.payment.amount/100).toFixed(2)}</p><div ref={mount} style={{padding:14,border:'1px solid #cbd5e1',borderRadius:8}}/><button disabled={busy||!ready} onClick={pay}>{busy?'Processing…':'Pay and confirm'}</button></section>;
}

export default function PublicBookingWidget({subdomain}:{subdomain:string}){
  const endpoint=useMemo(()=>`/api/v1/public/${encodeURIComponent(subdomain)}/booking`,[subdomain]);
  const [catalog,setCatalog]=useState<Catalog|null>(null),[serviceId,setServiceId]=useState(''),[staffId,setStaffId]=useState('any');
  const [date,setDate]=useState(()=>new Date().toISOString().slice(0,10)),[slots,setSlots]=useState<any[]>([]),[slot,setSlot]=useState<any>(null);
  const [status,setStatus]=useState('Loading live booking options…'),[error,setError]=useState(''),[booking,setBooking]=useState<any>(null),[pendingPayment,setPendingPayment]=useState<any>(null);
  const [client,setClient]=useState({name:'',email:'',phone:''}),[payNow,setPayNow]=useState(false),[submitting,setSubmitting]=useState(false);

  async function api(action:string,options:RequestInit={},query:Record<string,string>={}){const url=new URL(endpoint,location.origin);url.searchParams.set('action',action);Object.entries(query).forEach(([key,value])=>url.searchParams.set(key,value));const response=await fetch(url,options);const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error?.message||'Booking service unavailable');return body;}
  useEffect(()=>{api('catalog').then(data=>{setCatalog(data);setStatus('');}).catch(reason=>setError(reason.message));},[endpoint]);
  async function loadSlots(){if(!serviceId)return setError('Choose a service first');setError('');setStatus('Loading live availability…');try{const data=await api('availability',{}, {serviceId,staffId,date});setSlots(data.slots);setStatus(data.slots.length?'':'No available times for this date.');}catch(reason:any){setError(reason.message);}}
  async function submit(event:React.FormEvent){event.preventDefault();if(!slot||!catalog)return;setSubmitting(true);setError('');try{const result=await api('create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({serviceId,staffId:slot.staffId,startTime:slot.start,client,paymentMode:catalog.paymentMode,payNow:catalog.paymentMode==='customer_choice'?payNow:['deposit','full_payment'].includes(catalog.paymentMode),idempotencyKey:crypto.randomUUID()})});if(result.payment.required)setPendingPayment(result);else setBooking(result.booking);}catch(reason:any){setError(reason.message);}finally{setSubmitting(false);}}
  const checkStatus=(reference:string)=>api('status',{}, {reference});

  if(error&&!catalog)return <main style={{padding:40}}><h1>Booking unavailable</h1><p>{error}</p></main>;
  if(!catalog)return <main style={{padding:40}}><p>{status}</p></main>;
  if(booking)return <main style={{maxWidth:720,margin:'0 auto',padding:40,textAlign:'center'}}><h1>Booking confirmed</h1><p>Your reference is {booking.reference}.</p></main>;
  if(pendingPayment)return <main style={{maxWidth:720,margin:'0 auto',padding:40}}><PaymentPanel result={pendingPayment} onConfirmed={setBooking} onError={setError} checkStatus={checkStatus}/>{error&&<p style={{color:'#b91c1c'}}>{error}</p>}</main>;
  return <main style={{maxWidth:820,margin:'0 auto',padding:'40px 20px',fontFamily:'system-ui'}}><h1>Book with {catalog.tenant.name}</h1>{!slot?<section style={{display:'grid',gap:14}}><select value={serviceId} onChange={event=>setServiceId(event.target.value)}><option value="">Choose a service</option>{catalog.services.map(service=><option key={service.id} value={service.id}>{service.name} · {service.duration} min · {catalog.tenant.currency} {((service.price-service.discount)/100).toFixed(2)}</option>)}</select><select value={staffId} onChange={event=>setStaffId(event.target.value)}><option value="any">Any available team member</option>{catalog.staff.map(staff=><option key={staff.id} value={staff.id}>{staff.name}</option>)}</select><input type="date" min={new Date().toISOString().slice(0,10)} value={date} onChange={event=>setDate(event.target.value)}/><button onClick={loadSlots}>Show available times</button><p>{status}</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:8}}>{slots.map(item=><button key={`${item.staffId}-${item.start}`} onClick={()=>setSlot(item)}>{new Date(item.start).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · {item.staffName}</button>)}</div></section>:<form onSubmit={submit} style={{display:'grid',gap:14}}><h2>Your details</h2><p>{new Date(slot.start).toLocaleString()}</p><input required placeholder="Full name" value={client.name} onChange={event=>setClient({...client,name:event.target.value})}/><input required type="email" placeholder="Email" value={client.email} onChange={event=>setClient({...client,email:event.target.value})}/><input required type="tel" placeholder="Phone" value={client.phone} onChange={event=>setClient({...client,phone:event.target.value})}/>{catalog.paymentMode==='customer_choice'&&<label><input type="checkbox" checked={payNow} onChange={event=>setPayNow(event.target.checked)}/> Pay securely online now</label>}<button disabled={submitting}>{submitting?'Processing…':'Confirm booking'}</button><button type="button" onClick={()=>setSlot(null)}>Choose another time</button></form>}{error&&<p style={{color:'#b91c1c'}}>{error}</p>}</main>;
}
