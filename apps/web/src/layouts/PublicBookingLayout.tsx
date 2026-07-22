import React from 'react';
import { Outlet } from 'react-router-dom';
import ApiStatusIndicator from '../components/ApiStatusIndicator.js';

export const PublicBookingLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans select-none antialiased relative">
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-30 shadow-3xs">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black text-xs">
            KS
          </div>
          <span className="text-xs font-black text-slate-800 tracking-tight">Public Reservation Suite</span>
        </div>
        <ApiStatusIndicator />
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
};
export default PublicBookingLayout;
