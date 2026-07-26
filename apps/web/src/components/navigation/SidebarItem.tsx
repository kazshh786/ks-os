import React from 'react';
import { LockKeyhole } from 'lucide-react';
import { Link } from 'react-router';
import type { NavigationItem } from '../../navigation/navigation.types';

interface SidebarItemProps {
  item: NavigationItem;
  href: string;
  active: boolean;
  collapsed?: boolean;
  badge?: number;
  tone?: 'light' | 'dark';
  onNavigate?: () => void;
}

export const SidebarItem: React.FC<SidebarItemProps> = ({ item, href, active, collapsed = false, badge, tone = 'light', onNavigate }) => {
  const Icon = item.icon;
  const inactive = tone === 'dark'
    ? 'text-slate-400 hover:bg-slate-900 hover:text-white'
    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950';
  const activeStyle = tone === 'dark'
    ? 'bg-violet-600 text-white shadow-sm shadow-violet-950/40'
    : 'bg-slate-950 text-white shadow-sm';

  return <Link
    to={href}
    onClick={onNavigate}
    aria-current={active ? 'page' : undefined}
    title={collapsed ? item.label : undefined}
    className={`group relative flex min-h-10 items-center rounded-xl px-3 text-sm font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${collapsed ? 'justify-center' : 'gap-3'} ${active ? activeStyle : inactive}`}
  >
    <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
    {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
    {item.locked && <><LockKeyhole aria-hidden="true" className={`${collapsed ? 'absolute -right-1 -top-1 rounded-full bg-amber-100 p-1 text-amber-800' : 'text-amber-600'} h-5 w-5 shrink-0`} />{!collapsed && item.requiredPlan && <span aria-hidden="true" className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black text-amber-900">{item.requiredPlan}</span>}</>}
    {badge !== undefined && badge > 0 && <span aria-label={`${badge} items require attention`} className={`${collapsed ? 'absolute -right-1 -top-1' : ''} min-w-5 rounded-full bg-amber-400 px-1.5 py-0.5 text-center text-[10px] font-black text-slate-950`}>{badge > 99 ? '99+' : badge}</span>}
    {collapsed && <span role="tooltip" className="pointer-events-none absolute left-[calc(100%+0.75rem)] z-50 hidden whitespace-nowrap rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-white shadow-xl group-hover:block group-focus-visible:block">{item.label}</span>}
  </Link>;
};
