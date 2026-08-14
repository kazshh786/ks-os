import React from 'react';
import { Outlet } from 'react-router';

export const PublicBookingLayout: React.FC = () => {
  return (
    <div className="relative flex min-h-dvh flex-col bg-slate-50 font-sans antialiased">
      <main className="min-w-0 flex-1 p-2.5 sm:p-5 md:p-8">
        <Outlet />
      </main>
      <footer className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-xs text-slate-500">Secure booking · Your details are used only to manage your appointment.</footer>
    </div>
  );
};
export default PublicBookingLayout;
