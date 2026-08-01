import React from 'react';
import { CheckCircle2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Outlet } from 'react-router';

export const PublicBookingLayout: React.FC = () => {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#f3f1ec] font-sans antialiased text-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.95),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(148,163,184,0.16),transparent_34%)]" />

      <main className="relative flex min-h-0 flex-1 px-3 py-3 sm:px-4 lg:px-5">
        <Outlet />
      </main>

      <footer className="relative border-t border-slate-900/10 bg-white/75 px-4 py-3 backdrop-blur" aria-label="Booking security information">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-2 text-center text-[11px] font-bold text-slate-500 sm:flex-row sm:text-left">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-slate-700" aria-hidden="true" />
            Your details are used to manage this booking securely.
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 sm:justify-end">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Secure booking</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Confirmation by email</span>
            <span>Powered by KS OS</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PublicBookingLayout;
