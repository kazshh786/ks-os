import React from 'react';
import { LogOut, Settings2 } from 'lucide-react';
import { Link } from 'react-router';

interface AccountMenuProps {
  displayName: string;
  email?: string | null;
  roleLabel: string;
  settingsHref: string;
  tone?: 'light' | 'dark';
  compact?: boolean;
  onSignOut: () => void;
}

export const AccountMenu: React.FC<AccountMenuProps> = ({ displayName, email, roleLabel, settingsHref, tone = 'light', compact = false, onSignOut }) => {
  const dark = tone === 'dark';
  const initials = displayName.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'KS';
  return <details className="group relative">
    <summary aria-label="Open account menu" className={`flex min-h-11 cursor-pointer list-none items-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${compact ? 'justify-center p-1' : 'gap-3 p-2'} ${dark ? 'hover:bg-slate-900' : 'hover:bg-slate-100'}`}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-black ${dark ? 'bg-violet-500/20 text-violet-200' : 'bg-indigo-100 text-indigo-700'}`}>{initials}</span>
      {!compact && <span className="min-w-0 flex-1 text-left"><span className="block truncate text-xs font-black">{displayName}</span><span className={`block truncate text-[10px] ${dark ? 'text-slate-500' : 'text-slate-500'}`}>{roleLabel}</span></span>}
    </summary>
    <div className={`absolute bottom-[calc(100%+0.5rem)] left-0 z-50 w-64 rounded-2xl border p-2 shadow-2xl ${dark ? 'border-slate-700 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-950'}`}>
      <div className={`border-b px-3 py-2 ${dark ? 'border-slate-700' : 'border-slate-200'}`}><p className="truncate text-sm font-black">{displayName}</p>{email && <p className={`truncate text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{email}</p>}<p className={`mt-1 text-[10px] font-bold uppercase tracking-wide ${dark ? 'text-violet-300' : 'text-indigo-600'}`}>{roleLabel}</p></div>
      <Link to={settingsHref} className={`mt-1 flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${dark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}><Settings2 aria-hidden="true" className="h-4 w-4" />Account settings</Link>
      <button type="button" onClick={onSignOut} className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold ${dark ? 'text-rose-300 hover:bg-slate-800' : 'text-rose-700 hover:bg-slate-100'}`}><LogOut aria-hidden="true" className="h-4 w-4" />Sign out</button>
    </div>
  </details>;
};
