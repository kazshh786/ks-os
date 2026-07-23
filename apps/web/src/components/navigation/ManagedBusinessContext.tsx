import React from 'react';
import { ArrowLeft, Building2, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ManagedBusinessContextProps {
  tenantId: string;
  tenantName: string;
  status?: string;
  businesses: Array<{ id: string; name: string }>;
  onSwitch: (tenantId: string) => void;
}

export const ManagedBusinessContext: React.FC<ManagedBusinessContextProps> = ({ tenantId, tenantName, status, businesses, onSwitch }) => <div className="space-y-3 p-3">
  <Link to="/agency/tenants" className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold text-slate-400 hover:bg-slate-900 hover:text-white"><ArrowLeft aria-hidden="true" className="h-4 w-4" />Back to Businesses</Link>
  <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3">
    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-300">Managing business</p>
    <div className="mt-2 flex items-start gap-2"><Building2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" /><div className="min-w-0"><p className="truncate text-sm font-black text-white">{tenantName}</p>{status && <span className="mt-1 inline-flex rounded-full bg-slate-800 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-300">{status.replaceAll('_', ' ')}</span>}</div></div>
  </div>
  {businesses.length > 1 && <label className="block px-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Switch business<select aria-label="Switch managed business" value={tenantId} onChange={event => onSwitch(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs font-bold text-white">{businesses.map(business => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>}
  <p className="flex gap-2 rounded-lg bg-amber-400/10 p-2 text-[10px] leading-relaxed text-amber-200"><TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" />Actions here affect this business. Enter its workspace only through a time-limited support session.</p>
</div>;
