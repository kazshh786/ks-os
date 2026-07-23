import React from 'react';
import { Bell, CircleHelp, Menu } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  eyebrow?: string;
  breadcrumbs?: string[];
  tone?: 'light' | 'dark';
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
  onOpenNavigation: () => void;
  actions?: React.ReactNode;
  notificationHref?: string;
  helpHref?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, eyebrow, breadcrumbs, tone = 'light', menuButtonRef, onOpenNavigation, actions, notificationHref, helpHref = 'mailto:support@ks-os.com' }) => {
  const dark = tone === 'dark';
  return <header className={`sticky top-0 z-30 flex min-h-16 items-center gap-3 border-b px-4 sm:px-6 ${dark ? 'border-slate-800 bg-slate-950/95 text-white' : 'border-slate-200 bg-white/95 text-slate-950'} backdrop-blur`}>
    <button ref={menuButtonRef} type="button" onClick={onOpenNavigation} aria-label="Open navigation" aria-haspopup="dialog" className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl lg:hidden ${dark ? 'hover:bg-slate-900' : 'hover:bg-slate-100'}`}><Menu aria-hidden="true" className="h-5 w-5" /></button>
    <div className="min-w-0 flex-1">
      {eyebrow && <p className={`truncate text-[10px] font-black uppercase tracking-[0.14em] ${dark ? 'text-violet-300' : 'text-indigo-600'}`}>{eyebrow}</p>}
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-base font-black sm:text-lg">{title}</h1>
        {breadcrumbs?.slice(1).map(crumb => <React.Fragment key={crumb}><span aria-hidden="true" className={dark ? 'text-slate-700' : 'text-slate-300'}>/</span><span className={`hidden truncate text-xs sm:inline ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{crumb}</span></React.Fragment>)}
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-1 sm:gap-2">
      <a href={helpHref} aria-label="Help and support" title="Help and support" className={`grid h-10 w-10 place-items-center rounded-xl ${dark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950'}`}><CircleHelp aria-hidden="true" className="h-[18px] w-[18px]" /></a>
      {notificationHref && <a href={notificationHref} aria-label="Notifications" title="Notifications" className={`grid h-10 w-10 place-items-center rounded-xl ${dark ? 'text-slate-400 hover:bg-slate-900 hover:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950'}`}><Bell aria-hidden="true" className="h-[18px] w-[18px]" /></a>}
      {actions}
    </div>
  </header>;
};
