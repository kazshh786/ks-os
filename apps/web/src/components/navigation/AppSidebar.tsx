import React from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ResolvedNavigationGroup } from '../../navigation/navigation.types';
import { SidebarGroup } from './SidebarGroup';

interface AppSidebarProps {
  ariaLabel: string;
  productName: string;
  productCaption: string;
  groups: ResolvedNavigationGroup[];
  pathname: string;
  collapsed?: boolean;
  collapsible?: boolean;
  tone?: 'light' | 'dark';
  parameters?: Record<string, string>;
  badges?: Record<string, number>;
  contextHeader?: React.ReactNode;
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  footer?: React.ReactNode;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  ariaLabel, productName, productCaption, groups, pathname, collapsed = false, collapsible = false,
  tone = 'light', parameters, badges, contextHeader, primaryAction, secondaryActions, footer,
  onToggleCollapsed, onNavigate,
}) => {
  const dark = tone === 'dark';
  return <aside aria-label={ariaLabel} className={`flex h-full min-h-0 flex-col border-r ${collapsed ? 'w-[76px]' : 'w-[272px]'} ${dark ? 'border-slate-800 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-950'} transition-[width] duration-200`}>
    <div className={`flex h-16 shrink-0 items-center border-b px-4 ${collapsed ? 'justify-center' : 'gap-3'} ${dark ? 'border-slate-800' : 'border-slate-200'}`}>
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-black text-white ${dark ? 'bg-violet-600' : 'bg-indigo-600'}`}>KS</div>
      {!collapsed && <div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{productName}</p><p className={`truncate text-[10px] ${dark ? 'text-slate-500' : 'text-slate-500'}`}>{productCaption}</p></div>}
      {collapsible && !collapsed && <button type="button" onClick={onToggleCollapsed} aria-label="Collapse navigation" title="Collapse navigation" className={`grid h-9 w-9 place-items-center rounded-lg ${dark ? 'text-slate-500 hover:bg-slate-900 hover:text-white' : 'text-slate-500 hover:bg-slate-100'}`}><PanelLeftClose aria-hidden="true" className="h-4 w-4" /></button>}
    </div>
    {collapsible && collapsed && <button type="button" onClick={onToggleCollapsed} aria-label="Expand navigation" title="Expand navigation" className={`mx-auto mt-3 grid h-9 w-9 shrink-0 place-items-center rounded-lg ${dark ? 'text-slate-500 hover:bg-slate-900 hover:text-white' : 'text-slate-500 hover:bg-slate-100'}`}><PanelLeftOpen aria-hidden="true" className="h-4 w-4" /></button>}
    {contextHeader && <div className={`shrink-0 border-b ${dark ? 'border-slate-800' : 'border-slate-200'}`}>{contextHeader}</div>}
    {primaryAction && <div className="shrink-0 px-3 pb-2 pt-3">{primaryAction}</div>}
    <nav aria-label={ariaLabel} className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-3">
      {groups.map(group => <SidebarGroup key={group.id} group={group} pathname={pathname} collapsed={collapsed} tone={tone} parameters={parameters} badges={badges} onNavigate={onNavigate} />)}
    </nav>
    {secondaryActions && !collapsed && <div className={`shrink-0 border-t px-3 py-3 ${dark ? 'border-slate-800' : 'border-slate-200'}`}>{secondaryActions}</div>}
    {footer && <div className={`shrink-0 border-t p-3 ${dark ? 'border-slate-800' : 'border-slate-200'}`}>{footer}</div>}
  </aside>;
};
