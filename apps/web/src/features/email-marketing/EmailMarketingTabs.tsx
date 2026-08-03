import { History, WandSparkles } from 'lucide-react';
import { NavLink } from 'react-router';

const tabs = [
  { to: '/app/email-marketing/automated-emails', label: 'Automated emails', icon: WandSparkles },
  { to: '/app/email-marketing/history', label: 'Email history', icon: History },
] as const;

export function EmailMarketingTabs() {
  return (
    <nav aria-label="Email marketing sections" className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      {tabs.map(tab => {
        const Icon = tab.icon;
        return <NavLink key={tab.to} to={tab.to} className={({ isActive }) => `inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-black transition ${isActive ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}><Icon className="h-4 w-4" />{tab.label}</NavLink>;
      })}
    </nav>
  );
}
