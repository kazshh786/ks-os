import React from 'react';
import { Outlet } from 'react-router-dom';

export const PublicBookingLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans antialiased relative">
      <main className="flex-1 p-3 sm:p-5 md:p-8">
        <Outlet />
      </main>
      <footer className="px-5 pb-6 text-center text-xs text-slate-500">Secure booking · Your details are used only to manage your appointment.</footer>
    </div>
  );
};
export default PublicBookingLayout;
