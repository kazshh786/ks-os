import React from 'react';
import { Outlet } from 'react-router';
import { LockKeyhole } from 'lucide-react';

export const PublicBookingLayout: React.FC = () => {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-slate-100 font-sans antialiased">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.14),transparent_42%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.10),transparent_38%)]" />
      <main className="relative flex-1 px-3 py-4 sm:px-5 sm:py-7 md:px-8 md:py-10">
        <Outlet />
      </main>
      <footer className="relative flex items-center justify-center gap-2 px-5 pb-6 text-center text-xs font-bold text-slate-500">
        <LockKeyhole className="h-3.5 w-3.5" />
        Secure booking powered by KS OS
      </footer>
    </div>
  );
};

export default PublicBookingLayout;
