import { History, Monitor, Smartphone, WandSparkles } from 'lucide-react';
import { NavLink } from 'react-router';

const tabs = [
  { to: '/app/email-marketing/automated-emails', label: 'Automated emails', icon: WandSparkles },
  { to: '/app/email-marketing/history', label: 'Email history', icon: History },
] as const;

export type EmailPreviewViewport = 'desktop' | 'mobile';

export function EmailMarketingTabs({
  previewViewport,
  onPreviewViewportChange,
}: {
  previewViewport?: EmailPreviewViewport;
  onPreviewViewportChange?: (viewport: EmailPreviewViewport) => void;
}) {
  const showPreviewControls = previewViewport && onPreviewViewportChange;

  return (
    <div
      data-testid="email-marketing-toolbar"
      className="flex min-h-12 flex-wrap items-end justify-between gap-x-5 gap-y-1 border-b border-slate-200"
    >
      <nav aria-label="Email marketing sections" className="flex min-h-11 min-w-0 items-end gap-4 sm:gap-5">
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

      {showPreviewControls ? (
        <div
          role="group"
          aria-label="Preview size"
          className="mb-1 ml-auto inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1"
        >
          <button
            type="button"
            aria-pressed={previewViewport === 'desktop'}
            onClick={() => onPreviewViewportChange('desktop')}
            className={
              'inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ' +
              (previewViewport === 'desktop'
                ? 'bg-white font-black text-violet-700 shadow-sm'
                : 'font-bold text-slate-600 hover:text-slate-950')
            }
          >
            <Monitor className="h-3.5 w-3.5" />
            Desktop
          </button>
          <button
            type="button"
            aria-pressed={previewViewport === 'mobile'}
            onClick={() => onPreviewViewportChange('mobile')}
            className={
              'inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ' +
              (previewViewport === 'mobile'
                ? 'bg-white font-black text-violet-700 shadow-sm'
                : 'font-bold text-slate-600 hover:text-slate-950')
            }
          >
            <Smartphone className="h-3.5 w-3.5" />
            Mobile
          </button>
        </div>
      ) : null}
    </div>
  );
}
