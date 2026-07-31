import React from 'react';
import { Link } from 'react-router';
import { LockKeyhole } from 'lucide-react';
import BookingWizardPage from './BookingWizardPage.js';
import PaymentSuccess from './book/PaymentSuccess.js';
import PaymentCancel from './book/PaymentCancel.js';
import PublicWorkspaceFormPage, { PublicWorkspaceFormSuccessPage } from './PublicWorkspaceFormPage.js';

function PublicBookingSurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-slate-100 font-sans antialiased">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.14),transparent_42%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.10),transparent_38%)]" />
      <main className="relative flex-1 px-3 py-4 sm:px-5 sm:py-7 md:px-8 md:py-10">{children}</main>
      <footer className="relative flex items-center justify-center gap-2 px-5 pb-6 text-center text-xs font-bold text-slate-500"><LockKeyhole className="h-3.5 w-3.5" />Secure booking powered by KS OS</footer>
    </div>
  );
}

export const NotFoundPage: React.FC = () => {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/book' || /^\/book\/manage\/[0-9a-f-]+$/i.test(path)) {
    return <PublicBookingSurface><BookingWizardPage /></PublicBookingSurface>;
  }
  if (path === '/book/payment/success') {
    return <PublicBookingSurface><PaymentSuccess /></PublicBookingSurface>;
  }
  if (path === '/book/payment/cancel') {
    return <PublicBookingSurface><PaymentCancel /></PublicBookingSurface>;
  }
  if (/^\/form\/[^/]+\/success$/i.test(path)) return <PublicWorkspaceFormSuccessPage />;
  if (/^\/form\/[^/]+$/i.test(path)) return <PublicWorkspaceFormPage />;

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center font-sans">
      <div className="space-y-4 max-w-md">
        <h1 className="text-6xl font-black text-indigo-500">404</h1>
        <h2 className="text-xl font-bold">Workspace View Not Found</h2>
        <p className="text-xs text-slate-400 leading-normal">The requested URL path does not exist on this tenant workspace configuration, or has been relocated during platform boot.</p>
        <div className="pt-4"><Link to="/app/calendar" className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-6 py-2.5 rounded-xl shadow-lg transition">Return to Staff Dashboard</Link></div>
      </div>
    </div>
  );
};

export default NotFoundPage;
