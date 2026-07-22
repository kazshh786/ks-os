import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, Building2, ClipboardCheck, CreditCard, FileCheck2, Headphones, LayoutDashboard, Package, ScrollText, Shield, Users } from 'lucide-react';
import { useAgencyAuth } from '../features/agency/AgencyAuth';

const links=[
  ['/agency/overview','Overview',LayoutDashboard],['/agency/tenants','Businesses',Building2],['/agency/onboarding','Onboarding',ClipboardCheck],
  ['/agency/billing','Billing',CreditCard],['/agency/plans','Plans',Package],['/agency/fulfilment','Fulfilment',FileCheck2],
  ['/agency/support','Support',Headphones],['/agency/analytics','Analytics',BarChart3],['/agency/audit','Audit',ScrollText],['/agency/users','Agency users',Users],
  ['/agency/webhooks','Webhooks',Shield],['/agency/jobs','Jobs',FileCheck2],
] as const;

export const AgencyLayout:React.FC=()=>{
  const location=useLocation();const{session,signOut}=useAgencyAuth();const tenantId=location.pathname.match(/^\/agency\/tenants\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
  return <div className="min-h-screen bg-slate-950 text-white flex">
    <aside className="w-64 shrink-0 border-r border-slate-800 bg-slate-950 p-4 hidden lg:flex flex-col">
      <div className="flex items-center gap-3 px-2 py-3"><div className="h-10 w-10 rounded-xl bg-violet-600 grid place-items-center font-black">KS</div><div><strong className="text-sm">Agency OS</strong><small className="block text-[10px] text-slate-500">Kasim Shah LTD</small></div></div>
      <nav className="mt-6 space-y-1 flex-1">{links.map(([to,label,Icon])=><Link key={to} to={to} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold ${location.pathname===to||location.pathname.startsWith(`${to}/`)?'bg-violet-600 text-white':'text-slate-400 hover:bg-slate-900 hover:text-white'}`}><Icon className="h-4 w-4"/>{label}</Link>)}</nav>
      <div className="grid grid-cols-2 gap-2 mb-2"><Link to="/agency/plans/new" className="rounded-lg border border-slate-800 p-2 text-center text-[10px] text-slate-400">New plan</Link><Link to="/agency/users/new" className="rounded-lg border border-slate-800 p-2 text-center text-[10px] text-slate-400">Invite user</Link></div>
      <button onClick={()=>void signOut()} className="rounded-xl border border-slate-800 px-3 py-2 text-left text-xs text-slate-400">Sign out</button>
    </aside>
    <main className="min-w-0 flex-1"><header className="border-b border-slate-800 bg-slate-950/95 px-5 py-4 flex justify-between sticky top-0 z-10"><div className="flex items-center gap-2"><Shield className="h-4 w-4 text-violet-400"/><span className="text-sm font-black">Secure agency control plane</span></div><div className="text-right"><p className="text-xs font-bold">{session?.user.displayName}</p><p className="text-[10px] text-slate-500">{session?.user.role.replaceAll('_',' ')} · {session?.mfa.assuranceLevel.toUpperCase()}</p></div></header>
      {tenantId&&<nav className="flex gap-2 overflow-x-auto border-b border-slate-800 bg-slate-900 px-5 py-2 text-[11px] font-bold">{[['','Summary'],['onboarding','Onboarding'],['billing','Billing'],['entitlements','Entitlements'],['fulfilment','Fulfilment'],['health','Health']].map(([path,label])=><Link key={path} to={`/agency/tenants/${tenantId}${path?`/${path}`:''}`} className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-slate-800">{label}</Link>)}</nav>}
      <div className="p-5 md:p-7 text-slate-100"><Outlet/></div>
    </main>
  </div>;
};
export default AgencyLayout;
