import { History, WandSparkles } from 'lucide-react';
import { NavLink } from 'react-router';

const tabs = [
  { to: '/app/email-marketing/automated-emails', label: 'Automated emails', icon: WandSparkles },
  { to: '/app/email-marketing/history', label: 'Email history', icon: History },
] as const;

export function EmailMarketingTabs() {
  return (
    <nav aria-label="Email marketing sections" className="flex min-h-11 items-end gap-5 border-b border-slate-200">
      {tabs.map(tab => {
        const Icon = tab.icon;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              'inline-flex min-h-11 items-center gap-2 border-b-2 px-1 text-sm font-black transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ' +
              (isActive
                ? 'border-violet-600 text-slate-950'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-950')
            }
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
