import React from 'react';
import type { ResolvedNavigationGroup } from '../../navigation/navigation.types';
import { isNavigationItemActive, navigationHref } from '../../navigation/navigation.utils';
import { SidebarItem } from './SidebarItem';

interface SidebarGroupProps {
  group: ResolvedNavigationGroup;
  pathname: string;
  collapsed?: boolean;
  tone?: 'light' | 'dark';
  parameters?: Record<string, string>;
  badges?: Record<string, number>;
  onNavigate?: () => void;
}

export const SidebarGroup: React.FC<SidebarGroupProps> = ({ group, pathname, collapsed = false, tone = 'light', parameters = {}, badges = {}, onNavigate }) => <section aria-label={group.label}>
  {group.label && !collapsed && <h2 className={`mb-1.5 px-3 text-[10px] font-black uppercase tracking-[0.16em] ${tone === 'dark' ? 'text-slate-600' : 'text-slate-400'}`}>{group.label}</h2>}
  {group.label && collapsed && <div aria-hidden="true" className={`mx-auto mb-2 h-px w-7 ${tone === 'dark' ? 'bg-slate-800' : 'bg-slate-200'}`} />}
  <div className="space-y-1">
    {group.items.map(item => <SidebarItem
      key={item.id}
      item={item}
      href={navigationHref(item, parameters)}
      active={isNavigationItemActive(item, pathname, parameters)}
      collapsed={collapsed}
      tone={tone}
      badge={badges[item.id]}
      onNavigate={onNavigate}
    />)}
  </div>
</section>;
