import React from 'react';
import { CheckCircle2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Outlet } from 'react-router';

export const PublicBookingLayout: React.FC = () => {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#f4f6fa] font-sans antialiased text-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:linear-gradient(to_bottom,black,transparent_72%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(15,23,42,0.08),transparent_62%)]" />

      <main className="relative flex-1 px-3 py-4 sm:px-5 sm:py-7 md:px-8 md:py-10">
        <Outlet />
      </main>

      <footer className="relative border-t border-slate-200/80 bg-white/80 px-5 py-5 backdrop-blur" aria-label="Booking security information">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-center text-xs font-bold text-slate-500 sm:flex-row sm:text-left">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-slate-700" aria-hidden="true" />
            Your details are used to manage this booking securely.
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-end">
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
