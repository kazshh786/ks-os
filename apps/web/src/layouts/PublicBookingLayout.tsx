import React from 'react';
import { CheckCircle2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Outlet, useLocation } from 'react-router';

export const PublicBookingLayout: React.FC = () => {
  const isWaitlist = useLocation().pathname.startsWith('/waitlist/');
  return (
    <div className="relative flex min-h-dvh min-w-0 flex-col overflow-x-hidden bg-[#eef2f7] font-sans antialiased text-slate-950">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(99,102,241,0.10),transparent_34%),radial-gradient(circle_at_100%_20%,rgba(14,165,233,0.08),transparent_30%)]" />

      <main className="relative min-w-0 flex-1 px-2.5 py-3 sm:px-5 sm:py-4 lg:px-6">
        <Outlet />
      </main>

      <footer className="relative border-t border-slate-200/80 bg-white/75 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur" aria-label="Request security information">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-2 text-center text-[11px] font-bold text-slate-500 sm:flex-row sm:text-left">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-slate-700" aria-hidden="true" />
            Your details are used to manage this {isWaitlist ? 'waitlist request' : 'booking'} securely.
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 sm:justify-end">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Secure {isWaitlist ? 'request' : 'booking'}</span>
            {!isWaitlist ? <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Confirmation by email</span> : null}
            <span>Powered by KS OS</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PublicBookingLayout;
