import React, { useEffect, useState } from 'react';

export const SupportModeBanner:React.FC=()=>{
  const[metadata,setMetadata]=useState<{tenantName?:string;reason:string;expiresAt:string}|null>(null);const[now,setNow]=useState(Date.now());
  useEffect(()=>{try{const value=sessionStorage.getItem('ks-os-support-metadata');setMetadata(value?JSON.parse(value):null);}catch{setMetadata(null);}const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  if(!sessionStorage.getItem('ks-os-support-session')||!metadata)return null;
  const remaining=Math.max(0,new Date(metadata.expiresAt).getTime()-now);if(remaining===0){sessionStorage.removeItem('ks-os-support-session');sessionStorage.removeItem('ks-os-support-metadata');return null;}
  const end=()=>{sessionStorage.removeItem('ks-os-support-session');sessionStorage.removeItem('ks-os-support-metadata');window.location.assign('/agency/tenants');};
  return <div role="status" className="bg-amber-400 border-b border-amber-600 text-slate-950 px-6 py-2 flex items-center justify-between gap-4 text-xs font-bold"><span>Audited support session · {metadata.tenantName||'Tenant workspace'} · {metadata.reason} · {Math.ceil(remaining/60000)} min remaining</span><button onClick={end} className="rounded-lg bg-slate-950 text-white px-3 py-1.5">End support access</button></div>;
};

